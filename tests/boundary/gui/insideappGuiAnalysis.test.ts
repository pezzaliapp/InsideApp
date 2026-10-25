import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";

import { analyzeJavaScriptApplication } from "../../../src/application/javascript/JavaScriptApplicationService.js";
import { generateReport } from "../../../src/application/report/generateReport.js";
import { renderReportMarkdown } from "../../../src/application/report/renderInsideAppReport.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { createReportAnalysisPorts } from "../../../src/composition/reportAnalysis.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import type { JsonValue } from "../../../src/domain/jsonValue.js";
import { createLogger } from "../../../src/logger.js";
import { err, ok } from "../../../src/domain/result.js";
import {
  createOsascriptPicker,
  osascriptArguments,
  type GuiPicker,
} from "../../../src/gui/guiTargets.js";
import {
  apiHeaders,
  jsonPost,
  send,
  signedIn,
} from "../../fixtures/insideappGuiClient.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const execute = promisify(execFile);
const TIMEOUT_MS = 120_000;
const NOTES = resolve("tests/fixtures/examples/notes-electron");

/** A picker port that returns the queued choices in order. */
const queuedPicker = (...paths: (string | "cancel")[]): GuiPicker => {
  const queue = [...paths];
  return async () => {
    const next = queue.shift();
    return next === undefined || next === "cancel"
      ? { ok: false, reason: "cancelled" }
      : { ok: true, path: next };
  };
};

type Session = Awaited<ReturnType<typeof signedIn>>;

const pick = async (session: Session, kind: "file" | "folder" = "folder") => {
  const response = await jsonPost(
    session.gui,
    "/api/targets",
    { kind },
    session.cookie,
  );
  expect(response.status).toBe(200);
  return JSON.parse(response.body) as {
    outcome: string;
    target?: { id: string; name: string; kind: string; route: string };
  };
};

const analyze = async (session: Session, targetId: string) => {
  const response = await jsonPost(
    session.gui,
    "/api/analyses",
    { target_id: targetId, authorized: true },
    session.cookie,
  );
  expect(response.status, response.body).toBe(202);
  return (JSON.parse(response.body) as { id: string }).id;
};

const getJson = async (session: Session, path: string) => {
  const response = await send(session.gui, {
    path,
    headers: apiHeaders(session.gui, session.cookie),
  });
  return {
    status: response.status,
    value: JSON.parse(response.body) as Record<string, unknown>,
    response,
  };
};

/** Poll like the page does until the analysis leaves "running". */
const settled = async (session: Session, id: string) => {
  const deadline = Date.now() + 90_000;
  for (;;) {
    const { value } = await getJson(session, `/api/analyses/${id}`);
    if (value.status !== "running") return value;
    if (Date.now() > deadline) throw new Error("analysis did not settle");
    await new Promise((wait) => setTimeout(wait, 100));
  }
};

