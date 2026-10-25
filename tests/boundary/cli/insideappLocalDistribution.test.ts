import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";

import { TOOL_CONTRACTS } from "../../../src/contracts/toolContracts.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const TIMEOUT_MS = 180_000;
const repository = resolve(".");
/** Package runners and agent CLIs a refused command could otherwise launch. */
const RECORDED_COMMANDS = ["npm", "npx", "pnpm", "yarn", "bunx", "claude"];

/**
 * Record outbound host connections, DNS lookups, UDP sockets, and package
 * runner spawns in every Node process of the family. Host connections fail
 * before any traffic; Unix sockets and stdio stay available.
 */
const NETWORK_GUARD = String.raw`
const { appendFileSync } = require("node:fs");
const { basename } = require("node:path");
const log = process.env.INSIDEAPP_TEST_ACTIVITY_LOG;
const record = (kind, detail) =>
  appendFileSync(log, JSON.stringify({ pid: process.pid, kind, detail }) + "\n");
const net = require("node:net");
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const local = typeof first === "string" || (first !== null && typeof first === "object" && first.path !== undefined);
  if (local) return connect.apply(this, args);
  const target = first !== null && typeof first === "object" ? { host: first.host, port: first.port } : { port: first, host: args[1] };
  record("connect", target);
  process.nextTick(() => this.destroy(new Error("InsideApp test: network blocked")));
  return this;
};
const dns = require("node:dns");
for (const name of ["lookup", "resolve", "resolve4", "resolve6"]) {
  const original = dns[name];
  dns[name] = function (host, ...rest) { record("dns", { host }); return original.call(this, host, ...rest); };
}
const dgram = require("node:dgram");
const createSocket = dgram.createSocket;
dgram.createSocket = function (...args) { record("udp", {}); return createSocket.apply(this, args); };
if (typeof globalThis.fetch === "function") {
  const fetch = globalThis.fetch;
  globalThis.fetch = function (input, init) { record("fetch", { url: String(input?.url ?? input) }); return fetch.call(this, input, init); };
}
const { ChildProcess } = require("node:child_process");
const spawn = ChildProcess.prototype.spawn;
const runners = new Set(${JSON.stringify(RECORDED_COMMANDS)});
ChildProcess.prototype.spawn = function (options) {
  const words = [options.file, ...(options.args ?? [])].map(String);
  if (words.some((word) => runners.has(basename(word).replace(/\.(?:cmd|exe)$/u, "")) || /np[mx]-cli\.js$/u.test(word)))
    record("spawn", { args: words });
  return spawn.call(this, options);
};
`;

const activityEntrySchema = z.object({
  pid: z.number(),
  kind: z.string(),
  detail: z.unknown(),
});

interface IsolatedHost {
  readonly home: string;
  readonly environment: Record<string, string>;
  readonly activity: () => Promise<readonly unknown[]>;
  readonly runnerCalls: () => Promise<string>;
  readonly homeEntries: () => Promise<readonly string[]>;
}

/** A fresh HOME, recording package runners on PATH, and the network guard. */
const createIsolatedHost = async (): Promise<IsolatedHost> => {
  const root = await createTestTempDirectory("rea-insideapp-local-");
  const home = join(root, "home");
  const bin = join(root, "bin");
  const temporary = join(root, "tmp");
  await Promise.all([home, bin, temporary].map((path) => mkdir(path)));
  const activityLog = join(root, "activity.jsonl");
  const runnerLog = join(root, "runners.log");
  const guard = join(root, "network-guard.cjs");
  await writeFile(activityLog, "");
  await writeFile(runnerLog, "");
  await writeFile(guard, NETWORK_GUARD);
  for (const command of RECORDED_COMMANDS)
    await writeFile(
      join(bin, command),
      `#!/bin/sh\nprintf '%s %s\\n' '${command}' "$*" >> '${runnerLog}'\nexit 1\n`,
      { mode: 0o755 },
    );
  // NO_UPDATE_NOTIFIER is deliberately absent: InsideApp must set it itself.
  const environment: Record<string, string> = {
    HOME: home,
    USERPROFILE: home,
    TMPDIR: temporary,
    PATH: `${bin}:/usr/bin:/bin`,
    NODE_OPTIONS: `--require=${guard}`,
    INSIDEAPP_TEST_ACTIVITY_LOG: activityLog,
    INSIDEAPP_NODE: process.execPath,
    REA_LOG_LEVEL: "silent",
    NO_COLOR: "1",
  };
  const homeEntries = async (): Promise<readonly string[]> =>
    (await readdir(home, { recursive: true })).map((entry) =>
      relative(home, join(home, entry)),
    );
  return {
    home,
    environment,
    activity: async () =>
      (await readFile(activityLog, "utf8"))
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => activityEntrySchema.parse(JSON.parse(line))),
    runnerCalls: () => readFile(runnerLog, "utf8"),
    homeEntries,
  };
};

interface LauncherResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run the project launcher exactly as `.mcp.json` and the README do. */
const runLauncher = (
  host: IsolatedHost,
  arguments_: readonly string[],
): Promise<LauncherResult> =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(resolve("scripts/insideapp.sh"), arguments_, {
      cwd: repository,
      env: host.environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Launcher timed out: ${arguments_.join(" ")}`));
    }, 60_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      resolvePromise({ exitCode, stdout, stderr });
    });
  });

/** Assert the host side effects InsideApp promises for every command. */
const expectNoHostSideEffects = async (host: IsolatedHost): Promise<void> => {
  expect(await host.activity()).toEqual([]);
  expect(await host.runnerCalls()).toBe("");
  expect(await host.homeEntries()).toEqual([]);
};

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
