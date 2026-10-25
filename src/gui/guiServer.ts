import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { listenHttpServer } from "../server/http/listenHttpServer.js";
import {
  GUI_APP_HTML,
  GUI_APP_JS,
  GUI_CSS,
  GUI_LOCKED_HTML,
  GUI_START_HTML,
  GUI_START_JS,
} from "./guiAssets.js";
import { writeGuiLauncher, type GuiLauncher } from "./guiLauncher.js";
import {
  GUI_EXPIRED_COOKIE,
  GUI_HOST,
  GUI_SECURITY_HEADERS,
  guiRequestRefusal,
  guiSessionCookie,
  guiSessionCookieHeader,
} from "./guiSecurity.js";
import { GUI_LAUNCH_TOKEN_LIFETIME_MS, GuiSession } from "./guiSession.js";
import { guiEngineStatus } from "./guiStatus.js";

/** Largest accepted request body; every API body is a tiny JSON object. */
export const GUI_MAX_BODY_BYTES = 4096;

export type GuiStopReason = "interrupted" | "idle" | "shutdown";

export interface GuiServerOptions {
  readonly projectRoot: string;
  readonly launcherDirectory: string;
  /** Close after this long without an authenticated request. */
  readonly idleTimeoutMs: number;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}

export interface RunningGui {
  /** `http://127.0.0.1:<port>`; contains no secret. */
  readonly origin: string;
  readonly launcher: GuiLauncher;
  /** Settles once the listener, connections, timers and launch file are released. */
  readonly stopped: Promise<GuiStopReason>;
  readonly stop: (reason: GuiStopReason) => Promise<GuiStopReason>;
}

type Reply = (
  status: number,
  body: string,
  type: string,
  extra?: Readonly<Record<string, string>>,
) => void;

const replier =
  (response: ServerResponse): Reply =>
  (status, body, type, extra = {}) => {
    if (response.headersSent) return;
    response.writeHead(status, {
      ...GUI_SECURITY_HEADERS,
      "Content-Type": type,
      "Content-Length": String(Buffer.byteLength(body)),
      ...extra,
    });
    response.end(body);
  };

const HTML = "text/html; charset=utf-8";
const JSON_TYPE = "application/json; charset=utf-8";
const json = (reply: Reply, status: number, value: unknown, extra = {}) =>
  reply(status, JSON.stringify(value), JSON_TYPE, extra);

const STATIC_ASSETS: Readonly<
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
  "/avvio": { body: GUI_START_HTML, type: HTML },
};

const ROUTE_METHODS: Readonly<Record<string, string>> = {
  "/": "GET",
  ...Object.fromEntries(
    Object.keys(STATIC_ASSETS).map((path) => [path, "GET"]),
  ),
  "/api/status": "GET",
  "/api/session": "POST",
  "/api/shutdown": "POST",
};

/** Read a declared-length JSON body; anything else is refused before parsing. */
const readJsonBody = async (
  request: IncomingMessage,
): Promise<
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly status: number }
> => {
  const type = request.headers["content-type"] ?? "";
  if (!/^application\/json(?:;\s*charset=utf-8)?$/iu.test(type))
    return { ok: false, status: 415 };
  if (request.headers["transfer-encoding"] !== undefined)
    return { ok: false, status: 411 };
  const declared = Number(request.headers["content-length"]);
  if (!Number.isSafeInteger(declared)) return { ok: false, status: 411 };
  if (declared > GUI_MAX_BODY_BYTES) return { ok: false, status: 413 };
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    received += chunk.byteLength;
    if (received > GUI_MAX_BODY_BYTES) return { ok: false, status: 413 };
    chunks.push(chunk);
  }
  try {
    return {
      ok: true,
      value: JSON.parse(Buffer.concat(chunks).toString("utf8")),
    };
  } catch {
    return { ok: false, status: 400 };
  }
};

const launchTokenOf = (value: unknown): string | undefined =>
  typeof value === "object" &&
  value !== null &&
  "token" in value &&
  typeof value.token === "string" &&
  value.token.length <= 128
    ? value.token
    : undefined;

interface GuiState {
  readonly origin: string;
  readonly session: GuiSession;
  readonly options: GuiServerOptions;
  readonly now: () => number;
  readonly touch: () => void;
  readonly launcher: () => GuiLauncher | undefined;
  readonly stop: (reason: GuiStopReason) => Promise<GuiStopReason>;
}

