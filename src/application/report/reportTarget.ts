import { posix, win32 } from "node:path";

/**
 * Folders that would sweep a whole disk or account: a disk or share root
 * (`/`, `C:\`, `\\server\share`), any first-level folder below it (such as
 * /Applications, /Users, C:\Users or C:\Program Files), the home folder and
 * its parent. Reports refuse them so a choice never becomes a disk scan.
 * Windows paths compare without case, as the file system does.
 */
export const isTooBroadReportFolder = (
  path: string,
  homeDirectory: string | undefined,
  platform: NodeJS.Platform = process.platform,
): boolean => {
  const paths = platform === "win32" ? win32 : posix;
  const comparable = (value: string) => {
    const resolved = paths.resolve(value);
    return platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const normalized = comparable(path);
  const below = normalized.slice(paths.parse(normalized).root.length);
  if (below.split(paths.sep).filter(Boolean).length <= 1) return true;
  if (homeDirectory === undefined) return false;
  const home = comparable(homeDirectory);
  return normalized === home || normalized === paths.dirname(home);
};
