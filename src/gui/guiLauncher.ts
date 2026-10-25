import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);

/** InsideApp checkout root, resolved like the other package-relative files. */
export const guiProjectRoot = (): string =>
  fileURLToPath(new URL("../../", import.meta.url));

/** Owner-only folder for launch files, inside the project and ignored by Git. */
export const guiLauncherDirectory = (projectRoot: string): string =>
  join(projectRoot, ".cache", "gui");

export interface GuiLauncher {
  /** File the browser opens; its path, unlike its content, is not secret. */
  readonly path: string;
  readonly remove: () => Promise<void>;
}

const attribute = (value: string): string =>
  value.replace(/[&"<>]/gu, (character) => `&#${character.charCodeAt(0)};`);

/**
 * Write the launch page that carries the single-use token. The token stays
 * out of process arguments (visible to every local user) and out of logs:
 * only this owner-readable file holds it, until the session starts.
 */
export const writeGuiLauncher = async (
  directory: string,
  startUrl: string,
): Promise<GuiLauncher> => {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const folder = await mkdtemp(join(directory, "avvio-"));
  const path = join(folder, "avvia-insideapp.html");
  await writeFile(
    path,
    `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=${attribute(startUrl)}"><title>InsideApp</title></head><body><p>Apertura di InsideApp…</p></body></html>\n`,
    { mode: 0o600, flag: "wx" },
  );
  let removed: Promise<void> | undefined;
  return {
    path,
    remove: () => (removed ??= rm(folder, { recursive: true, force: true })),
  };
};

/**
 * Explorer opens a file with its registered program, here the default
 * browser; by absolute path so no `explorer.exe` elsewhere is chosen.
 */
const windowsExplorer = (
  environment: Readonly<Record<string, string | undefined>>,
): string =>
  win32.join(
    environment.SystemRoot ?? environment.SYSTEMROOT ?? "C:\\Windows",
    "explorer.exe",
  );

/** Starts the desktop opener; replaceable only so tests can observe it. */
export type OpenerRun = (
  command: string,
  args: string[],
  options: { readonly timeout: number },
) => Promise<unknown>;

/** Ask the desktop to open the launch file in the default browser. */
export const openGuiLauncher = async (
  path: string,
  platform: NodeJS.Platform = process.platform,
  run: OpenerRun = execute,
): Promise<boolean> => {
  if (platform === "win32")
    try {
      await run(windowsExplorer(process.env), [path], { timeout: 10_000 });
      return true;
    } catch (cause: unknown) {
      // Explorer reports exit code 1 even after opening the file; only a
      // failure to start it, or no answer at all, means nothing opened.
      return (
        typeof (cause as { code?: unknown }).code === "number" &&
        (cause as { killed?: unknown }).killed !== true
      );
    }
  const opener =
    platform === "darwin"
      ? "open"
      : platform === "linux"
        ? "xdg-open"
        : undefined;
  if (opener === undefined) return false;
  try {
    await run(opener, [path], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
};
