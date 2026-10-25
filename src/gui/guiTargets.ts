import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstat } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";

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

export const osascriptPicker = createOsascriptPicker();

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

/** The disk root, first-level folders and the home folder and its parent. */
const isTooBroad = (
  path: string,
  homeDirectory: string | undefined,
): boolean => {
  const normalized = resolve(path);
  if (normalized.split(sep).filter(Boolean).length <= 1) return true;
  if (homeDirectory === undefined) return false;
  const home = resolve(homeDirectory);
  return normalized === home || normalized === dirname(home);
};

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
    if (info.isDirectory() && isTooBroad(path, homeDirectory))
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
