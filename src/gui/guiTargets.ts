import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstat } from "node:fs/promises";
import { basename, isAbsolute, win32 } from "node:path";

import { isTooBroadReportFolder } from "../application/report/reportTarget.js";
import {
  selectReportRoute,
  type ReportRoute,
} from "../application/report/generateReport.js";

export type GuiPickKind = "file" | "folder";

export type GuiPickOutcome =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: "cancelled" | "unavailable" };

/** Ask the user to choose one item; only the returned path is ever analyzed. */
export type GuiPicker = (
  kind: GuiPickKind,
  signal: AbortSignal,
) => Promise<GuiPickOutcome>;

/**
 * Fixed AppleScript for each choice; no caller text is interpolated.
 * `choose file` also accepts `.app` bundles, which Finder shows as files.
 */
const OSASCRIPT_CHOICES: Readonly<Record<GuiPickKind, readonly string[]>> = {
  file: [
    "activate",
    'POSIX path of (choose file with prompt "Scegli il file o l\'app da analizzare con InsideApp")',
  ],
  folder: [
    "activate",
    'POSIX path of (choose folder with prompt "Scegli la cartella da analizzare con InsideApp")',
  ],
};

/** Longest a native dialog may stay open before the choice is abandoned. */
const PICKER_TIMEOUT_MS = 10 * 60_000;

/** The fixed arguments passed to osascript for one choice. */
export const osascriptArguments = (kind: GuiPickKind): readonly string[] =>
  OSASCRIPT_CHOICES[kind].flatMap((line) => ["-e", line]);

/**
 * Native macOS dialog through osascript; it needs no extra system permission.
 * `command` is replaceable only so tests can stand in for the dialog.
 */
export const createOsascriptPicker =
  (command = "osascript", platform = process.platform): GuiPicker =>
  (kind, signal) =>
    new Promise((resolve) => {
      if (platform !== "darwin")
        return resolve({ ok: false, reason: "unavailable" });
      execFile(
        command,
        osascriptArguments(kind),
        { signal, timeout: PICKER_TIMEOUT_MS, maxBuffer: 64 * 1024 },
        (error, stdout) => {
          if (error !== null)
            // -128 is "User canceled"; aborts and timeouts end the choice too.
            return resolve({ ok: false, reason: "cancelled" });
          const path = stdout.replace(/\n$/u, "");
          resolve(
            isAbsolute(path)
              ? {
                  ok: true,
                  path: path.length > 1 ? path.replace(/\/$/u, "") : path,
                }
              : { ok: false, reason: "unavailable" },
          );
        },
      );
    });

/**
 * Fixed Windows PowerShell script for each choice; no caller text is
 * interpolated. It loads the standard Windows Forms dialogs, needs no
 * administrator rights and changes no execution policy: where policy forbids
 * these dialogs it fails, and the choice is reported unavailable. Exit code 2
 * means the user closed the dialog. A chosen shortcut (.lnk) resolves to its
 * target, as in Explorer.
 */
const POWERSHELL_DIALOGS: Readonly<Record<GuiPickKind, string>> = {
  file: "$d = New-Object System.Windows.Forms.OpenFileDialog -Property @{ Title = 'Scegli il file da analizzare con InsideApp'; CheckFileExists = $true; Multiselect = $false }; if ($d.ShowDialog($o) -ne 'OK') { exit 2 }; [Console]::Out.Write($d.FileName)",
  folder:
    "$d = New-Object System.Windows.Forms.FolderBrowserDialog -Property @{ Description = 'Scegli la cartella da analizzare con InsideApp'; ShowNewFolderButton = $false }; if ($d.ShowDialog($o) -ne 'OK') { exit 2 }; [Console]::Out.Write($d.SelectedPath)",
};

/** The fixed arguments passed to Windows PowerShell for one choice. */
export const powershellArguments = (kind: GuiPickKind): readonly string[] => [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-STA",
  "-Command",
  [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false",
    "Add-Type -AssemblyName System.Windows.Forms",
    // An unshown topmost owner keeps the dialog above the browser.
    "$o = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }",
    POWERSHELL_DIALOGS[kind],
  ].join("; "),
];

