import { stat } from "node:fs/promises";

import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisInputError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import type { AnalysisErrorProjection } from "../../domain/analysisErrorProjection.js";
import {
  createEvidence,
  parseEvidence,
  type Evidence,
} from "../../domain/evidence.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import { jsonValueSchema } from "../../domain/jsonValue.js";
import {
  createReportInputSchema,
  INSIDEAPP_REPORT_PROVIDER,
} from "../../domain/report/insideAppReport.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  generateReport,
  REPORT_ROUTES,
  type ReportAnalysisPorts,
  type ReportEvidenceSet,
  type ReportRoute,
} from "./generateReport.js";
import { isTooBroadReportFolder } from "./reportTarget.js";

const OPERATION = "create_report";

/** A typed engine error, or the projection a failed analysis already produced. */
export type ReportToolFailure =
  | { readonly kind: "error"; readonly error: AnalysisError }
  | { readonly kind: "analysis"; readonly projection: AnalysisErrorProjection };

export interface ReportToolResult {
  /** Path-free report Evidence for the caller. */
  readonly evidence: Evidence;
  /** The engine Evidence the report was built from, for the session record. */
  readonly sources: readonly Evidence[];
}

const refused = (message: string, field: "authorized" | "path") =>
  err<ReportToolFailure>({
    kind: "error",
    error: new AnalysisInputError(OPERATION, { userMessage: message }, [
      { path: [field], reason: "invalid_value", message },
    ]),
  });

/** Wrap the ports to keep the Evidence set of the run that succeeded. */
const capturing = (
  ports: ReportAnalysisPorts<AnalysisErrorProjection>,
  seen: { set?: ReportEvidenceSet; route?: ReportRoute },
): ReportAnalysisPorts<AnalysisErrorProjection> =>
  Object.fromEntries(
    REPORT_ROUTES.map((route) => [
      route,
      async (path: string, signal: AbortSignal) => {
        const result = await ports[route](path, signal);
        seen.route = route;
        if (result.ok) seen.set = result.value;
        return result;
      },
    ]),
  ) as unknown as ReportAnalysisPorts<AnalysisErrorProjection>;

const sourcesOf = (set: ReportEvidenceSet): readonly Evidence[] => [
  parseEvidence(set.primary),
  ...set.supplements.flatMap((supplement) =>
    "evidence" in supplement ? [parseEvidence(supplement.evidence)] : [],
  ),
];

/**
 * The MCP report workflow: explicit authorization, a bounded target, the
 * shared report service, then derived Evidence that omits every local path.
 */
export const createReportEvidence = async (
  rawInput: unknown,
  ports: ReportAnalysisPorts<AnalysisErrorProjection>,
  options: {
    readonly homeDirectory: string | undefined;
    readonly signal: AbortSignal;
    readonly now?: () => Date;
  },
): Promise<Result<ReportToolResult, ReportToolFailure>> => {
  const parsed = createReportInputSchema.safeParse(rawInput);
  if (!parsed.success)
    return err({
      kind: "error",
      error: analysisInputErrorFromIssues(
        OPERATION,
        parsed.error.issues,
        rawInput,
      ),
    });
  const { path, authorized } = parsed.data;
  if (!authorized)
    return refused(
      "InsideApp analizza solo software dell'utente o che l'utente è autorizzato ad analizzare: chiedi conferma all'utente e ripeti con authorized: true.",
      "authorized",
    );
  const isDirectory = await stat(path).then(
    (info) => info.isDirectory(),
    () => false,
  );
  if (isDirectory && isTooBroadReportFolder(path, options.homeDirectory))
    return refused(
      "La cartella è troppo ampia (radice del disco, cartella di primo livello o cartella Inizio): scegli un'applicazione o una cartella più specifica.",
      "path",
    );
  const seen: { set?: ReportEvidenceSet; route?: ReportRoute } = {};
  const report = await generateReport(
    { path, authorized },
    capturing(ports, seen),
    {
      generatedAt: (options.now ?? (() => new Date()))(),
      homeDirectory: undefined,
      signal: options.signal,
    },
  );
  if (!report.ok) {
    const { error } = report;
    if (error.kind === "analysis-failed")
      return err({ kind: "analysis", projection: error.failure });
    if (error.kind === "authorization-required")
      return refused("Autorizzazione mancante.", "authorized");
    return err({
      kind: "error",
      error: new AnalysisOutputError(OPERATION, error.error.reason, {
        userMessage:
          error.error.reason === "unsupported-operation"
            ? `Nessun rapporto disponibile per l'operazione ${error.error.operation}.`
            : "Il risultato dell'analisi non è valido.",
      }),
    });
  }
  const sources = seen.set === undefined ? [] : sourcesOf(seen.set);
  // The report never carries the local path; the caller already knows it.
  const value = {
    ...report.value,
    subject: { ...report.value.subject, path: null },
  };
  const evidence = createEvidence(undefined, INSIDEAPP_REPORT_PROVIDER, {
    predicateType: "insideapp.report",
    operation: OPERATION,
    parameters: { authorized: true, route: seen.route ?? "artifact" },
    result: jsonValueSchema.parse(value),
    confidence: "derived",
    authority: "analyst-inference",
    subjectUnavailableReason:
      "InsideApp reports omit local paths; the linked source Evidence identifies the analyzed bytes.",
    limitations: [
      "Static analysis only: the analyzed software was never executed.",
      "Claims keep the engine's classification as Osservato, Derivato, Ipotesi or Sconosciuto; absence of a finding does not prove absence.",
    ],
    evidenceLinks: sources.map((source) => source.evidence_id),
  });
  return ok({ evidence, sources });
};
