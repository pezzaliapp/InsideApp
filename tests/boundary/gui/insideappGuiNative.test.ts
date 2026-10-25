import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import type { GuiPicker } from "../../../src/gui/guiTargets.js";
import {
  jsonPost,
  send,
  apiHeaders,
  signedIn,
} from "../../fixtures/insideappGuiClient.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const execute = promisify(execFile);
const TIMEOUT_MS = 300_000;
const SAMPLE_SOURCE = resolve("tests/fixtures/reverse/sample.c");
/** Corkami PE/bin/normal.exe (BSD, Ange Albertini), fetched by the developer. */
const NORMAL_EXE_SHA256 =
  "e91e6c6673d13ef0efd5af5091f6c5bd5b55895c71cdd7ae23ca0e1b10e1a700";

/** The Ghidra selection the launcher would read; absent means skip. */
const ghidraEnvironment = (): Record<string, string> | undefined => {
  const selected: Record<string, string> = {};
  const file = join(homedir(), ".insideapp", "ghidra.env");
  if (existsSync(file))
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const [key, ...value] = line.split("=");
      if (key === "GHIDRA_INSTALL_DIR" || key === "JAVA_HOME")
        selected[key] = value.join("=");
    }
  for (const key of ["GHIDRA_INSTALL_DIR", "JAVA_HOME"])
    if (process.env[key] !== undefined) selected[key] = process.env[key]!;
  return selected.GHIDRA_INSTALL_DIR !== undefined &&
    existsSync(join(selected.GHIDRA_INSTALL_DIR, "support", "analyzeHeadless"))
    ? ({ ...process.env, ...selected } as Record<string, string>)
    : undefined;
};

const GHIDRA = ghidraEnvironment();
const CLANG = existsSync("/usr/bin/clang") && process.platform === "darwin";
const NORMAL_EXE = join(homedir(), ".insideapp", "samples", "normal.exe");
const HAS_NORMAL_EXE =
  existsSync(NORMAL_EXE) &&
  createHash("sha256").update(readFileSync(NORMAL_EXE)).digest("hex") ===
    NORMAL_EXE_SHA256;

type Session = Awaited<ReturnType<typeof signedIn>>;

const fixedPicker =
  (path: string): GuiPicker =>
  async () => ({ ok: true, path });

const getJson = async (session: Session, path: string) => {
  const response = await send(session.gui, {
    path,
    headers: apiHeaders(session.gui, session.cookie),
  });
  return {
    status: response.status,
    body: response.body,
    value: JSON.parse(response.body),
  };
};

interface Overview {
  readonly format: string;
  readonly architecture: string;
  readonly functions: readonly {
    address: string;
    name: string;
    external: boolean;
  }[];
  readonly strings: readonly { address: string; value: string }[];
}

/** Choose the target, start the analysis and wait for Ghidra's overview. */
const explore = async (session: Session): Promise<Overview> => {
  const picked = await jsonPost(
    session.gui,
    "/api/targets",
    { kind: "file" },
    session.cookie,
  );
  const target = JSON.parse(picked.body).target as { id: string };
  const refused = await jsonPost(
    session.gui,
    "/api/native",
    { target_id: target.id },
    session.cookie,
  );
  expect(refused.status).toBe(400);
  const started = await jsonPost(
    session.gui,
    "/api/native",
    { target_id: target.id, authorized: true },
    session.cookie,
  );
  expect(started.status, started.body).toBe(202);
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const view = (await getJson(session, "/api/native")).value;
    if (view.status === "ready") return view.overview as Overview;
    expect(view.status, JSON.stringify(view)).toBe("starting");
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error("Ghidra did not finish");
};

const functionNamed = (overview: Overview, name: string) => {
  const entry = overview.functions.find((candidate) => candidate.name === name);
  if (entry === undefined) throw new Error(`missing function ${name}`);
  return entry;
};

describe("InsideApp GUI reverse engineering without Ghidra", () => {
  it("explains the missing engine and refuses to start", async () => {
    const session = await signedIn({
      environment: {},
      picker: fixedPicker(SAMPLE_SOURCE),
    });
    const view = (await getJson(session, "/api/native")).value;
    expect(view).toEqual({ engine: "not_configured", status: "idle" });
    const picked = await jsonPost(
      session.gui,
      "/api/targets",
      { kind: "file" },
      session.cookie,
    );
    const target = JSON.parse(picked.body).target as { id: string };
    const started = await jsonPost(
      session.gui,
      "/api/native",
      { target_id: target.id, authorized: true },
      session.cookie,
    );
    expect(started.status).toBe(409);
    expect(JSON.parse(started.body)).toMatchObject({
      error: "engine_not_configured",
      message: expect.stringContaining("scripts/install-ghidra.sh"),
    });
    const page = await send(session.gui, {
      path: "/",
      headers: { Cookie: session.cookie },
    });
    expect(page.body).toContain(
      '<h2 id="native-title">Reverse Engineering</h2>',
    );
  });
});

