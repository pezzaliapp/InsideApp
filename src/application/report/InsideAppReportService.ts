import { z } from "zod";

import { artifactInspectionResultSchema } from "../../domain/artifactInspection.js";
import { parseEvidence, type Evidence } from "../../domain/evidence.js";
import { parseOwnedJavaScriptApplicationAnalysisSteps } from "../../domain/javascript/javascriptApplicationAnalysis.js";
import {
  countReportClaims,
  type InsideAppReport,
  type ReportSection,
} from "../../domain/report/insideAppReport.js";
import { err, ok, type Result } from "../../domain/result.js";
import { PRODUCT_IDENTITY } from "../../identity.js";
import { artifactInspectionReportSections } from "./artifactInspectionReport.js";
import { javascriptApplicationReportSections } from "./javascriptApplicationReport.js";
import type { RecordContext } from "./reportText.js";

/** Evidence operations that have a reader report. */
export const REPORTED_OPERATIONS = [
  "analyze_javascript_application",
  "inspect_artifact",
] as const;

export type ReportedOperation = (typeof REPORTED_OPERATIONS)[number];

export type InsideAppReportError =
  | { readonly reason: "invalid-evidence"; readonly message: string }
  | { readonly reason: "unsupported-operation"; readonly operation: string };

const DESCRIPTIONS: Readonly<Record<ReportedOperation, string>> = {
  analyze_javascript_application:
    "Analisi statica di un'applicazione JavaScript o Electron: il codice è stato letto come testo e non è mai stato eseguito.",
  inspect_artifact:
    "Ispezione statica del file: formato, contenuti e integrità sono stati letti dai byte, senza eseguire nulla.",
};

const parseJavaScriptResult = (value: unknown) => {
  const steps = parseOwnedJavaScriptApplicationAnalysisSteps(value);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
};

const sectionsFor = (
  evidence: Evidence,
  operation: ReportedOperation,
  record: RecordContext,
): readonly ReportSection[] =>
  operation === "analyze_javascript_application"
    ? javascriptApplicationReportSections(
        parseJavaScriptResult(evidence.normalized_result),
        record,
      )
    : artifactInspectionReportSections(
        artifactInspectionResultSchema.parse(evidence.normalized_result),
        record,
      );

const isReportedOperation = (
  operation: string,
): operation is ReportedOperation =>
  (REPORTED_OPERATIONS as readonly string[]).includes(operation);

export interface ReportOptions {
  readonly generatedAt: Date;
  /** Shown as `~` so a shared report does not reveal the account name. */
  readonly homeDirectory: string | undefined;
}

const displayPath = (path: string, home: string | undefined): string =>
  home !== undefined &&
  home.length > 1 &&
  (path === home || path.startsWith(`${home}/`))
    ? `~${path.slice(home.length)}`
    : path;

/**
 * Build an InsideApp report from one completed Evidence record. The record and
 * its result are authenticated by their owning parsers before projection.
 */
export const createInsideAppReport = (
  evidenceRecord: unknown,
  { generatedAt, homeDirectory }: ReportOptions,
): Result<InsideAppReport, InsideAppReportError> => {
  let evidence: Evidence;
  try {
    evidence = parseEvidence(evidenceRecord);
  } catch (cause: unknown) {
    if (!(cause instanceof z.ZodError)) throw cause;
    return err({ reason: "invalid-evidence", message: z.prettifyError(cause) });
  }
  const { operation } = evidence;
  if (!isReportedOperation(operation))
    return err({ reason: "unsupported-operation", operation });
  const subjectSha256 = evidence.subject?.digest.sha256 ?? null;
  let sections: readonly ReportSection[];
  try {
    sections = sectionsFor(evidence, operation, {
      evidenceId: evidence.evidence_id,
      operation,
      subjectSha256,
      confidence: evidence.confidence,
    });
  } catch (cause: unknown) {
    if (!(cause instanceof z.ZodError)) throw cause;
    return err({ reason: "invalid-evidence", message: z.prettifyError(cause) });
  }
  const name = evidence.subject?.name ?? "applicazione";
  return ok({
    schema: "InsideAppReport",
    schema_version: 1,
    title: `Rapporto InsideApp — ${name}`,
    generated_at: generatedAt.toISOString(),
    generator: {
      name: "InsideApp — PezzaliAPP",
      version: PRODUCT_IDENTITY.packageVersion,
    },
    authorization: "declared-by-user",
    subject: {
      name,
      path:
        evidence.subject?.local_path === undefined
          ? null
          : displayPath(evidence.subject.local_path, homeDirectory),
      format: evidence.subject?.format ?? null,
      sha256: subjectSha256,
    },
    analysis: {
      operation,
      evidence_id: evidence.evidence_id,
      provider: evidence.provider.name,
      description: DESCRIPTIONS[operation],
    },
    sections,
    engine_limitations: evidence.limitations,
    counts: countReportClaims(sections),
  });
};
