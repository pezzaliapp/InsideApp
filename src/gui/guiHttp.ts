import type { IncomingMessage, ServerResponse } from "node:http";

import { GUI_SECURITY_HEADERS } from "./guiSecurity.js";

/** Largest accepted request body; every API body is a tiny JSON object. */
export const GUI_MAX_BODY_BYTES = 4096;

export const HTML_TYPE = "text/html; charset=utf-8";
export const JSON_TYPE = "application/json; charset=utf-8";

export type Reply = (
  status: number,
  body: string,
  type: string,
  extra?: Readonly<Record<string, string>>,
) => void;

/** Every response carries the security headers, refusals included. */
export const replier =
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

export const json = (
  reply: Reply,
  status: number,
  value: unknown,
  extra: Readonly<Record<string, string>> = {},
): void => reply(status, JSON.stringify(value), JSON_TYPE, extra);

/** Read a declared-length JSON body; anything else is refused before parsing. */
export const readJsonBody = async (
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

/** A string field of a parsed JSON object, bounded in length. */
export const stringField = (
  value: unknown,
  name: string,
  maxLength = 128,
): string | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const field = (value as Record<string, unknown>)[name];
  return typeof field === "string" && field.length <= maxLength
    ? field
    : undefined;
};
