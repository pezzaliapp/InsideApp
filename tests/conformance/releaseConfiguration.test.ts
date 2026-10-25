import { readFile, readdir } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { SUPPORTED_NODE_VERSION_RANGE } from "../../src/domain/runtimeVersion.js";

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, "utf8")) as unknown;

describe("InsideApp distribution configuration", () => {
  it("keeps doctor and setup runtime support aligned with package engines", async () => {
    expect(await readJson("package.json")).toMatchObject({
      engines: { node: SUPPORTED_NODE_VERSION_RANGE },
    });
  });

  it("keeps the lockfile and changelog aligned with the package version", async () => {
    const packageJson = (await readJson("package.json")) as {
      version: string;
    };
    expect(await readJson("package-lock.json")).toMatchObject({
      version: packageJson.version,
      packages: { "": { version: packageJson.version } },
    });
    const changelog = await readFile("CHANGELOG.md", "utf8");
    expect(/^## \[([^\]]+)\]/mu.exec(changelog)?.[1]).toBe(packageJson.version);
  });

  it("keeps InsideApp a private local distribution without publishing metadata", async () => {
    const packageJson = (await readJson("package.json")) as Record<
      string,
      unknown
    >;
    expect(packageJson).toMatchObject({ private: true });
    expect(packageJson).not.toHaveProperty("mcpName");
    expect(packageJson).not.toHaveProperty("publishConfig");
    expect(packageJson).not.toHaveProperty(["scripts", "prepublishOnly"]);
    expect(
      Object.values(packageJson.scripts as Record<string, string>).filter(
        (script) => /\bnpx\b|\bnpm (?:publish|install -g)\b/u.test(script),
      ),
    ).toEqual([]);
    for (const path of [
      "server.json",
      "release-please-config.json",
      ".release-please-manifest.json",
    ])
      await expect(readFile(path, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    await expect(readdir(".github/workflows")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