const children = async (): Promise<number[]> => {
  const result = await execute("pgrep", ["-P", String(process.pid)]).catch(
    () => ({ stdout: "" }),
  );
  return result.stdout.split("\n").filter(Boolean).map(Number);
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const writeLargeApplication = async (root: string): Promise<string> => {
  const application = join(root, "large-app");
  await mkdir(join(application, "src"), { recursive: true });
  await writeFile(
    join(application, "package.json"),
    JSON.stringify({ name: "large", version: "1.0.0", main: "main.js" }),
  );
  const handlers: string[] = ['const { ipcMain } = require("electron");'];
  for (let index = 0; index < 200; index += 1) {
    handlers.push(
      `ipcMain.handle("canale:${index}", () => require("./src/m${index}.js").run());`,
    );
    const functions = Array.from(
      { length: 60 },
      (_, item) =>
        `function f${item}(a){ const o={k${item}:a}; return [o, a+${item}].map(x=>typeof x==="object"?JSON.stringify(x):String(x)).join(","); }`,
    );
    await writeFile(
      join(application, "src", `m${index}.js`),
      `${functions.join("\n")}\nexports.run=()=>[${functions.map((_, item) => `f${item}(1)`).join(",")}];\n`,
    );
  }
  await writeFile(join(application, "main.js"), `${handlers.join("\n")}\n`);
  return application;
};

describe("InsideApp GUI selection", () => {
  it("keeps chosen paths in the process and refuses unknown or unchosen items", async () => {
    const session = await signedIn({
      picker: queuedPicker(NOTES, "cancel", "/does/not/exist"),
    });
    const chosen = await pick(session);
    expect(chosen).toEqual({
      outcome: "selected",
      target: {
        id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/u),
        name: "notes-electron",
        kind: "folder",
        route: "javascript-application",
      },
    });
    expect(JSON.stringify(chosen)).not.toContain(NOTES);
    expect(await pick(session)).toEqual({ outcome: "cancelled" });
    expect(await pick(session)).toEqual({ outcome: "unavailable" });
    expect(
      (
        await jsonPost(
          session.gui,
          "/api/analyses",
          { target_id: "A".repeat(22), authorized: true },
          session.cookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await jsonPost(
          session.gui,
          "/api/analyses",
          { target_id: chosen.target!.id, authorized: false },
          session.cookie,
        )
      ).body,
    ).toBe('{"error":"authorization_required"}');
    expect(
      (
        await jsonPost(
          session.gui,
          "/api/analyses",
          { target_id: chosen.target!.id },
          session.cookie,
        )
      ).status,
    ).toBe(400);
    for (const path of [
      "/api/analyses/x",
      "/api/reports/../../package.json",
      `/api/reports/${"A".repeat(22)}/export.txt`,
    ])
      expect((await getJson(session, path)).status, path).toBe(404);
    for (const path of [
      `/api/analyses/${"A".repeat(22)}`,
      `/api/reports/${"A".repeat(22)}`,
    ])
      expect(
        (await send(session.gui, { path, headers: apiHeaders(session.gui) }))
          .status,
        path,
      ).toBe(401);
    expect(
      (await jsonPost(session.gui, "/api/targets", { kind: "file" })).status,
    ).toBe(401);
    expect(
      (
        await jsonPost(
          session.gui,
          "/api/targets",
          { kind: "disk" },
          session.cookie,
        )
      ).status,
    ).toBe(400);
  });

  it("opens one native dialog at a time", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => (release = resolveGate));
    const session = await signedIn({
      picker: async () => {
        await gate;
        return { ok: false, reason: "cancelled" };
      },
    });
    const first = jsonPost(
      session.gui,
      "/api/targets",
      { kind: "file" },
      session.cookie,
    );
    await new Promise((wait) => setTimeout(wait, 50));
    expect(
      (
        await jsonPost(
          session.gui,
          "/api/targets",
          { kind: "file" },
          session.cookie,
        )
      ).body,
    ).toBe('{"error":"picker_open"}');
    release();
    expect((await first).status).toBe(200);
  });

  it("drives osascript with fixed scripts and treats a failed dialog as cancelled", async () => {
    const root = await createTestTempDirectory("rea-insideapp-osascript-");
    const log = join(root, "arguments.json");
    const fake = join(root, "osascript");
    await writeFile(
      fake,
      `#!/bin/sh\nnode -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))' '${log}' "$@"\nprintf '%s\\n' "${NOTES}/"\n`,
    );
    await chmod(fake, 0o755);
    const signal = new AbortController().signal;
    expect(
      await createOsascriptPicker(fake, "darwin")("folder", signal),
    ).toEqual({ ok: true, path: NOTES });
    expect(JSON.parse(await readFile(log, "utf8"))).toEqual([
      ...osascriptArguments("folder"),
    ]);
    await writeFile(
      fake,
      "#!/bin/sh\necho 'execution error: User canceled. (-128)' >&2\nexit 1\n",
    );
    expect(await createOsascriptPicker(fake, "darwin")("file", signal)).toEqual(
      { ok: false, reason: "cancelled" },
    );
    expect(await createOsascriptPicker(fake, "linux")("file", signal)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    for (const kind of ["file", "folder"] as const) {
      expect(osascriptArguments(kind).join(" ")).not.toMatch(
        /do shell script|System Events|tell application/u,
      );
      if (process.platform === "darwin")
        await execute("osacompile", [
          "-o",
          join(root, `${kind}.scpt`),
          ...osascriptArguments(kind),
        ]);
    }
  });
});

