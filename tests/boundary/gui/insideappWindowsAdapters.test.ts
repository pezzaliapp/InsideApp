import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";

import { createInsideAppReport } from "../../../src/application/report/InsideAppReportService.js";
import { isTooBroadReportFolder } from "../../../src/application/report/reportTarget.js";
import { createReportAnalysisPorts } from "../../../src/composition/reportAnalysis.js";
import {
  openGuiLauncher,
  type OpenerRun,
} from "../../../src/gui/guiLauncher.js";
import {
  createWindowsPicker,
  powershellArguments,
  windowsPowershellPath,
  type GuiPicker,
} from "../../../src/gui/guiTargets.js";
import { createLogger } from "../../../src/logger.js";
import { jsonPost, signedIn } from "../../fixtures/insideappGuiClient.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

// These tests run the Windows adapters' own logic on any host. They do not
// replace a run on real Windows: the dialog and Explorer are stood in for.

describe("InsideApp report folders on Windows paths", () => {
  it("refuses drive and share roots, first-level folders and the profile", () => {
    const home = "C:\\Users\\Anna";
    for (const path of [
      "C:\\",
      "c:\\",
      "D:\\",
      "C:\\Program Files",
      "C:\\Windows\\",
      "C:\\Users",
      "c:\\users\\anna",
      "C:\\USERS\\ANNA\\",
      "\\\\server\\share",
      "\\\\server\\share\\Progetti",
    ])
      expect(isTooBroadReportFolder(path, home, "win32"), path).toBe(true);
    for (const path of [
      "C:\\Users\\Anna\\Documents",
      "C:\\Program Files\\Notes",
      "D:\\App\\Notes",
      "\\\\server\\share\\Progetti\\Notes",
    ])
      expect(isTooBroadReportFolder(path, home, "win32"), path).toBe(false);
    // POSIX keeps its rule, with case-sensitive names.
    for (const path of ["/", "/Applications", "/Users/anna"])
      expect(isTooBroadReportFolder(path, "/Users/anna", "darwin")).toBe(true);
    expect(isTooBroadReportFolder("/Users/Anna", "/Users/anna", "darwin")).toBe(
      false,
    );
  });
});

/** A stand-in for powershell.exe that records its arguments. */
const fakePowershell = async (
  root: string,
  output: string,
  exitCode: number,
): Promise<{ command: string; log: string }> => {
  const log = join(root, "arguments.json");
  const command = join(root, `powershell-${exitCode}.sh`);
  await writeFile(
    command,
    `#!/bin/sh\nnode -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))' '${log}' "$@"\nprintf '%s' '${output}'\nexit ${exitCode}\n`,
  );
  await chmod(command, 0o755);
  return { command, log };
};

