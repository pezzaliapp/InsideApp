import { isAbsolute } from "node:path";

import type { InsideAppReport } from "../../domain/report/insideAppReport.js";
import { err, type Result } from "../../domain/result.js";
import { isJavaScriptApplicationPath } from "../javascript/javascriptApplicationPath.js";
import {
  createInsideAppReport,
  type InsideAppReportError,
  type ReportOptions,
} from "./InsideAppReportService.js";

/** Analysis lanes a report can be built from. */
export const REPORT_ROUTES = ["javascript-application", "artifact"] as const;

export type ReportRoute = (typeof REPORT_ROUTES)[number];

/**
 * One analysis run. It resolves to completed Evidence, or to the adapter's
 * own failure value, which the report service passes back unchanged.
 */
export type ReportAnalysisRunner<Failure> = (
  path: string,
  signal: AbortSignal,
) => Promise<Result<unknown, Failure>>;

/**
 * Analysis runners supplied by each adapter (CLI, GUI, MCP). Adapters keep
 * ownership of their resource scopes and workers; the service only selects one.
 */
export type ReportAnalysisPorts<Failure> = Readonly<
  Record<ReportRoute, ReportAnalysisRunner<Failure>>
>;

export interface GenerateReportRequest {
  /** Absolute, caller-selected path. */
  readonly path: string;
  /** The caller declared the software is theirs or that they may analyze it. */
  readonly authorized: boolean;
}

export type GenerateReportError<Failure> =
  | { readonly kind: "authorization-required" }
  | { readonly kind: "analysis-failed"; readonly failure: Failure }
  | { readonly kind: "report-failed"; readonly error: InsideAppReportError };

export interface GenerateReportOptions extends ReportOptions {
  readonly signal: AbortSignal;
}

/** Directories and `.asar` files are JavaScript applications, as for `analyze`. */
export const selectReportRoute = async (path: string): Promise<ReportRoute> =>
  (await isJavaScriptApplicationPath(path))
    ? "javascript-application"
    : "artifact";

/**
 * Shared report workflow for every adapter: refuse undeclared authorization
 * before reading the target, run the selected analysis, and project its
 * Evidence into a report. Rendering and storage stay with the adapter.
 */
export const generateReport = async <Failure>(
  request: GenerateReportRequest,
  ports: ReportAnalysisPorts<Failure>,
  options: GenerateReportOptions,
): Promise<Result<InsideAppReport, GenerateReportError<Failure>>> => {
  if (!request.authorized) return err({ kind: "authorization-required" });
  if (!isAbsolute(request.path))
    throw new TypeError("generateReport requires an absolute path");
  const route = await selectReportRoute(request.path);
  const evidence = await ports[route](request.path, options.signal);
  if (!evidence.ok)
    return err({ kind: "analysis-failed", failure: evidence.error });
  const report = createInsideAppReport(evidence.value, options);
  return report.ok
    ? report
    : err({ kind: "report-failed", error: report.error });
};

/** Portable file name from a target-controlled subject name and its digest. */
export const reportFileName = (
  report: InsideAppReport,
  format: "html" | "markdown",
): string => {
  const safe =
    report.subject.name
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9._-]+/gu, "-")
      .replace(/^[-.]+|-+$/gu, "")
      .slice(0, 60) || "applicazione";
  const stem =
    report.subject.sha256 === null
      ? safe
      : `${safe}-${report.subject.sha256.slice(0, 12)}`;
  return `${stem}.${format === "html" ? "html" : "md"}`;
};
