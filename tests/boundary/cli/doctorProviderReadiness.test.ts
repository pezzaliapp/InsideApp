import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { writeFakeKuna } from "../providers/kuna/fakeKuna.js";

cliTest.skipIf(process.platform === "win32").for(["blocked", "ready"] as const)(
  "doctor reports Kuna readiness for a %s cache",
  async (cache, { cli }) => {
    const root = await createTestTempDirectory("rea-setup-provider-readiness-");
    const home = join(root, "home");
    await mkdir(home);
    const command = await writeFakeKuna(root);
    const cachePath = join(root, "cache");
    if (cache === "blocked") await writeFile(cachePath, "not a directory");
    else await mkdir(cachePath);

    const result = await cli.run({
      arguments: ["doctor", "--json"],
      environment: {
        HOME: home,
        USERPROFILE: home,
        HOPPER_LAUNCHER_PATH: join(root, "missing-hopper"),
        GHIDRA_INSTALL_DIR: join(root, "missing-ghidra"),
        REA_KUNA_COMMAND: command,
        REA_KUNA_CACHE_DIR: cachePath,
      },
      timeoutMs: 20_000,
    });
    // Doctor exits nonzero while no native engine is configured; the
    // inspection itself remains complete.
    expect(result.json, result.stderr).toMatchObject({
      providerInspections: expect.arrayContaining([
        expect.objectContaining({
          id: "kuna",
          available: cache === "ready",
          checks: expect.arrayContaining([
            expect.objectContaining({
              name: "cache",
              ok: cache === "ready",
            }),
          ]),
        }),
      ]),
    });
    await expect(access(join(home, ".claude.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

cliTest.skipIf(process.platform === "win32")(
  "refused setup and doctor do not execute host Java while Ghidra is unconfigured",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-setup-unconfigured-java-");
    const home = join(root, "home");
    const bin = join(root, "bin");
    const marker = join(root, "java-executed");
    await mkdir(home);
    await mkdir(bin);
    // A host JVM is unrelated to an unconfigured Ghidra provider; running it
    // exposes setup to that process's cleanup outcome.
    await writeFile(
      join(bin, "java"),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> '${marker}'\nexit 1\n`,
      { mode: 0o755 },
    );
    const environment = {
      HOME: home,
      USERPROFILE: home,
      // The recording java shadows any host JVM in the system directories.
      PATH: `${bin}:/usr/bin:/bin`,
      HOPPER_LAUNCHER_PATH: join(root, "missing-hopper"),
    };
    const setup = await cli.run({
      arguments: ["setup", "--client", "claude_code", "--dry-run", "--json"],
      environment,
      timeoutMs: 20_000,
    });
    expect(setup.exitCode).toBe(1);
    expect(setup.stderr).toContain("InsideApp: 'setup' non è disponibile");
    const doctor = await cli.run({
      arguments: ["doctor", "--json"],
      environment,
      timeoutMs: 20_000,
    });
    expect(doctor.json).toMatchObject({
      providerInspections: expect.arrayContaining([
        expect.objectContaining({
          id: "ghidra",
          configured: false,
          checks: [
            expect.objectContaining({
              name: "configuration",
              code: "not_configured",
            }),
          ],
        }),
      ]),
    });
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
