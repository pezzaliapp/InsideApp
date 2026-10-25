import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/** Loopback address the GUI listens on; never a wildcard or LAN address. */
export const GUI_HOST = "127.0.0.1";

/** Header every API request must carry; cross-origin pages cannot add it without a preflight the server never grants. */
export const GUI_REQUEST_HEADER = "x-insideapp-request";

export const GUI_SESSION_COOKIE = "insideapp_session";

/**
 * Page policy: same-origin script and style only, no inline code, no framing,
 * no forms and no external connections.
 */
export const GUI_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** Headers sent with every response, including refusals. */
export const GUI_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": GUI_CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), clipboard-read=(), usb=()",
};

/** A 256-bit random secret, URL-safe. */
export const createGuiSecret = (): string =>
  randomBytes(32).toString("base64url");

/** Constant-time comparison that also hides length differences. */
export const guiSecretsEqual = (candidate: string, expected: string): boolean =>
  timingSafeEqual(
    createHash("sha256").update(candidate).digest(),
    createHash("sha256").update(expected).digest(),
  );

/** Why a request was refused before routing; undefined when it may proceed. */
export type GuiRequestRefusal =
  | "host"
  | "origin"
  | "fetch-site"
  | "request-header";

const singleHeader = (
  request: IncomingMessage,
  name: string,
): string | undefined => {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
};

/**
 * Admission shared by every route. `Host` must name the exact listener, which
 * defeats DNS rebinding. Browsers send `Origin` on every POST and on
 * cross-origin requests, so a present `Origin` must be the GUI itself.
 * API calls additionally need the custom header and a same-origin fetch.
 */
export const guiRequestRefusal = (
  request: IncomingMessage,
  origin: string,
  kind: "page" | "api",
): GuiRequestRefusal | undefined => {
  if (singleHeader(request, "host") !== new URL(origin).host) return "host";
  const requestOrigin = singleHeader(request, "origin");
  if (request.method === "POST" && requestOrigin === undefined) return "origin";
  if (requestOrigin !== undefined && requestOrigin !== origin) return "origin";
  const fetchSite = singleHeader(request, "sec-fetch-site");
  if (kind === "page")
    return fetchSite === "same-site" ? "fetch-site" : undefined;
  if (fetchSite !== undefined && fetchSite !== "same-origin")
    return "fetch-site";
  return singleHeader(request, GUI_REQUEST_HEADER) === "1"
    ? undefined
    : "request-header";
};

/** The session cookie value, when exactly one is present. */
export const guiSessionCookie = (
  request: IncomingMessage,
): string | undefined => {
  const header = singleHeader(request, "cookie");
  if (header === undefined) return undefined;
  const values = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${GUI_SESSION_COOKIE}=`))
    .map((part) => part.slice(GUI_SESSION_COOKIE.length + 1));
  return values.length === 1 ? values[0] : undefined;
};

/** `HttpOnly; SameSite=Strict` session cookie scoped to the listener. */
export const guiSessionCookieHeader = (session: string): string =>
  `${GUI_SESSION_COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/`;

/** Expire the session cookie on shutdown. */
export const GUI_EXPIRED_COOKIE = `${GUI_SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