describe("InsideApp Windows file dialog", () => {
  it("runs fixed PowerShell dialogs and keeps only absolute drive or UNC paths", async () => {
    const root = await createTestTempDirectory("rea-insideapp-powershell-");
    const signal = new AbortController().signal;
    const choose = async (output: string, exitCode = 0) => {
      const { command } = await fakePowershell(root, output, exitCode);
      return createWindowsPicker(command, "win32")("file", signal);
    };
    expect(await choose("C:\\Users\\Anna\\Notes\\notes.exe\r\n")).toEqual({
      ok: true,
      path: "C:\\Users\\Anna\\Notes\\notes.exe",
    });
    const { log } = await fakePowershell(root, "", 0);
    expect(JSON.parse(await readFile(log, "utf8"))).toEqual(
      powershellArguments("file"),
    );
    expect(await choose("D:\\App\\")).toEqual({ ok: true, path: "D:\\App" });
    expect(await choose("C:\\")).toEqual({ ok: true, path: "C:\\" });
    expect(await choose("\\\\server\\share\\App\\")).toEqual({
      ok: true,
      path: "\\\\server\\share\\App",
    });
    for (const output of ["", "App\\notes.exe", "\\App\\notes.exe", "C:App"])
      expect(await choose(output), output).toEqual({
        ok: false,
        reason: "unavailable",
      });
    // Exit code 2 is a closed dialog; any other failure means no dialog.
    expect(await choose("", 2)).toEqual({ ok: false, reason: "cancelled" });
    expect(await choose("", 1)).toEqual({ ok: false, reason: "unavailable" });
    expect(
      await createWindowsPicker(join(root, "missing.exe"), "win32")(
        "folder",
        signal,
      ),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(
      await createWindowsPicker("unused", "darwin")("file", signal),
    ).toEqual({ ok: false, reason: "unavailable" });
  });

  it("never weakens policy, elevates or runs anything but the dialog", () => {
    for (const kind of ["file", "folder"] as const) {
      const args = powershellArguments(kind);
      expect(args.slice(0, 5)).toEqual([
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-STA",
        "-Command",
      ]);
      expect(args.join(" ")).not.toMatch(
        /ExecutionPolicy|Bypass|EncodedCommand|RunAs|Start-Process|Invoke-|iex|DownloadString|Net\.WebClient|Set-|"/iu,
      );
      expect(args.at(-1)).toContain(
        kind === "file" ? "OpenFileDialog" : "FolderBrowserDialog",
      );
    }
    expect(windowsPowershellPath({ SystemRoot: "D:\\Win" })).toBe(
      "D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    );
    expect(windowsPowershellPath({})).toBe(
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    );
  });
});

describe("InsideApp default browser on Windows", () => {
  it("opens the launch file with Explorer and reads its exit codes", async () => {
    const calls: string[][] = [];
    const exiting =
      (outcome: unknown): OpenerRun =>
      async (command, args) => {
        calls.push([command, ...args]);
        if (outcome !== undefined) throw outcome;
      };
    const launch = "C:\\Users\\Anna\\InsideApp\\.cache\\gui\\avvio\\a.html";
    expect(await openGuiLauncher(launch, "win32", exiting(undefined))).toBe(
      true,
    );
    expect(calls[0]).toEqual([
      expect.stringMatching(/\\explorer\.exe$/u),
      launch,
    ]);
    // Explorer exits 1 after opening the file.
    expect(await openGuiLauncher(launch, "win32", exiting({ code: 1 }))).toBe(
      true,
    );
    expect(
      await openGuiLauncher(launch, "win32", exiting({ code: "ENOENT" })),
    ).toBe(false);
    expect(
      await openGuiLauncher(
        launch,
        "win32",
        exiting({ code: null, killed: true }),
      ),
    ).toBe(false);
    expect(await openGuiLauncher(launch, "aix", exiting(undefined))).toBe(
      false,
    );
  });
});

describe("InsideApp GUI without a system dialog", () => {
  it("tells the browser the dialog is unavailable, unlike an unusable item", async () => {
    const picker: GuiPicker = async () => ({
      ok: false,
      reason: "unavailable",
    });
    const session = await signedIn({ picker });
    const response = await jsonPost(
      session.gui,
      "/api/targets",
      { kind: "file" },
      session.cookie,
    );
    expect(JSON.parse(response.body)).toEqual({
      outcome: "picker_unavailable",
    });
  });
});

describe("InsideApp reports where a supplement cannot run", () => {
  it("states that the analysis is unavailable on this system", async () => {
    const root = await createTestTempDirectory("rea-insideapp-unavailable-");
    const file = join(root, "notes.zip");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("main.js", new TextReader("console.log(1);\n"));
    await writeFile(file, await writer.close());
    const ports = createReportAnalysisPorts({
      environment: {},
      logger: createLogger("cli", "silent"),
      javascript: () => Promise.reject(new Error("unused")),
    });
    const set = await ports.artifact(file, new AbortController().signal);
    if (!set.ok) throw new Error(set.error.message);
    const report = createInsideAppReport(
      {
        primary: set.value.primary,
        supplements: [
          { operation: "inspect_plist", failureCode: "capability_unavailable" },
          { operation: "inspect_macho", failureCode: "provider_timeout" },
        ],
      },
      { generatedAt: new Date(0), homeDirectory: undefined },
    );
    if (!report.ok) throw new Error(report.error.reason);
    const limits = report.value.sections
      .flatMap(({ claims }) => claims)
      .map(({ statement }) => statement);
    expect(limits).toContain(
      "L'analisi aggiuntiva inspect_plist non è disponibile su questo sistema (ad esempio richiede strumenti di macOS): le informazioni che avrebbe fornito restano sconosciute.",
    );
    expect(limits).toContain(
      "L'analisi aggiuntiva inspect_macho non è riuscita (codice provider_timeout): le informazioni che avrebbe fornito restano sconosciute.",
    );
  });
});

describe("InsideApp Windows launcher", () => {
  it("starts the isolated Node like the POSIX launcher, without parenthesized blocks", async () => {
    const script = await readFile("scripts/insideapp.cmd", "utf8");
    const version = (await readFile(".nvmrc", "utf8")).trim();
    expect(script).toContain(
      "%USERPROFILE%\\.insideapp\\toolchain\\node-v%INSIDEAPP_VERSION%-win-%INSIDEAPP_ARCH%\\node.exe",
    );
    expect(script).toContain('"%INSIDEAPP_ROOT%\\.nvmrc"');
    expect(script).toContain(
      '"%INSIDEAPP_NODE_EXE%" "%INSIDEAPP_ROOT%\\scripts\\rea.mjs" %*',
    );
    // A path containing ")" would end a parenthesized block early.
    expect(script).not.toMatch(/\(\s*\r?\n/u);
    const commands = script
      .split(/\r?\n/u)
      .filter((line) => !/^rem\b/iu.test(line))
      .join("\n");
    expect(commands).not.toMatch(/\bnpx\b|npm install|ExecutionPolicy|runas/iu);
    const readme = await readFile("README.md", "utf8");
    expect(readme).toContain(`node-v${version}-win-x64`);
    expect(readme).toContain("scripts\\insideapp.cmd gui");
  });
});
