import { sep } from "node:path";

import { z } from "zod";

import { parseEvidence, type Evidence } from "../../domain/evidence.js";
import {
  countReportClaims,
  ReportClaimCollector,
  type InsideAppReport,
  type ReportSupplementRecord,
} from "../../domain/report/insideAppReport.js";
import { err, ok, type Result } from "../../domain/result.js";
import { PRODUCT_IDENTITY } from "../../identity.js";
import { appleBundleClaimBuilders } from "./appleBundleReport.js";
import { artifactInspectionClaims } from "./artifactInspectionReport.js";
import type { ReportEvidenceSet } from "./generateReport.js";
import { javascriptApplicationClaims } from "./javascriptApplicationReport.js";
import { peClaimBuilders } from "./peReport.js";
import type { RecordContext, ReportClaimBuilder } from "./reportText.js";
import { sqliteDatabaseClaims } from "./sqliteReport.js";

/** Operations whose Evidence can lead a report, with the reader description. */
const PRIMARY_DESCRIPTIONS: Readonly<Record<string, string>> = {
  analyze_javascript_application:
    "Analisi statica di un'applicazione JavaScript o Electron: il codice è stato letto come testo e non è mai stato eseguito.",
  inspect_artifact:
    "Ispezione statica del file: formato, contenuti e integrità sono stati letti dai byte, senza eseguire nulla.",
  inspect_desktop_application:
    "Ispezione statica di un'applicazione macOS (.app): struttura, Info.plist, eseguibile e firma sono stati letti senza avviare l'applicazione.",
  inspect_sqlite_database:
    "Ispezione statica della struttura di un database SQLite su una copia privata: il file originale non è stato modificato e il contenuto delle tabelle non è stato letto.",
};

/** Claim builders by operation; each parses its own result before projecting. */
const BUILDERS: Readonly<Record<string, ReportClaimBuilder>> = {
  analyze_javascript_application: javascriptApplicationClaims,
  inspect_artifact: artifactInspectionClaims,
  inspect_sqlite_database: sqliteDatabaseClaims,
  ...appleBundleClaimBuilders,
  ...peClaimBuilders,
};

export type InsideAppReportError =
  | { readonly reason: "invalid-evidence"; readonly message: string }
  | { readonly reason: "unsupported-operation"; readonly operation: string };

export interface ReportOptions {
  readonly generatedAt: Date;
  /** Shown as `~` so a shared report does not reveal the account name. */
  readonly homeDirectory: string | undefined;
}

/** Paths come from this host, so its separator delimits the home folder. */
const displayPath = (path: string, home: string | undefined): string =>
  home !== undefined &&
  home.length > 1 &&
  (path === home || path.startsWith(`${home}${sep}`))
    ? `~${path.slice(home.length)}`
    : path;

const contextOf = (
  evidence: Evidence,
  resolvedOperations: ReadonlySet<string> = new Set(),
): RecordContext => ({
  evidenceId: evidence.evidence_id,
  operation: evidence.operation,
  subjectSha256: evidence.subject?.digest.sha256 ?? null,
  confidence: evidence.confidence,
  resolvedOperations,
});

/** Failure codes of an analysis this host cannot run, such as macOS tools on Windows. */
const UNAVAILABLE_HERE: ReadonlySet<string> = new Set([
  "capability_unavailable",
  "provider_unavailable",
]);

const failed = (
  operation: string,
  failureCode: string,
): ReportSupplementRecord => ({
  operation,
  status: "failed",
  failure_code: failureCode,
});

/** Add one supplement's claims; an invalid or unknown one is recorded as failed. */
const addSupplement = (
  collector: ReportClaimCollector,
  supplement: ReportEvidenceSet["supplements"][number],
): ReportSupplementRecord => {
  if ("failureCode" in supplement)
    return failed(supplement.operation, supplement.failureCode);
  try {
    const evidence = parseEvidence(supplement.evidence);
    const builder = BUILDERS[evidence.operation];
    if (builder === undefined || evidence.operation !== supplement.operation)
      return failed(supplement.operation, "unsupported_operation");
    // Claims are collected aside so an invalid result adds none of them.
    const claims = new ReportClaimCollector();
    builder(claims, evidence.normalized_result, contextOf(evidence));
    collector.merge(claims);
    return {
      operation: evidence.operation,
      status: "completed",
      evidence_id: evidence.evidence_id,
    };
  } catch (cause: unknown) {
    if (!(cause instanceof z.ZodError)) throw cause;
    return failed(supplement.operation, "invalid_evidence");
  }
};

const invalidEvidence = (cause: z.ZodError): InsideAppReportError => ({
  reason: "invalid-evidence",
  message: z.prettifyError(cause),
});

/**
 * Build an InsideApp report from completed Evidence. Every record and result
 * is authenticated by its owning parser before projection.
 */
export const createInsideAppReport = (
  evidenceSet: ReportEvidenceSet,
  { generatedAt, homeDirectory }: ReportOptions,
): Result<InsideAppReport, InsideAppReportError> => {
  let evidence: Evidence;
  try {
    evidence = parseEvidence(evidenceSet.primary);
  } catch (cause: unknown) {
    if (!(cause instanceof z.ZodError)) throw cause;
    return err(invalidEvidence(cause));
  }
  const { operation } = evidence;
  const description = PRIMARY_DESCRIPTIONS[operation];
  const builder = BUILDERS[operation];
  if (description === undefined || builder === undefined)
    return err({ reason: "unsupported-operation", operation });
  // Supplements run first so the primary can omit guesses they settled.
  const supplementClaims = new ReportClaimCollector();
  const supplements = evidenceSet.supplements.map((supplement) =>
    addSupplement(supplementClaims, supplement),
  );
  const resolved = new Set(
    supplements
      .filter((supplement) => supplement.status === "completed")
      .map((supplement) => supplement.operation),
  );
  const collector = new ReportClaimCollector();
  try {
    builder(
      collector,
      evidence.normalized_result,
      contextOf(evidence, resolved),
    );
  } catch (cause: unknown) {
    if (!(cause instanceof z.ZodError)) throw cause;
    return err(invalidEvidence(cause));
  }
  collector.merge(supplementClaims);
  for (const supplement of supplements)
    if (supplement.status === "failed")
      collector.add("limits", {
        kind: "unknown",
        statement: UNAVAILABLE_HERE.has(supplement.failure_code)
          ? `L'analisi aggiuntiva ${supplement.operation} non è disponibile su questo sistema (ad esempio richiede strumenti di macOS): le informazioni che avrebbe fornito restano sconosciute.`
          : `L'analisi aggiuntiva ${supplement.operation} non è riuscita (codice ${supplement.failure_code}): le informazioni che avrebbe fornito restano sconosciute.`,
        evidence: null,
      });
  const sections = collector.sections();
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
      sha256: evidence.subject?.digest.sha256 ?? null,
    },
    analysis: {
      operation,
      evidence_id: evidence.evidence_id,
      provider: evidence.provider.name,
      description,
      supplements,
    },
    sections,
    engine_limitations: evidence.limitations,
    counts: countReportClaims(sections),
  });
};
