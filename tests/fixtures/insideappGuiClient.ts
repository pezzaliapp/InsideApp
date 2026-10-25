// HTTP client for InsideApp GUI tests: raw requests so tests control Host,
// Origin and every other header, plus a started and signed-in server.
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { readFile } from "node:fs/promises";

import { expect, onTestFinished } from "vitest";

import {
  startGuiServer,
  type GuiServerOptions,
  type RunningGui,
} from "../../src/gui/guiServer.js";
import { createTestTempDirectory } from "./temporaryDirectory.js";

export interface Sent {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
}

/** Raw HTTP so tests control Host, Origin and every other header. */
export const send = (
  gui: RunningGui,
  {
    method = "GET",
    path = "/",
    headers = {},
    body,
  }: {
    readonly method?: string;
    readonly path?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string | undefined;
  } = {},
): Promise<Sent> =>
  new Promise((resolve, reject) => {
    const url = new URL(gui.origin);
    const request = httpRequest(
      {
        host: url.hostname,
        port: url.port,
        method,
        path,
        headers: { Host: url.host, ...headers },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => (text += chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: text,
          }),
        );
      },
    );
    request.on("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });

export const apiHeaders = (
  gui: RunningGui,
  cookie?: string,
): Record<string, string> => ({
  Origin: gui.origin,
  "Sec-Fetch-Site": "same-origin",
  "X-InsideApp-Request": "1",
  ...(cookie === undefined ? {} : { Cookie: cookie }),
});

export const jsonPost = (
  gui: RunningGui,
  path: string,
  value: unknown,
  cookie?: string,
) => {
  const body = JSON.stringify(value);
  return send(gui, {
    method: "POST",
    path,
    headers: {
      ...apiHeaders(gui, cookie),
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body)),
    },
    body,
  });
};

export const launchToken = async (gui: RunningGui): Promise<string> => {
  const page = await readFile(gui.launcher.path, "utf8");
  const match =
    /url=http:\/\/127\.0\.0\.1:\d+\/avvio#([A-Za-z0-9_-]{43})"/u.exec(page);
  if (match === null) throw new Error("launch page has no token");
  return match[1]!;
};

export const startGui = async (
  overrides: Partial<
    Omit<GuiServerOptions, "projectRoot" | "launcherDirectory">
  > = {},
) => {
  const root = await createTestTempDirectory("rea-insideapp-gui-");
  const gui = await startGuiServer({
    projectRoot: root,
    launcherDirectory: `${root}/.cache/gui`,
    idleTimeoutMs: 60_000,
    ...overrides,
  });
  onTestFinished(async () => {
    await gui.stop("shutdown");
  });
  return { gui, root };
};

/** Start, redeem the launch token and return the session cookie. */
export const signedIn = async (
  overrides: Parameters<typeof startGui>[0] = {},
) => {
  const started = await startGui(overrides);
  const response = await jsonPost(started.gui, "/api/session", {
    token: await launchToken(started.gui),
  });
  expect(response.status).toBe(204);
  const cookie = String(response.headers["set-cookie"]).split(";", 1)[0]!;
  return { ...started, cookie };
};

export const refusesConnections = (gui: RunningGui): Promise<boolean> =>
  new Promise((resolve) => {
    const url = new URL(gui.origin);
    const socket = connect(Number(url.port), url.hostname);
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(true));
  });
