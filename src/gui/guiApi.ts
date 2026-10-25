import type { IncomingMessage, ServerResponse } from "node:http";

import { reportFileName } from "../application/report/generateReport.js";
import {
  renderReportHtml,
  renderReportMarkdown,
} from "../application/report/renderInsideAppReport.js";
import {
  REPORT_CLAIM_DEFINITIONS,
  REPORT_CLAIM_LABELS,
} from "../domain/report/insideAppReport.js";
import type {
  GuiAnalyses,
  GuiAnalysis,
  GuiAnalysisFailure,
} from "./guiAnalyses.js";
import {
  json,
  readJsonBody,
  replier,
  stringField,
  type Reply,
} from "./guiHttp.js";
import {
  GUI_EXPIRED_COOKIE,
  guiSessionCookie,
  guiSessionCookieHeader,
} from "./guiSecurity.js";
import type { GuiSession } from "./guiSession.js";
import { guiEngineStatus } from "./guiStatus.js";
import {
  guiTargetView,
  type GuiPicker,
  type GuiTargets,
} from "./guiTargets.js";

export type GuiStopReason = "interrupted" | "idle" | "shutdown";

/** Session state shared by the API handlers. */
export interface GuiContext {
  readonly projectRoot: string;
  readonly idleTimeoutMs: number;
  readonly session: GuiSession;
  readonly targets: GuiTargets;
  readonly analyses: GuiAnalyses;
  readonly picker: GuiPicker;
  readonly pickerSignal: AbortSignal;
  readonly now: () => number;
  readonly touch: () => void;
  readonly removeLauncher: () => Promise<void>;
  readonly stop: (reason: GuiStopReason) => Promise<GuiStopReason>;
  pickerOpen: boolean;
}

/** One admitted API request; `id` is the opaque identifier in the path, if any. */
interface ApiCall {
  readonly context: GuiContext;
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly reply: Reply;
  readonly id: string | undefined;
}

type Handler = (call: ApiCall) => Promise<void>;

/** Italian, path-free explanations; engine messages may name local paths. */
const failureMessage = ({ code, category }: GuiAnalysisFailure): string => {
  if (category === "unsupported_target" || code === "unsupported_target")
    return "Questo elemento non è supportato in questa versione. InsideApp analizza app Electron (cartelle o file .asar) e ispeziona eseguibili, archivi e bundle .app.";
  if (code === "access_denied")
    return "InsideApp non ha il permesso di leggere l'elemento scelto.";
  if (category === "unavailable")
    return "L'elemento scelto non è stato trovato o non è leggibile.";
  if (code === "resource_constraint")
    return "L'elemento supera i limiti di analisi di questa versione.";
  if (code === "artifact_integrity_mismatch")
    return "L'integrità dichiarata di un componente non corrisponde ai byte letti: l'analisi si è fermata.";
  return `L'analisi non è riuscita (codice ${code}).`;
};

const analysisView = (context: GuiContext, analysis: GuiAnalysis) => ({
  id: analysis.id,
  status: analysis.status,
  phase: analysis.phase,
  elapsed_ms: (analysis.finishedAt ?? context.now()) - analysis.startedAt,
  target: guiTargetView(analysis.target),
  ...(analysis.failure === undefined
    ? {}
    : {
        failure: {
          code: analysis.failure.code,
          message: failureMessage(analysis.failure),
        },
      }),
  ...(analysis.report === undefined ? {} : { counts: analysis.report.counts }),
});

const completedReport = (context: GuiContext, id: string | undefined) => {
  const analysis = id === undefined ? undefined : context.analyses.get(id);
  return analysis?.report;
};

const redeemSession: Handler = async ({ context, request, reply }) => {
  const body = await readJsonBody(request);
  if (!body.ok) return json(reply, body.status, { error: "invalid_request" });
  const token = stringField(body.value, "token");
  if (token === undefined)
    return json(reply, 400, { error: "invalid_request" });
  const outcome = context.session.redeem(token, context.now());
  if (!outcome.ok)
    return json(reply, 403, { error: `launch_${outcome.reason}` });
  // The token leaves the disk before the session cookie exists.
  await context.removeLauncher();
  context.touch();
  reply(204, "", "application/json; charset=utf-8", {
    "Set-Cookie": guiSessionCookieHeader(outcome.session),
  });
};

const status: Handler = async ({ context, reply }) =>
  json(reply, 200, {
    engine: await guiEngineStatus(context.projectRoot),
    session: { idle_timeout_seconds: Math.round(context.idleTimeoutMs / 1000) },
  });

const shutdown: Handler = async ({ context, request, response, reply }) => {
  const body = await readJsonBody(request);
  if (!body.ok) return json(reply, body.status, { error: "invalid_request" });
  // Stop only after the reply is flushed; closing first would cut it off.
  response.once("close", () => void context.stop("shutdown"));
  json(reply, 202, { status: "closing" }, { "Set-Cookie": GUI_EXPIRED_COOKIE });
};

const pickTarget: Handler = async ({ context, request, reply }) => {
  const body = await readJsonBody(request);
  if (!body.ok) return json(reply, body.status, { error: "invalid_request" });
  const kind = stringField(body.value, "kind");
  if (kind !== "file" && kind !== "folder")
    return json(reply, 400, { error: "invalid_request" });
  if (context.pickerOpen) return json(reply, 409, { error: "picker_open" });
  context.pickerOpen = true;
  try {
    const picked = await context.picker(kind, context.pickerSignal);
    context.touch();
    if (!picked.ok) return json(reply, 200, { outcome: picked.reason });
    const target = await context.targets.add(picked.path);
    if (target === undefined)
      return json(reply, 200, { outcome: "unavailable" });
    return json(reply, 200, {
      outcome: "selected",
      target: guiTargetView(target),
    });
  } finally {
    context.pickerOpen = false;
  }
};