/**
 * The Windows PowerShell shipped with Windows, by absolute path so a
 * `powershell.exe` in the working folder or on PATH is never chosen.
 */
export const windowsPowershellPath = (
  environment: Readonly<Record<string, string | undefined>>,
): string =>
  win32.join(
    environment.SystemRoot ?? environment.SYSTEMROOT ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );

/** A chosen Windows path without a trailing separator, except at a root. */
const windowsChoice = (output: string): GuiPickOutcome => {
  const path = output.replace(/\r?\n$/u, "");
  // Drive or UNC paths only; `\\folder` would depend on the current drive.
  if (!win32.isAbsolute(path) || /^[\\/][^\\/]/u.test(path))
    return { ok: false, reason: "unavailable" };
  const root = win32.parse(path).root;
  return {
    ok: true,
    path: path.length > root.length ? path.replace(/[\\/]+$/u, "") : path,
  };
};

/**
 * Native Windows dialog through Windows PowerShell. `command` is replaceable
 * only so tests can stand in for the dialog.
 */
export const createWindowsPicker =
  (
    command = windowsPowershellPath(process.env),
    platform = process.platform,
  ): GuiPicker =>
  (kind, signal) =>
    new Promise((resolve) => {
      if (platform !== "win32")
        return resolve({ ok: false, reason: "unavailable" });
      execFile(
        command,
        powershellArguments(kind),
        { signal, timeout: PICKER_TIMEOUT_MS, maxBuffer: 64 * 1024 },
        (error, stdout) => {
          if (error === null) return resolve(windowsChoice(stdout));
          // Closing the dialog, an abort or the timeout ends the choice; a
          // missing PowerShell or a policy refusal leaves no dialog at all.
          resolve({
            ok: false,
            reason:
              error.code === 2 || signal.aborted || error.killed
                ? "cancelled"
                : "unavailable",
          });
        },
      );
    });

/** The native dialog of this desktop; other systems have none yet. */
export const systemPicker: GuiPicker =
  process.platform === "win32"
    ? createWindowsPicker()
    : createOsascriptPicker();

/** What the browser may know about a chosen item: never its path. */
export interface GuiTargetView {
  readonly id: string;
  readonly name: string;
  readonly kind: "file" | "folder" | "bundle";
  readonly route: ReportRoute;
}

export interface GuiTarget extends GuiTargetView {
  readonly path: string;
}

/** Most chosen items kept per session; older choices are forgotten. */
export const GUI_MAX_TARGETS = 20;

/** Items the user chose in this session, addressable only by opaque id. */
export class GuiTargets {
  readonly #targets = new Map<string, GuiTarget>();

  /**
   * Register a chosen item. Folders that would sweep a whole disk or account
   * (the root, first-level folders, the home folder) are refused.
   */
  async add(
    path: string,
    homeDirectory: string | undefined,
  ): Promise<GuiTarget | "too-broad" | undefined> {
    let info;
    try {
      info = await lstat(path);
    } catch {
      return undefined;
    }
    if (!info.isFile() && !info.isDirectory()) return undefined;
    if (info.isDirectory() && isTooBroadReportFolder(path, homeDirectory))
      return "too-broad";
    const name = basename(path) || path;
    const target: GuiTarget = {
      id: randomBytes(16).toString("base64url"),
      path,
      name,
      kind: info.isFile()
        ? "file"
        : name.toLowerCase().endsWith(".app")
          ? "bundle"
          : "folder",
      route: await selectReportRoute(path),
    };
    this.#targets.set(target.id, target);
    for (const id of this.#targets.keys()) {
      if (this.#targets.size <= GUI_MAX_TARGETS) break;
      this.#targets.delete(id);
    }
    return target;
  }

  get(id: string): GuiTarget | undefined {
    return this.#targets.get(id);
  }
}

export const guiTargetView = ({
  id,
  name,
  kind,
  route,
}: GuiTarget): GuiTargetView => ({
  id,
  name,
  kind,
  route,
});
