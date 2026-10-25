import type { ApiRoute, GuiContext, Handler } from "./guiApi.js";
import { failureMessage } from "./guiFailures.js";
import { json, readJsonBody, stringField } from "./guiHttp.js";
import {
  nativeReportFileName,
  renderNativeReportHtml,
  renderNativeReportMarkdown,
} from "./guiNativeReport.js";
import { guiTargetView } from "./guiTargets.js";

/** Engine named in exported reports; the version is checked when it opens. */
const ENGINE = "Ghidra 12.1";

const NOT_CONFIGURED =
  "Ghidra non è configurato: installalo con scripts/install-ghidra.sh (vedi il README), poi riavvia l'interfaccia.";

/** Italian, path-free failure text; engine diagnostics stay in the process. */
const nativeFailureMessage = (
  context: GuiContext,
  failure: { readonly code: string; readonly category: string },
): string =>
  context.native.engine === "not_configured" ||
  failure.code === "provider_unavailable"
    ? NOT_CONFIGURED
    : failure.category === "unsupported_target" ||
        failure.code === "unsupported_target"
      ? "Ghidra non riconosce questo elemento come un programma eseguibile da esplorare: scegli un file .exe, .dll, Mach-O o ELF."
      : failureMessage(failure);

const nativeView = (context: GuiContext) => {
  const run = context.native.current;
  return {
    engine: context.native.engine,
    ...(run === undefined
      ? { status: "idle" }
      : {
          status: run.status,
          phase: run.phase,
          elapsed_ms: (run.finishedAt ?? context.now()) - run.startedAt,
          target: guiTargetView(run.target),
          ...(run.failure === undefined
            ? {}
            : {
                failure: {
                  code: run.failure.code,
                  message: nativeFailureMessage(context, run.failure),
                },
              }),
          ...(run.overview === undefined ? {} : { overview: run.overview }),
        }),
  };
};

const readNative: Handler = async ({ context, reply }) =>
  json(reply, 200, nativeView(context));

const startNative: Handler = async ({ context, request, reply }) => {
  const body = await readJsonBody(request);
  if (!body.ok) return json(reply, body.status, { error: "invalid_request" });
  const value = body.value as Record<string, unknown> | null;
  // The same declaration as the report: static analysis of an authorized item.
  if (value?.authorized !== true)
    return json(reply, 400, { error: "authorization_required" });
  const targetId = stringField(value, "target_id");
  const target =
    targetId === undefined ? undefined : context.targets.get(targetId);
  if (target === undefined)
    return json(reply, 404, { error: "unknown_target" });
  if (context.native.engine === "not_configured")
    return json(reply, 409, {
      error: "engine_not_configured",
      message: NOT_CONFIGURED,
    });
  await context.native.start(target);
  json(reply, 202, nativeView(context));
};

const cancelNative: Handler = async ({ context, request, reply }) => {
  const body = await readJsonBody(request);
  if (!body.ok) return json(reply, body.status, { error: "invalid_request" });
  if (!context.native.cancel())
    return json(reply, 409, { error: "not_running" });
  json(reply, 202, { status: "cancelling" });
};

const closeNative: Handler = async ({ context, request, reply }) => {
  const body = await readJsonBody(request);
  if (!body.ok) return json(reply, body.status, { error: "invalid_request" });
  await context.native.close();
  json(reply, 200, nativeView(context));
};

const readFunction: Handler = async ({ context, reply, id }) => {
  if (id === undefined) return json(reply, 404, { error: "unknown_function" });
  const view = await context.native.function(id.toLowerCase());
  if (!view.ok)
    return json(reply, view.status, {
      error: view.error,
      ...(view.status === 422
        ? {
            message: nativeFailureMessage(context, {
              code: view.error,
              category: "",
            }),
          }
        : {}),
    });
  json(reply, 200, view.value);
};

const readStringReferences: Handler = async ({ context, reply, id }) => {
  if (id === undefined) return json(reply, 404, { error: "unknown_string" });
  const references = await context.native.stringReferences(id.toLowerCase());
  if (!references.ok)
    return json(reply, references.status, { error: references.error });
  json(reply, 200, { references: references.value });
};

const exportNative =
  (format: "html" | "markdown"): Handler =>
  async ({ context, reply }) => {
    const run = context.native.current;
    if (run?.status !== "ready" || run.overview === undefined)
      return json(reply, 404, { error: "no_native_analysis" });
    const input = {
      overview: run.overview,
      functions: [...run.functions.values()],
      engine: ENGINE,
      generatedAt: new Date(context.now()),
    };
    // nativeReportFileName yields only [A-Za-z0-9._-], safe inside the quotes.
    reply(
      200,
      format === "html"
        ? renderNativeReportHtml(input)
        : renderNativeReportMarkdown(input),
      format === "html"
        ? "text/html; charset=utf-8"
        : "text/markdown; charset=utf-8",
      {
        "Content-Disposition": `attachment; filename="${nativeReportFileName(run.overview, format)}"`,
      },
    );
  };

/** Hexadecimal addresses as Ghidra reports them for analyzed code and data. */
const ADDRESS = "(0x[0-9A-Fa-f]{1,16})";

export const NATIVE_API_ROUTES: readonly ApiRoute[] = [
  {
    pattern: /^\/api\/native$/u,
    method: "GET",
    session: true,
    handle: readNative,
  },
  {
    pattern: /^\/api\/native$/u,
    method: "POST",
    session: true,
    handle: startNative,
  },
  {
    pattern: /^\/api\/native\/cancel$/u,
    method: "POST",
    session: true,
    handle: cancelNative,
  },
  {
    pattern: /^\/api\/native\/close$/u,
    method: "POST",
    session: true,
    handle: closeNative,
  },
  {
    pattern: new RegExp(`^/api/native/functions/${ADDRESS}$`, "u"),
    method: "GET",
    session: true,
    handle: readFunction,
  },
  {
    pattern: new RegExp(`^/api/native/strings/${ADDRESS}/references$`, "u"),
    method: "GET",
    session: true,
    handle: readStringReferences,
  },
  {
    pattern: /^\/api\/native\/export\.html$/u,
    method: "GET",
    session: true,
    handle: exportNative("html"),
  },
  {
    pattern: /^\/api\/native\/export\.md$/u,
    method: "GET",
    session: true,
    handle: exportNative("markdown"),
  },
];