describe("InsideApp GUI reverse engineering with Ghidra", () => {
  it.skipIf(GHIDRA === undefined || !CLANG)(
    "reconstructs functions, branches, a loop and calls of a locally compiled sample (requires Ghidra and clang)",
    async () => {
      const root = await createTestTempDirectory("rea-insideapp-native-");
      const binary = join(root, "sample-arm64");
      // Compiled only; the program is never run.
      await execute("/usr/bin/clang", [
        "-O0",
        "-g0",
        "-arch",
        "arm64",
        "-o",
        binary,
        SAMPLE_SOURCE,
      ]);
      const session = await signedIn({
        environment: GHIDRA!,
        picker: fixedPicker(binary),
      });
      const overview = await explore(session);
      expect(overview).toMatchObject({
        format: "mach-o",
        architecture: "arm64",
      });
      expect(JSON.stringify(overview)).not.toContain(root);
      const read = async (name: string) => {
        const entry = functionNamed(overview, name);
        const view = await getJson(
          session,
          `/api/native/functions/${entry.address}`,
        );
        expect(view.status, view.body).toBe(200);
        return view.value;
      };

      // classify: if (value < 0) … if (value == 0) … return 1
      const classify = await read("_classify");
      expect(classify.pseudocode).toMatch(/if \(/u);
      expect(
        classify.blocks.filter(
          (block: { successors: string[] }) => block.successors.length > 1,
        ).length,
      ).toBeGreaterThanOrEqual(2);
      expect(
        classify.assembly.some((line: string) =>
          /\b(tbz|tbnz|cbz|cbnz|b\.\w+)\b/u.test(line),
        ),
      ).toBe(true);

      // checksum: a loop over strlen(text)
      const checksum = await read("_checksum");
      expect(checksum.pseudocode).toContain("_strlen");
      expect(checksum.pseudocode).toMatch(/while|for \(|do \{/u);
      expect(
        checksum.callees.map((callee: { name: string }) => callee.name),
      ).toEqual(expect.arrayContaining([expect.stringContaining("_strlen")]));
      expect(
        checksum.explanation
          .map((claim: { text: string }) => claim.text)
          .join(" "),
      ).toContain("salto all'indietro");
      // strlen is reached through a stub and read as an imported function.
      expect(checksum.explanation).toContainEqual({
        kind: "hypothesis",
        text: expect.stringContaining("elaborare stringhe o memoria (_strlen)"),
      });

      // main: checksum, classify(sum - 900), printf, and the default input
      const main = functionNamed(overview, "entry");
      const mainView = (
        await getJson(session, `/api/native/functions/${main.address}`)
      ).value;
      expect(
        mainView.callees.map((callee: { name: string }) => callee.name),
      ).toEqual(
        expect.arrayContaining([
          "_checksum",
          "_classify",
          expect.stringContaining("_printf"),
        ]),
      );
      expect(mainView.pseudocode).toContain("900");
      expect(mainView.pseudocode).toContain('"insideapp"');
      const format = overview.strings.find(
        (entry) => entry.value === "checksum=%d class=%d\n",
      );
      expect(format).toBeDefined();
      const references = await getJson(
        session,
        `/api/native/strings/${format!.address}/references`,
      );
      expect(references.value.references).toEqual([
        expect.objectContaining({
          function: { address: main.address, name: "entry" },
        }),
      ]);

      const markdown = await send(session.gui, {
        path: "/api/native/export.md",
        headers: apiHeaders(session.gui, session.cookie),
      });
      expect(markdown.status).toBe(200);
      expect(markdown.body).toContain("## Funzione _checksum");
      expect(markdown.body).toContain(
        "### Pseudocodice (decompilatore Ghidra)",
      );
      expect(markdown.body).not.toContain(root);
      const html = await send(session.gui, {
        path: "/api/native/export.html",
        headers: apiHeaders(session.gui, session.cookie),
      });
      expect(html.body).not.toMatch(/<script|<img|<link|\ssrc=/iu);
    },
    TIMEOUT_MS,
  );

  it.skipIf(GHIDRA === undefined || !HAS_NORMAL_EXE)(
    "disassembles and decompiles Corkami's normal.exe (requires Ghidra and the sample)",
    async () => {
      const session = await signedIn({
        environment: GHIDRA!,
        picker: fixedPicker(NORMAL_EXE),
      });
      const overview = await explore(session);
      expect(overview).toMatchObject({ format: "pe", architecture: "x86" });
      const entry = functionNamed(overview, "entry");
      expect(entry.address).toBe("0x401000");
      const view = (await getJson(session, "/api/native/functions/0x401000"))
        .value;
      // normal.asm: printf(message), then ExitProcess(0).
      expect(view.assembly).toEqual([
        "0x401000: PUSH 0x401018",
        "0x401005: CALL dword ptr [0x004010d8]",
        "0x40100b: ADD ESP, 0x4",
        "0x40100e: NOP",
        "0x40100f: PUSH 0x0",
        "0x401011: CALL dword ptr [0x004010d0]",
      ]);
      expect(view.pseudocode).toContain("printf(");
      expect(view.pseudocode).toContain("ExitProcess(0)");
      expect(view.strings).toEqual([
        {
          address: "0x401018",
          value: " * a standard PE (imports, standard alignments)\n",
        },
      ]);
      expect(view.blocks).toEqual([
        { start: "0x401000", end: "0x401017", successors: [] },
      ]);
      const closed = await jsonPost(
        session.gui,
        "/api/native/close",
        {},
        session.cookie,
      );
      expect(JSON.parse(closed.body)).toMatchObject({ status: "idle" });
    },
    TIMEOUT_MS,
  );
});
