import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const sourceDependencyIsAvailable = async (path) => {
  try {
    await access(join(root, "src"));
    await access(join(root, "node_modules", path));
    return true;
  } catch (cause) {
    if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      cause.code === "ENOENT"
    )
      return false;
    throw cause;
  }
};

if (
  process.env.HUSKY !== "0" &&
  (await sourceDependencyIsAvailable("husky/index.js"))
) {
  const { default: installHusky } = await import("husky");
  const message = installHusky();
  if (message.length > 0) process.stdout.write(`${message}\n`);
}
