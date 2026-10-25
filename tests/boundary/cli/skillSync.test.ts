import { readdir } from "node:fs/promises";

import { describe, expect } from "vitest";

import { workspaceCliTest } from "../../support/cli/workspaceCliFixture.js";

const CLI_INTEGRATION_TIMEOUT_MS = 60_000;

describe("CLI skill lifecycle boundary", () => {
  workspaceCliTest(
    "refuses the global Incur skill installer without touching HOME",
    async ({ cli, workspace }) => {
      const help = await cli.run({
        arguments: ["--help"],
        environment: workspace.environment,
      });
      expect(help).toMatchObject({ exitCode: 0 });
      expect(help.stdout).not.toMatch(/^\s+skills\b/mu);

      const result = await cli.run({
        arguments: ["skills", "add"],
        environment: workspace.environment,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "InsideApp: 'skills add' non è disponibile",
      );
      await expect(readdir(workspace.home)).resolves.toEqual([]);
    },
    CLI_INTEGRATION_TIMEOUT_MS,
  );
});