describe("InsideApp GUI analysis and report", () => {
  it(
    "analyzes the Electron example into a path-free report identical to the shared service",
    async () => {
      const session = await signedIn({ picker: queuedPicker(NOTES) });
      const id = await analyze(session, (await pick(session)).target!.id);
      const done = await settled(session, id);
      expect(done).toMatchObject({
        status: "completed",
        target: { name: "notes-electron" },
        counts: { observed: 6, derived: 4, hypothesis: 3, unknown: 16 },
      });
      const report = await getJson(session, `/api/reports/${id}`);
      expect(report.value).toMatchObject({
        report: { subject: { name: "notes-electron", path: null } },
        legend: { labels: { observed: "Osservato" } },
      });
      const markdown = await send(session.gui, {
        path: `/api/reports/${id}/export.md`,
        headers: apiHeaders(session.gui, session.cookie),
      });
      const html = await send(session.gui, {
        path: `/api/reports/${id}/export.html`,
        headers: apiHeaders(session.gui, session.cookie),
      });
      expect(markdown.headers["content-disposition"]).toBe(
        'attachment; filename="notes-electron-0ee325d4eaf7.md"',
      );
      expect(html.headers["content-disposition"]).toBe(
        'attachment; filename="notes-electron-0ee325d4eaf7.html"',
      );
      for (const body of [
        JSON.stringify(report.value),
        markdown.body,
        html.body,
        JSON.stringify(done),
      ]) {
        expect(body).not.toContain(NOTES);
        expect(body).not.toContain(resolve("."));
      }
      expect(markdown.body).not.toContain("**Percorso:**");
      // Same report as the shared service run in-process, apart from the path.
      const scope = new ArtifactResourceScope();
      try {
        const shared = await generateReport(
          { path: NOTES, authorized: true },
          createReportAnalysisPorts({
            environment: {},
            logger: createLogger("cli", "silent"),
            javascript: async (path, signal) => {
              const result = await analyzeJavaScriptApplication(
                { input_path: path },
                scope,
                { signal },
              );
              return result.ok
                ? ok(result.value as unknown as JsonValue)
                : err(
                    projectAnalysisError(result.error) as unknown as JsonValue,
                  );
            },
          }),
          {
            generatedAt: new Date(
              /- \*\*Generato:\*\* (\S+) con /u.exec(markdown.body)![1]!,
            ),
            homeDirectory: undefined,
            signal: new AbortController().signal,
          },
        );
        if (!shared.ok) throw new Error("shared report failed");
        expect(markdown.body).toBe(
          renderReportMarkdown({
            ...shared.value,
            subject: { ...shared.value.subject, path: null },
          }),
        );
      } finally {
        await scope.close();
      }
    },
    TIMEOUT_MS,
  );

  it(
    "inspects other files and explains unreadable ones without paths",
    async () => {
      const root = await createTestTempDirectory("rea-insideapp-gui-files-");
      const archive = join(root, "bundle.zip");
      const writer = new ZipWriter(new Uint8ArrayWriter());
      await writer.add("main.js", new TextReader("console.log(1);\n"));
      await writeFile(archive, await writer.close());
      const vanishing = join(root, "sparito.bin");
      await writeFile(vanishing, "dati");
      const session = await signedIn({
        picker: queuedPicker(archive, vanishing),
      });
      const zip = await pick(session, "file");
      expect(zip.target).toMatchObject({
        name: "bundle.zip",
        kind: "file",
        route: "artifact",
      });
      expect(
        await settled(session, await analyze(session, zip.target!.id)),
      ).toMatchObject({ status: "completed" });
      const gone = await pick(session, "file");
      await rm(vanishing);
      const failed = await settled(
        session,
        await analyze(session, gone.target!.id),
      );
      expect(failed).toMatchObject({
        status: "failed",
        failure: {
          message: "L'elemento scelto non è stato trovato o non è leggibile.",
        },
      });
      expect(JSON.stringify(failed)).not.toContain(root);
    },
    TIMEOUT_MS,
  );
});

describe("InsideApp GUI cancellation and shutdown", () => {
  it(
    "cancels running work, stops its worker and refuses a second concurrent analysis",
    async () => {
      const application = await writeLargeApplication(
        await createTestTempDirectory("rea-insideapp-gui-large-"),
      );
      const before = new Set(await children());
      const session = await signedIn({
        picker: queuedPicker(application, NOTES),
      });
      const id = await analyze(session, (await pick(session)).target!.id);
      const other = await pick(session);
      expect(
        (
          await jsonPost(
            session.gui,
            "/api/analyses",
            { target_id: other.target!.id, authorized: true },
            session.cookie,
          )
        ).body,
      ).toBe('{"error":"analysis_running"}');
      let workers: number[] = [];
      const deadline = Date.now() + 30_000;
      while (workers.length === 0 && Date.now() < deadline) {
        workers = (await children()).filter((pid) => !before.has(pid));
        await new Promise((wait) => setTimeout(wait, 50));
      }
      expect(workers.length).toBeGreaterThan(0);
      const startedAt = Date.now();
      expect(
        (
          await jsonPost(
            session.gui,
            `/api/analyses/${id}/cancel`,
            {},
            session.cookie,
          )
        ).status,
      ).toBe(202);
      expect(await settled(session, id)).toMatchObject({ status: "cancelled" });
      expect(Date.now() - startedAt).toBeLessThan(10_000);
      expect((await getJson(session, `/api/reports/${id}`)).status).toBe(404);
      await session.gui.stop("shutdown");
      expect(workers.filter(alive)).toEqual([]);
      expect((await children()).filter((pid) => !before.has(pid))).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    "stops during an analysis without leaving processes behind",
    async () => {
      const application = await writeLargeApplication(
        await createTestTempDirectory("rea-insideapp-gui-large-"),
      );
      const before = new Set(await children());
      const session = await signedIn({ picker: queuedPicker(application) });
      await analyze(session, (await pick(session)).target!.id);
      await new Promise((wait) => setTimeout(wait, 500));
      await expect(session.gui.stop("interrupted")).resolves.toBe(
        "interrupted",
      );
      expect((await children()).filter((pid) => !before.has(pid))).toEqual([]);
    },
    TIMEOUT_MS,
  );
});
