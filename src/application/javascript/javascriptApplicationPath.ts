import { realpath, stat } from "node:fs/promises";

import { findAppBundleResourceRoot } from "../AppBundleExecutable.js";

/**
 * True for `.asar` files and plain directories, which are analyzed as
 * JavaScript applications. App bundles and other files take the native or
 * artifact routes; unreadable paths return false so those routes report them.
 */
export const isJavaScriptApplicationPath = async (
  path: string,
): Promise<boolean> => {
  try {
    const canonical = await realpath(path);
    if (canonical.toLowerCase().endsWith(".asar")) return true;
    if (!(await stat(canonical)).isDirectory()) return false;
    const bundle = await findAppBundleResourceRoot(canonical);
    // Unresolved native metadata must reach native admission's typed failure.
    return bundle.ok && bundle.value === undefined;
  } catch (cause: unknown) {
    void cause;
    return false;
  }
};
