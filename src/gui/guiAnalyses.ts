import { randomBytes } from "node:crypto";
import type { Logger } from "pino";

import { createProgressReporter } from "../application/ProgressReporter.js";
import {
  generateReport,
  type ReportAnalysisPorts,
} from "../application/report/generateReport.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { createReportAnalysisPorts } from "../composition/reportAnalysis.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import type { JsonValue } from "../domain/jsonValue.js";
import type { InsideAppReport } from "../domain/report/insideAppReport.js";
import { err, ok } from "../domain/result.js";
import type { GuiTarget } from "./guiTargets.js";

/** Classified failure; engine messages may contain paths and stay in the process. */
export interface GuiAnalysisFailure {
  readonly code: string;
  readonly category: string;
}

export type GuiAnalysisStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** Engine phases shown to readers, in Italian; unknown phases get a neutral text. */
const PHASES: Readonly<Record<string, string>> = {
  "Inventorying and parsing application artifacts":
    "Inventario e lettura dei file dell'applicazione",
  "Validating result metadata and cross-graph bindings":
    "Verifica della coerenza dei risultati",
  "Creating and hashing application analysis Evidence":
    "Registrazione delle prove (Evidence)",
  "Application graph and Electron boundaries reconstructed":
    "Struttura dell'applicazione ricostruita",
};

interface GuiAnalysis {
  readonly id: string;
  readonly target: GuiTarget;
  readonly startedAt: number;
  readonly controller: AbortController;
  status: GuiAnalysisStatus;
  phase: string;
  finishedAt: number | undefined;
  failure: GuiAnalysisFailure | undefined;
  report: InsideAppReport | undefined;
  settled: Promise<void> | undefined;
}

/** Reports kept in memory per session; older ones are dropped. */
export const GUI_MAX_REPORTS = 10;

const failureOf = (value: unknown): GuiAnalysisFailure => {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return {
    code: typeof record.code === "string" ? record.code : "analysis_failed",
    category:
      typeof record.category === "string" ? record.category : "unavailable",
  };
};

/**
 * One analysis at a time through the shared report service. The GUI owns its
 * JavaScript resource scope; closing the analyses releases the worker.
 */
export class GuiAnalyses {
  readonly #analyses = new Map<string, GuiAnalysis>();
  readonly #scope = new ArtifactResourceScope();
  #current: GuiAnalysis | undefined;

  constructor(
    private readonly environment: Readonly<Record<string, string | undefined>>,
    private readonly logger: Logger,
    private readonly now: () => number,
  ) {}

  get busy(): boolean {
    return this.#current !== undefined;
  }

  /** Shared engine operations; only the JavaScript worker belongs to the GUI. */
  #ports(analysis: GuiAnalysis): ReportAnalysisPorts<JsonValue> {
    const progress = createProgressReporter(
      async (update) => {
        analysis.phase = PHASES[update.message] ?? "Analisi in corso";
      },
      { minimumIntervalMs: 0 },
    );
    return createReportAnalysisPorts({
      environment: this.environment,
      logger: this.logger,
      javascript: async (path, signal) => {
        // Loaded on first use, as the CLI does, so it stays a lazy runtime chunk.
        const { analyzeJavaScriptApplication } =
          await import("../application/javascript/JavaScriptApplicationService.js");
        const result = await analyzeJavaScriptApplication(
          { input_path: path },
          this.#scope,
          { environment: this.environment, signal, progress },
        );
        // Failed owners are retried now; a parked healthy worker stays owned.
        await this.#scope.retryCleanup();
        return result.ok
          ? ok(result.value as unknown as JsonValue)
          : err(projectAnalysisError(result.error) as unknown as JsonValue);
      },
    });
  }

  /** Start an analysis; undefined when another one is still running. */
  start(target: GuiTarget): GuiAnalysis | undefined {
    if (this.#current !== undefined) return undefined;
    const analysis: GuiAnalysis = {
      id: randomBytes(16).toString("base64url"),
      target,
      startedAt: this.now(),
      controller: new AbortController(),
      status: "running",
      phase: "Analisi statica in corso",
      finishedAt: undefined,
      failure: undefined,
      report: undefined,
      settled: undefined,
    };
    this.#current = analysis;
    this.#analyses.set(analysis.id, analysis);
    analysis.settled = this.#run(analysis);
    return analysis;
  }

  async #run(analysis: GuiAnalysis): Promise<void> {
    try {
      const report = await generateReport(
        { path: analysis.target.path, authorized: true },
        this.#ports(analysis),
        {
          generatedAt: new Date(this.now()),
          homeDirectory: undefined,
          signal: analysis.controller.signal,
        },
      );
      if (analysis.controller.signal.aborted) analysis.status = "cancelled";
      else if (report.ok) {
        // Reports shown or exported by the GUI never carry the local path.
        analysis.report = {
          ...report.value,
          subject: { ...report.value.subject, path: null },
        };
        analysis.status = "completed";
      } else {
        analysis.status = "failed";
        analysis.failure =
          report.error.kind === "analysis-failed"
            ? failureOf(report.error.failure)
            : { code: "report_failed", category: "unreadable_output" };
      }
    } catch {
      analysis.status = analysis.controller.signal.aborted
        ? "cancelled"
        : "failed";
      analysis.failure ??= { code: "internal", category: "internal" };
    } finally {
      analysis.finishedAt = this.now();
      if (this.#current === analysis) this.#current = undefined;
      this.#forgetOldReports();
    }
  }

  #forgetOldReports(): void {
    const finished = [...this.#analyses.values()].filter(
      (analysis) => analysis.status !== "running",
    );
    for (const analysis of finished.slice(
      0,
      Math.max(0, finished.length - GUI_MAX_REPORTS),
    ))
      this.#analyses.delete(analysis.id);
  }

  get(id: string): GuiAnalysis | undefined {
    return this.#analyses.get(id);
  }

  /** Request cancellation; the analysis reports "cancelled" once its work stopped. */
  cancel(id: string): boolean {
    const analysis = this.#analyses.get(id);
    if (analysis?.status !== "running") return false;
    analysis.controller.abort();
    return true;
  }

  /** Cancel running work and release the JavaScript worker. */
  async close(): Promise<void> {
    const running = this.#current;
    running?.controller.abort();
    await running?.settled;
    await this.#scope.close();
  }
}

export type { GuiAnalysis };