const handleApi = async (
  state: GuiState,
  path: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  const reply = replier(response);
  if (path === "/api/session") {
    const body = await readJsonBody(request);
    if (!body.ok) return json(reply, body.status, { error: "invalid_request" });
    const token = launchTokenOf(body.value);
    if (token === undefined)
      return json(reply, 400, { error: "invalid_request" });
    const outcome = state.session.redeem(token, state.now());
    if (!outcome.ok)
      return json(reply, 403, { error: `launch_${outcome.reason}` });
    // The token leaves the disk before the session cookie exists.
    await state.launcher()?.remove();
    state.touch();
    return reply(204, "", JSON_TYPE, {
      "Set-Cookie": guiSessionCookieHeader(outcome.session),
    });
  }
  if (!state.session.isActive(guiSessionCookie(request)))
    return json(reply, 401, { error: "session_required" });
  state.touch();
  if (path === "/api/status")
    return json(reply, 200, {
      engine: await guiEngineStatus(state.options.projectRoot),
      session: {
        idle_timeout_seconds: Math.round(state.options.idleTimeoutMs / 1000),
      },
    });
  const body = await readJsonBody(request);
  if (!body.ok) return json(reply, body.status, { error: "invalid_request" });
  // Stop only after the reply is flushed; closing first would cut it off.
  response.once("close", () => void state.stop("shutdown"));
  json(reply, 202, { status: "closing" }, { "Set-Cookie": GUI_EXPIRED_COOKIE });
};

const handleRequest = async (
  state: GuiState,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  const reply = replier(response);
  const path = (request.url ?? "").split("?", 1)[0] ?? "";
  const method = ROUTE_METHODS[path];
  const api = path.startsWith("/api/");
  const refusal = guiRequestRefusal(
    request,
    state.origin,
    api ? "api" : "page",
  );
  if (refusal !== undefined)
    return json(reply, 403, { error: `refused_${refusal}` });
  if (method === undefined) return json(reply, 404, { error: "not_found" });
  if (request.method !== method)
    return json(reply, 405, { error: "method_not_allowed" }, { Allow: method });
  if (api) return handleApi(state, path, request, response);
  if (path === "/") {
    if (!state.session.isActive(guiSessionCookie(request)))
      return reply(401, GUI_LOCKED_HTML, HTML);
    state.touch();
    return reply(200, GUI_APP_HTML, HTML);
  }
  const asset = STATIC_ASSETS[path]!;
  reply(200, asset.body, asset.type);
};

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });

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
  let state: GuiState | undefined;
  const server = createServer(
    {
      maxHeaderSize: 8192,
      requestTimeout: 10_000,
      headersTimeout: 5_000,
      keepAliveTimeout: 2_000,
    },
    (request, response) => {
      if (state === undefined) return void response.destroy();
      handleRequest(state, request, response).catch(() => {
        replier(response)(
          500,
          JSON.stringify({ error: "internal" }),
          JSON_TYPE,
        );
      });
    },
  );
  server.maxConnections = 16;
  await listenHttpServer(server, GUI_HOST, 0, options.signal);
  const address = server.address();
  if (
    typeof address !== "object" ||
    address === null ||
    address.address !== GUI_HOST
  ) {
    await closeServer(server);
    throw new Error("InsideApp GUI did not bind the loopback address");
  }
  const origin = `http://${GUI_HOST}:${address.port}`;
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
  const stop = (reason: GuiStopReason): Promise<GuiStopReason> =>
    (stopping ??= (async () => {
      clearTimeout(idle);
      clearTimeout(expiry);
      options.signal?.removeEventListener("abort", interrupted);
      session.end();
      await closeServer(server);
      await launcher.remove();
      resolveStopped(reason);
      return reason;
    })());
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => void stop("idle"), options.idleTimeoutMs);
  };
  const interrupted = () => void stop("interrupted");
  options.signal?.addEventListener("abort", interrupted, { once: true });
  if (options.signal?.aborted === true) void stop("interrupted");
  touch();
  state = {
    origin,
    session,
    options,
    now,
    touch,
    launcher: () => launcher,
    stop,
  };
  return { origin, launcher, stopped, stop };
};
