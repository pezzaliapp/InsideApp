// Isolated host for InsideApp launcher tests: a temporary HOME, recording
// package runners on PATH, and a network guard loaded into every Node process.
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { expect } from "vitest";
import { z } from "zod";

import { createTestTempDirectory } from "./temporaryDirectory.js";

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
  // IP literals resolve inside Node without a resolver query (dns.lookup returns them directly).
  dns[name] = function (host, ...rest) { if (!net.isIP(String(host))) record("dns", { host }); return original.call(this, host, ...rest); };
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
export const createIsolatedHost = async (): Promise<IsolatedHost> => {
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
export const runLauncher = (
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
export const expectNoHostSideEffects = async (
  host: IsolatedHost,
): Promise<void> => {
  expect(await host.activity()).toEqual([]);
  expect(await host.runnerCalls()).toBe("");
  expect(await host.homeEntries()).toEqual([]);
};
