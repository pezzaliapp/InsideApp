import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { chromium } from "playwright-core";
import { describe, expect, it, onTestFinished } from "vitest";

import {
  createIsolatedHost,
  expectNoHostSideEffects,
} from "../../fixtures/insideappHost.js";

const execute = promisify(execFile);
const TIMEOUT_MS = 120_000;
/** The installed browser only; Playwright never downloads one here. */
const SYSTEM_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

interface StartedGui {
  readonly child: ChildProcess;
  readonly origin: string;
  readonly launcher: string;
  readonly output: () => { readonly stdout: string; readonly stderr: string };
  readonly exit: Promise<number | null>;
}

/** Start `gui --no-browser` through the project launcher and wait for its ready lines. */
const startGui = async (
  environment: Record<string, string>,
): Promise<StartedGui> => {
  const child = spawn(
    resolve("scripts/insideapp.sh"),
    ["gui", "--no-browser", "--json"],
    { cwd: resolve("."), env: environment, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout!.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr!.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const exit = new Promise<number | null>((resolveExit) =>
    child.once("close", resolveExit),
  );
  onTestFinished(async () => {
    if (child.exitCode === null) child.kill("SIGKILL");
    await exit;
  });
  const deadline = Date.now() + 30_000;
  while (!/file di avvio: .+ \(vale/u.test(stderr)) {
    if (Date.now() > deadline || child.exitCode !== null)
      throw new Error(`gui did not start: ${stderr}`);
    await new Promise((wait) => setTimeout(wait, 50));
  }
  return {
    child,
    origin: /avviata su (http:\/\/127\.0\.0\.1:\d+) /u.exec(stderr)![1]!,
    launcher: /file di avvio: (.+) \(vale/u.exec(stderr)![1]!,
    output: () => ({ stdout, stderr }),
    exit,
  };
};

const launchToken = async (launcher: string): Promise<string> =>
  /\/avvio#([A-Za-z0-9_-]{43})"/u.exec(await readFile(launcher, "utf8"))![1]!;

const post = (origin: string, path: string, body: string, cookie?: string) =>
  new Promise<{ status: number; cookie: string | undefined }>(
    (resolvePost, reject) => {
      const url = new URL(origin);
      const request = httpRequest(
        {
          host: url.hostname,
          port: url.port,
          method: "POST",
          path,
          headers: {
            Origin: origin,
            "X-InsideApp-Request": "1",
            "Content-Type": "application/json",
            "Content-Length": String(Buffer.byteLength(body)),
            ...(cookie === undefined ? {} : { Cookie: cookie }),
          },
        },
        (response) => {
          response.resume();
          response.on("end", () =>
            resolvePost({
              status: response.statusCode ?? 0,
              cookie: response.headers["set-cookie"]?.[0]?.split(";", 1)[0],
            }),
          );
        },
      );
      request.on("error", reject);
      request.end(body);
    },
  );

const portIsClosed = async (origin: string): Promise<boolean> =>
  fetch(`${origin}/`).then(
    () => false,
    () => true,
  );

describe("InsideApp gui command", () => {
  it(
    "serves a session, keeps the token out of output and process arguments, and stops on Ctrl+C",
    async () => {
      const host = await createIsolatedHost();
      const gui = await startGui(host.environment);
      const token = await launchToken(gui.launcher);
      expect(gui.launcher.startsWith(resolve(".cache/gui"))).toBe(true);
      const { stdout: processes } = await execute("ps", [
        "-axww",
        "-o",
        "command=",
      ]);
      expect(processes).not.toContain(token);
      expect(gui.output().stderr).not.toContain(token);

      const session = await post(
        gui.origin,
        "/api/session",
        JSON.stringify({ token }),
      );
      expect(session.status).toBe(204);
      expect(
        (await post(gui.origin, "/api/session", JSON.stringify({ token })))
          .status,
      ).toBe(403);

      gui.child.kill("SIGINT");
      expect(await gui.exit).toBe(130);
      expect(JSON.parse(gui.output().stdout)).toEqual({
        status: "stopped",
        reason: "interrupted",
      });
      expect(gui.output().stdout + gui.output().stderr).not.toContain(token);
      expect(await portIsClosed(gui.origin)).toBe(true);
      await expect(readdir(dirname(gui.launcher))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expectNoHostSideEffects(host);
    },
    TIMEOUT_MS,
  );

  it.skipIf(!existsSync(SYSTEM_CHROME))(
    "opens in the installed Chrome without external requests or policy violations (requires Chrome)",
    async () => {
      const host = await createIsolatedHost();
      const gui = await startGui(host.environment);
      const token = await launchToken(gui.launcher);
      const browser = await chromium.launch({
        executablePath: SYSTEM_CHROME,
        headless: true,
        args: [
          "--disable-background-networking",
          "--disable-component-update",
          "--no-pings",
        ],
      });
      onTestFinished(() => browser.close());
      const context = await browser.newContext();
      const page = await context.newPage();
      const external: string[] = [];
      await context.route("**/*", (route) => {
        const url = route.request().url();
        if (url.startsWith(`${gui.origin}/`) || url.startsWith("file://"))
          return route.continue();
        external.push(url);
        return route.abort();
      });
      const problems: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning")
          problems.push(message.text());
      });
      page.on("pageerror", (error) => problems.push(error.message));

      await page.goto(`file://${gui.launcher}`);
      await page.waitForURL(`${gui.origin}/`);
      await expect
        .poll(() => page.locator("#engine-state").textContent())
        .toBe("Motore pronto, solo in locale.");
      expect(await page.locator("#claude-state").textContent()).toBe(
        "Server MCP di progetto configurato (.mcp.json).",
      );
      expect(await page.locator("h1").textContent()).toBe(
        "InsideApp — PezzaliAPP",
      );
      expect(page.url()).not.toContain(token);
      expect(await page.evaluate("document.cookie")).toBe("");
      expect(await context.cookies()).toEqual([
        expect.objectContaining({
          name: "insideapp_session",
          httpOnly: true,
          sameSite: "Strict",
        }),
      ]);
      // Keyboard reaches the controls in order.
      await page.keyboard.press("Tab");
      expect(await page.evaluate("document.activeElement?.id")).toBe("refresh");

      await page.locator("#shutdown").click();
      await expect
        .poll(() => page.locator("#session-state").textContent())
        .toBe("InsideApp è stato chiuso. Puoi chiudere questa scheda.");
      expect(await gui.exit).toBe(0);
      expect(JSON.parse(gui.output().stdout)).toEqual({
        status: "stopped",
        reason: "shutdown",
      });
      expect(external).toEqual([]);
      expect(problems).toEqual([]);
      expect(await portIsClosed(gui.origin)).toBe(true);
      await expectNoHostSideEffects(host);
    },
    TIMEOUT_MS,
  );
});
