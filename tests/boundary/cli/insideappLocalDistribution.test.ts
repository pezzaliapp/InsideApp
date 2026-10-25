import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";

import { TOOL_CONTRACTS } from "../../../src/contracts/toolContracts.js";
import {
  createIsolatedHost,
  expectNoHostSideEffects,
  runLauncher,
} from "../../fixtures/insideappHost.js";

const repository = resolve(".");

const TIMEOUT_MS = 180_000;

const writeDemoApplication = async (root: string): Promise<string> => {
  const application = join(root, "demo-app");
  await mkdir(application);
  await writeFile(
    join(application, "package.json"),
    JSON.stringify({ name: "demo-app", version: "1.0.0", main: "main.js" }),
  );
  await writeFile(
    join(application, "main.js"),
    [
      'const { ipcMain } = require("electron");',
      'const { writeFileSync } = require("node:fs");',
      'ipcMain.handle("preferences:save", (_event, value) => writeFileSync("prefs.json", JSON.stringify(value)));',
      "",
    ].join("\n"),
  );
  return application;
};

describe("InsideApp local distribution", () => {
  it(
    "detects connection attempts and package runners in the isolated host",
    async () => {
      // Control: the guard must observe what the other cases assert is absent.
      const host = await createIsolatedHost();
      const probe = await new Promise<number | null>((resolvePromise) => {
        const child = spawn(
          process.execPath,
          [
            "-e",
            [
              'require("node:child_process").spawnSync("npx", ["-y", "probe"]);',
              'fetch("https://registry.npmjs.org/").catch(() => {}).finally(() => process.exit(0));',
            ].join("\n"),
          ],
          { env: host.environment, stdio: "ignore" },
        );
        child.once("close", resolvePromise);
      });
      expect(probe).toBe(0);
      expect(await host.runnerCalls()).toBe("npx -y probe\n");
      expect(await host.activity()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "fetch",
            detail: { url: "https://registry.npmjs.org/" },
          }),
          expect.objectContaining({ kind: "connect" }),
        ]),
      );
    },
    TIMEOUT_MS,
  );

  it(
    "refuses every global installation and agent-configuration command",
    async () => {
      const host = await createIsolatedHost();
      for (const args of [
        ["setup"],
        ["setup", "--client", "claude_code", "--yes"],
        ["--json", "setup", "--dry-run"],
        ["uninstall", "--yes"],
        ["update"],
        ["update", "--yes"],
        ["--update"],
        ["providers", "--update"],
        ["mcp", "add"],
        ["mcp", "add", "--agent", "claude-code"],
        ["skills", "add"],
      ]) {
        const result = await runLauncher(host, args);
        expect(result.exitCode, JSON.stringify(args)).toBe(1);
        expect(result.stdout, JSON.stringify(args)).toBe("");
        expect(result.stderr, JSON.stringify(args)).toMatch(
          /^InsideApp: .* non è disponibile perché /u,
        );
      }
      await expectNoHostSideEffects(host);
    },
    TIMEOUT_MS,
  );

  it(
    "marks the refused commands as unavailable in help",
    async () => {
      const host = await createIsolatedHost();
      const help = await runLauncher(host, ["--help"]);
      expect(help.exitCode, help.stderr).toBe(0);
      expect(help.stdout).toMatch(/^Usage: insideapp /mu);
      for (const command of ["setup", "uninstall", "update"])
        expect(help.stdout).toMatch(
          new RegExp(`^\\s+${command}\\s+Non disponibile in InsideApp`, "mu"),
        );
      await expectNoHostSideEffects(host);
    },
    TIMEOUT_MS,
  );

  it(
    "analyzes a local application without network, package runners, or HOME writes",
    async () => {
      const host = await createIsolatedHost();
      const application = await writeDemoApplication(
        join(host.home, "..", "tmp"),
      );
      const version = await runLauncher(host, ["--version"]);
      expect(version.exitCode, version.stderr).toBe(0);

      const analysis = await runLauncher(host, [
        "analyze-javascript-application",
        application,
        "--json",
      ]);
      expect(analysis.exitCode, analysis.stderr).toBe(0);
      expect(analysis.stdout).toContain("preferences:save");

      const doctor = await runLauncher(host, ["doctor", "--json"]);
      expect(JSON.parse(doctor.stdout)).toMatchObject({
        providerInspections: expect.arrayContaining([
          expect.objectContaining({ id: "ghidra", configured: false }),
        ]),
      });
      await expectNoHostSideEffects(host);
    },
    TIMEOUT_MS,
  );
});

describe("InsideApp project MCP server", () => {
  it(
    "declares only the project-local stdio launcher",
    async () => {
      expect(JSON.parse(await readFile(".mcp.json", "utf8"))).toEqual({
        mcpServers: {
          insideapp: {
            type: "stdio",
            command: "./scripts/insideapp.sh",
            args: ["mcp"],
          },
        },
      });
    },
    TIMEOUT_MS,
  );

  it(
    "serves the complete catalog and a local analysis through .mcp.json",
    async () => {
      const host = await createIsolatedHost();
      const application = await writeDemoApplication(
        join(host.home, "..", "tmp"),
      );
      const transport = new StdioClientTransport({
        command: resolve("scripts/insideapp.sh"),
        args: ["mcp"],
        cwd: repository,
        env: host.environment,
        stderr: "pipe",
      });
      const client = new Client({ name: "insideapp-local", version: "1" });
      onTestFinished(async () => {
        await client.close();
      });
      await client.connect(transport);

      expect(client.getServerVersion()).toMatchObject({
        title: "InsideApp — PezzaliAPP",
      });
      const names: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(
          cursor === undefined ? {} : { cursor },
        );
        names.push(...page.tools.map(({ name }) => name));
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      expect(names).toHaveLength(TOOL_CONTRACTS.length);
      expect(new Set(names).size).toBe(TOOL_CONTRACTS.length);
      expect(names.sort()).toEqual(
        TOOL_CONTRACTS.map(({ name }) => name).sort(),
      );

      const result = await client.callTool({
        name: "analyze_javascript_application",
        arguments: { input_path: application, detail: "summary" },
      });
      expect(
        result.isError ?? false,
        JSON.stringify(result).slice(0, 2000),
      ).toBe(false);
      await client.close();
      await expectNoHostSideEffects(host);
    },
    TIMEOUT_MS,
  );
});
