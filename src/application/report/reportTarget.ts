import { dirname, resolve, sep } from "node:path";

/**
 * Folders that would sweep a whole disk or account: the disk root, any
 * first-level folder (such as /Applications or /Users), the home folder and
 * its parent. Reports refuse them so a choice never becomes a disk scan.
 */
export const isTooBroadReportFolder = (
  path: string,
  homeDirectory: string | undefined,
): boolean => {
  const normalized = resolve(path);
  if (normalized.split(sep).filter(Boolean).length <= 1) return true;
  if (homeDirectory === undefined) return false;
  const home = resolve(homeDirectory);
  return normalized === home || normalized === dirname(home);
};