const startAnalysis: Handler = async ({ context, request, reply }) => {
  const body = await readJsonBody(request);
  if (!body.ok) return json(reply, body.status, { error: "invalid_request" });
  const value = body.value as Record<string, unknown> | null;
  if (value?.authorized !== true)
    return json(reply, 400, { error: "authorization_required" });
  const targetId = stringField(value, "target_id");
  const target =
    targetId === undefined ? undefined : context.targets.get(targetId);
  if (target === undefined)
    return json(reply, 404, { error: "unknown_target" });
  const analysis = context.analyses.start(target);
  if (analysis === undefined)
    return json(reply, 409, { error: "analysis_running" });
  json(reply, 202, analysisView(context, analysis));
};

const readAnalysis: Handler = async ({ context, reply, id }) => {
  const analysis = id === undefined ? undefined : context.analyses.get(id);
  if (analysis === undefined)
    return json(reply, 404, { error: "unknown_analysis" });
  json(reply, 200, analysisView(context, analysis));
};

const cancelAnalysis: Handler = async ({ context, request, reply, id }) => {
  const body = await readJsonBody(request);
  if (!body.ok) return json(reply, body.status, { error: "invalid_request" });
  if (id === undefined || !context.analyses.cancel(id))
    return json(reply, 409, { error: "not_running" });
  json(reply, 202, { status: "cancelling" });
};

const readReport: Handler = async ({ context, reply, id }) => {
  const report = completedReport(context, id);
  if (report === undefined)
    return json(reply, 404, { error: "unknown_report" });
  json(reply, 200, {
    report,
    legend: {
      labels: REPORT_CLAIM_LABELS,
      definitions: REPORT_CLAIM_DEFINITIONS,
    },
  });
};

const exportReport =
  (format: "html" | "markdown"): Handler =>
  async ({ context, reply, id }) => {
    const report = completedReport(context, id);
    if (report === undefined)
      return json(reply, 404, { error: "unknown_report" });
    // reportFileName yields only [A-Za-z0-9._-], safe inside the quoted value.
    reply(
      200,
      format === "html"
        ? renderReportHtml(report)
        : renderReportMarkdown(report),
      format === "html"
        ? "text/html; charset=utf-8"
        : "text/markdown; charset=utf-8",
      {
        "Content-Disposition": `attachment; filename="${reportFileName(report, format)}"`,
      },
    );
  };

const ID = "([A-Za-z0-9_-]{22})";

/** Exact API routes; ids are 128-bit opaque values minted by this process. */
const API_ROUTES: readonly {
  readonly pattern: RegExp;
  readonly method: "GET" | "POST";
  readonly session: boolean;
  readonly handle: Handler;
}[] = [
  {
    pattern: /^\/api\/session$/u,
    method: "POST",
    session: false,
    handle: redeemSession,
  },
  { pattern: /^\/api\/status$/u, method: "GET", session: true, handle: status },
  {
    pattern: /^\/api\/shutdown$/u,
    method: "POST",
    session: true,
    handle: shutdown,
  },
  {
    pattern: /^\/api\/targets$/u,
    method: "POST",
    session: true,
    handle: pickTarget,
  },
  {
    pattern: /^\/api\/analyses$/u,
    method: "POST",
    session: true,
    handle: startAnalysis,
  },
  {
    pattern: new RegExp(`^/api/analyses/${ID}$`, "u"),
    method: "GET",
    session: true,
    handle: readAnalysis,
  },
  {
    pattern: new RegExp(`^/api/analyses/${ID}/cancel$`, "u"),
    method: "POST",
    session: true,
    handle: cancelAnalysis,
  },
  {
    pattern: new RegExp(`^/api/reports/${ID}$`, "u"),
    method: "GET",
    session: true,
    handle: readReport,
  },
  {
    pattern: new RegExp(`^/api/reports/${ID}/export\\.html$`, "u"),
    method: "GET",
    session: true,
    handle: exportReport("html"),
  },
  {
    pattern: new RegExp(`^/api/reports/${ID}/export\\.md$`, "u"),
    method: "GET",
    session: true,
    handle: exportReport("markdown"),
  },
];

/** Route one admitted API request: 404 unknown path, 405 wrong method, 401 without session. */
export const handleGuiApi = async (
  context: GuiContext,
  path: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  const reply = replier(response);
  const matches = API_ROUTES.map((route) => ({
    route,
    match: route.pattern.exec(path),
  })).filter(({ match }) => match !== null);
  if (matches.length === 0) return json(reply, 404, { error: "not_found" });
  const selected = matches.find(({ route }) => route.method === request.method);
  if (selected === undefined)
    return json(
      reply,
      405,
      { error: "method_not_allowed" },
      {
        Allow: [...new Set(matches.map(({ route }) => route.method))].join(
          ", ",
        ),
      },
    );
  if (selected.route.session) {
    if (!context.session.isActive(guiSessionCookie(request)))
      return json(reply, 401, { error: "session_required" });
    context.touch();
  }
  await selected.route.handle({
    context,
    request,
    response,
    reply,
    id: selected.match![1],
  });
};
