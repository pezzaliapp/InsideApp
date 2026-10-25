import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";

import { TOOL_CONTRACTS } from "../../../src/contracts/toolContracts.js";
import { TOOL_EFFECTS } from "../../../src/contracts/toolEffects.js";
import {
  DYNAMIC_ANALYSIS_CLI_COMMANDS,
  DYNAMIC_ANALYSIS_ENVIRONMENT,
  DYNAMIC_ANALYSIS_TOOLS,
} from "../../../src/dynamicAnalysisPolicy.js";
import {
  createIsolatedHost,
  expectNoHostSideEffects,
  runLauncher,
} from "../../fixtures/insideappHost.js";

const TIMEOUT_MS = 180_000;

type Host = Awaited<ReturnType<typeof createIsolatedHost>>;

const allowing = (host: Host): Host => ({
  ...host,
  environment: { ...host.environment, [DYNAMIC_ANALYSIS_ENVIRONMENT]: "1" },
});

/** The project MCP server exactly as .mcp.json starts it. */
const connect = async (host: Host): Promise<Client> => {
  const client = new Client({ name: "insideapp-dynamic-test", version: "1" });
  onTestFinished(async () => {
    await client.close();
  });
  await client.connect(
    new StdioClientTransport({
      command: resolve("scripts/insideapp.sh"),
      args: ["mcp"],
      cwd: resolve("."),
      env: host.environment,
      stderr: "pipe",
    }),
  );
  return client;
};

/** A process scenario whose only effect is creating `marker`. */
const markerScenario = (marker: string) => ({
  executable: process.execPath,
  arguments: [
    "-e",
    `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`,
  ],
  timeout_ms: 20_000,
});

describe("InsideApp dynamic analysis policy", () => {
  it("covers every operation that runs foreign code or changes a device", () => {
    const required = Object.entries(TOOL_EFFECTS)
      .filter(
        ([, effects]) => effects.executesForeignCode || effects.mutatesDevice,
      )
      .map(([name]) => name);
    expect(
      required.filter((name) => !DYNAMIC_ANALYSIS_TOOLS.has(name)),
    ).toEqual([]);
    const names = new Set<string>(TOOL_CONTRACTS.map(({ name }) => name));
    for (const name of DYNAMIC_ANALYSIS_TOOLS) {
      expect(names.has(name), name).toBe(true);
      const effects = TOOL_EFFECTS[name]!;
      expect(effects.launchesProcess || effects.accessesNetwork, name).toBe(
        true,
      );
    }
    // Reports and the GUI use only static operations.
    for (const name of [
      "create_report",
      "analyze_javascript_application",
      "inspect_artifact",
      "inspect_desktop_application",
      "inspect_sqlite_database",
      "inspect_plist",
      "inspect_macho",
      "inspect_signature",
      "inspect_pe_imports",
      "inspect_managed_artifact",
    ]) {
      expect(DYNAMIC_ANALYSIS_TOOLS.has(name), name).toBe(false);
      expect(TOOL_EFFECTS[name]!.executesForeignCode, name).toBe(false);
    }
    expect([...DYNAMIC_ANALYSIS_CLI_COMMANDS].sort()).toEqual([
      "capture-browser-scenario",
      "capture-electron-scenario",
      "capture-native-ui-scenario",
      "capture-process",
      "cutter-command",
      "debug-with-gdb",
      "debug-with-rizin",
      "execute-rizin-command",
      "install-adb-package",
      "instrument-with-frida",
      "observe-native-calls",
      "observe-web-execution",
      "push-adb-file",
      "start-adb-activity",
      "start-adb-app",
      "stop-adb-app",
      "uninstall-adb-package",
    ]);
  });

  it(
    "refuses every dynamic CLI command before it runs, unless the user allows it",
    async () => {
      const host = await createIsolatedHost();
      for (const command of DYNAMIC_ANALYSIS_CLI_COMMANDS) {
        const result = await runLauncher(host, [command, "--json"]);
        expect(result.exitCode, command).toBe(1);
        expect(result.stdout, command).toBe("");
        expect(result.stderr, command).toContain(
          `InsideApp: '${command}' è un'analisi dinamica`,
        );
        expect(result.stderr, command).toContain(
          `${DYNAMIC_ANALYSIS_ENVIRONMENT}=1`,
        );
      }
      // Help describes a command without running it.
      const help = await runLauncher(host, ["capture-process", "--help"]);
      expect(help.exitCode, help.stderr).toBe(0);
      expect(help.stdout).toContain("capture-process");
      // Allowed, the command reaches its own argument checks instead.
      const allowed = await runLauncher(allowing(host), ["capture-process"]);
      expect(allowed.stderr).not.toContain("analisi dinamica");
      await expectNoHostSideEffects(host);
    },
    TIMEOUT_MS,
  );

  it(
    "refuses dynamic MCP tools without running the target, and runs them once allowed",
    async () => {
      const host = await createIsolatedHost();
      const marker = join(host.home, "..", "tmp", "ran.txt");
      const client = await connect(host);
      const tools = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(
          cursor === undefined ? {} : { cursor },
        );
        tools.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      // Still listed, so a client can explain why a call is refused.
      const listed = new Set(tools.map(({ name }) => name));
      for (const name of DYNAMIC_ANALYSIS_TOOLS)
        expect(listed.has(name), name).toBe(true);

      const refused = await client.callTool({
        name: "capture_process_scenario",
        arguments: markerScenario(marker),
      });
      expect(refused.isError).toBe(true);
      const text = (refused.content as { text: string }[])[0]!.text;
      expect(JSON.parse(text)).toMatchObject({
        error: {
          code: "capability_unavailable",
          message: expect.stringContaining(`${DYNAMIC_ANALYSIS_ENVIRONMENT}=1`),
        },
      });
      const device = await client.callTool({
        name: "start_adb_app",
        arguments: { serial: "emulator-5554", package: "com.example.app" },
      });
      expect(device.isError).toBe(true);
      expect(
        JSON.parse((device.content as { text: string }[])[0]!.text),
      ).toMatchObject({ error: { code: "capability_unavailable" } });
      expect(existsSync(marker)).toBe(false);
      await client.close();

      const allowed = await connect(allowing(host));
      const ran = await allowed.callTool({
        name: "capture_process_scenario",
        arguments: markerScenario(marker),
      });
      expect(ran.isError ?? false, JSON.stringify(ran.content)).toBe(false);
      expect(existsSync(marker)).toBe(true);
    },
    TIMEOUT_MS,
  );
});
