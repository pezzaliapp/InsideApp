import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Logger } from "pino";

import { createLogger } from "../logger.js";
import { listenHttpServer } from "../server/http/listenHttpServer.js";
import { GuiAnalyses } from "./guiAnalyses.js";
import { handleGuiApi, type GuiContext, type GuiStopReason } from "./guiApi.js";
import {
  GUI_APP_HTML,
  GUI_APP_JS,
  GUI_CSS,
  GUI_LOCKED_HTML,
  GUI_START_HTML,
  GUI_START_JS,
} from "./guiAssets.js";
import { HTML_TYPE, JSON_TYPE, json, replier } from "./guiHttp.js";
import { writeGuiLauncher, type GuiLauncher } from "./guiLauncher.js";
import {
  GUI_HOST,
  guiRequestRefusal,
  guiSessionCookie,
} from "./guiSecurity.js";
import { GUI_LAUNCH_TOKEN_LIFETIME_MS, GuiSession } from "./guiSession.js";
import { GuiTargets, systemPicker, type GuiPicker } from "./guiTargets.js";

export { GUI_MAX_BODY_BYTES } from "./guiHttp.js";
export type { GuiStopReason } from "./guiApi.js";

export interface GuiServerOptions {
  readonly projectRoot: string;
  readonly launcherDirectory: string;
  /** Close after this long without an authenticated request. */
  readonly idleTimeoutMs: number;
  /** Environment for analyses, as the CLI snapshots it. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly logger?: Logger;
  /** Home folder, refused as a target; the CLI passes the session's home. */
  readonly homeDirectory?: string;
  /** Native file dialog; tests substitute a port that returns fixed choices. */
  readonly picker?: GuiPicker;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}

export interface RunningGui {
  /** `http://127.0.0.1:<port>`; contains no secret. */
  readonly origin: string;
  readonly launcher: GuiLauncher;
  /** Settles once the listener, analyses, timers and launch file are released. */
  readonly stopped: Promise<GuiStopReason>;
  readonly stop: (reason: GuiStopReason) => Promise<GuiStopReason>;
}

const PAGES: Readonly<
  Record<string, { readonly body: string; readonly type: string }>
> = {
  "/assets/app.css": { body: GUI_CSS, type: "text/css; charset=utf-8" },
  "/assets/start.js": {
    body: GUI_START_JS,
    type: "text/javascript; charset=utf-8",
  },
  "/assets/app.js": {
    body: GUI_APP_JS,
    type: "text/javascript; charset=utf-8",
  },
  "/avvio": { body: GUI_START_HTML, type: HTML_TYPE },
};

const handleRequest = async (
  context: GuiContext,
  origin: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  const reply = replier(response);
  const path = (request.url ?? "").split("?", 1)[0] ?? "";
  const api = path.startsWith("/api/");
  const refusal = guiRequestRefusal(request, origin, api ? "api" : "page");
  if (refusal !== undefined)
    return json(reply, 403, { error: `refused_${refusal}` });
  if (api) return handleGuiApi(context, path, request, response);
  const page = path === "/" ? undefined : PAGES[path];
  if (path !== "/" && page === undefined)
    return json(reply, 404, { error: "not_found" });
  if (request.method !== "GET")
    return json(reply, 405, { error: "method_not_allowed" }, { Allow: "GET" });
  if (page !== undefined) return reply(200, page.body, page.type);
  if (!context.session.isActive(guiSessionCookie(request)))
    return reply(401, GUI_LOCKED_HTML, HTML_TYPE);
  context.touch();
  reply(200, GUI_APP_HTML, HTML_TYPE);
};

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });

const listenOnLoopback = async (
  server: Server,
  signal: AbortSignal | undefined,
): Promise<string> => {
  await listenHttpServer(server, GUI_HOST, 0, signal);
  const address = server.address();
  if (
    typeof address !== "object" ||
    address === null ||
    address.address !== GUI_HOST
  ) {
    await closeServer(server);
    throw new Error("InsideApp GUI did not bind the loopback address");
  }
  return `http://${GUI_HOST}:${address.port}`;
};

/**
 * Start the GUI listener on 127.0.0.1 with an OS-assigned port and write the
 * owner-only launch file. The server refuses to run if it did not bind the
 * loopback address it asked for.
 */
export const startGuiServer = async (
  options: GuiServerOptions,
): Promise<RunningGui> => {
  const now = options.now ?? Date.now;
  const session = new GuiSession(now());
  let context: GuiContext | undefined;
  let origin = "";
  const server = createServer(
    {
      maxHeaderSize: 8192,
      requestTimeout: 10_000,
      headersTimeout: 5_000,
      keepAliveTimeout: 2_000,
    },
    (request, response) => {
      if (context === undefined) return void response.destroy();
      handleRequest(context, origin, request, response).catch(() => {
        replier(response)(
          500,
          JSON.stringify({ error: "internal" }),
          JSON_TYPE,
        );
      });
    },
  );
  server.maxConnections = 16;
  origin = await listenOnLoopback(server, options.signal);
  let launcher: GuiLauncher;
  try {
    launcher = await writeGuiLauncher(
      options.launcherDirectory,
      `${origin}/avvio#${session.launchToken}`,
    );
  } catch (cause: unknown) {
    await closeServer(server);
    throw cause;
  }

  const analyses = new GuiAnalyses(
    options.environment ?? {},
    options.logger ?? createLogger("cli", "silent"),
    now,
  );
  const picker = new AbortController();
  let resolveStopped!: (reason: GuiStopReason) => void;
  const stopped = new Promise<GuiStopReason>((resolve) => {
    resolveStopped = resolve;
  });
  let stopping: Promise<GuiStopReason> | undefined;
  let idle: NodeJS.Timeout | undefined;
  const expiry = setTimeout(
    () => void launcher.remove(),
    GUI_LAUNCH_TOKEN_LIFETIME_MS,
  );
  const interrupted = () => void stop("interrupted");
  const stop = (reason: GuiStopReason): Promise<GuiStopReason> =>
    (stopping ??= (async () => {
      clearTimeout(idle);
      clearTimeout(expiry);
      options.signal?.removeEventListener("abort", interrupted);
      session.end();
      picker.abort();
      await closeServer(server);
      // Running work is cancelled and awaited; the worker is released.
      await analyses.close();
      await launcher.remove();
      resolveStopped(reason);
      return reason;
    })());
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => void stop("idle"), options.idleTimeoutMs);
  };
  options.signal?.addEventListener("abort", interrupted, { once: true });
  if (options.signal?.aborted === true) void stop("interrupted");
  touch();
  context = {
    projectRoot: options.projectRoot,
    idleTimeoutMs: options.idleTimeoutMs,
    homeDirectory: options.homeDirectory,
    session,
    targets: new GuiTargets(),
    analyses,
    picker: options.picker ?? systemPicker,
    pickerSignal: picker.signal,
    now,
    touch,
    removeLauncher: () => launcher.remove(),
    stop,
    pickerOpen: false,
  };
  return { origin, launcher, stopped, stop };
};
