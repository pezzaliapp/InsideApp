import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "incur";
import type { Logger } from "pino";

import {
  generateReport,
  reportFileName,
} from "../application/report/generateReport.js";
import {
  renderReportHtml,
  renderReportMarkdown,
} from "../application/report/renderInsideAppReport.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { isCliOperationFailure, logCliCommand } from "../cliLogging.js";
import { homeDirectoryFromEnvironment } from "../config/homeDirectory.js";
import {
  AnalysisInputError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import type { JsonValue } from "../domain/jsonValue.js";
import type { InsideAppReport } from "../domain/report/insideAppReport.js";
import { localPathStringSchema } from "../domain/localPath.js";
import { err, ok, type Result } from "../domain/result.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { runCliJavaScriptApplicationAnalysis } from "./javascriptApplicationAnalysis.js";
import type { CliInstance } from "./types.js";

const DEFAULT_OUTPUT_DIRECTORY = "rapporti-insideapp";

const reportOptions = z.object({
  authorized: z
    .boolean()
    .default(false)
    .describe(
      "Dichiara che il software è tuo o che sei autorizzato ad analizzarlo (obbligatorio)",
    ),
  outputDir: z
    .string()
    .min(1)
    .default(DEFAULT_OUTPUT_DIRECTORY)
    .describe("Cartella in cui salvare i rapporti"),
  only: z
    .enum(["html", "markdown"])
    .optional()
    .describe("Genera un solo formato (predefinito: HTML e Markdown)"),
});

const authorizationRequired = () =>
  projectAnalysisError(
    new AnalysisInputError(
      "report",
      {
        userMessage:
          "InsideApp analizza solo software tuo o che sei autorizzato ad analizzare (vedi AVVERTENZE.md). Se è così, ripeti il comando con --authorized.",
      },
      [{ path: ["authorized"], reason: "missing_argument" }],
    ),
  );

/** The CLI's JavaScript runner keeps the process-wide worker scope. */
const cliJavaScriptStep =
  (environment: Readonly<Record<string, string | undefined>>) =>
  async (
    path: string,
    signal: AbortSignal,
  ): Promise<Result<JsonValue, JsonValue>> => {
    const value = await runCliJavaScriptApplicationAnalysis(
      { input_path: path },
      environment,
      signal,
    );
    return isCliOperationFailure(value) ? err(value) : ok(value);
  };

/** Write the selected renderings; an existing report for the same input is replaced. */
const writeReportFiles = async (
  report: InsideAppReport,
  outputDir: string,
  only: "html" | "markdown" | undefined,
): Promise<Record<string, string>> => {
  const directory = absoluteCallerPath(outputDir);
  await mkdir(directory, { recursive: true });
  const files: Record<string, string> = {};
  if (only !== "markdown") {
    files.html = join(directory, reportFileName(report, "html"));
    await writeFile(files.html, renderReportHtml(report), "utf8");
  }
  if (only !== "html") {
    files.markdown = join(directory, reportFileName(report, "markdown"));
    await writeFile(files.markdown, renderReportMarkdown(report), "utf8");
  }
  return files;
};

/** Register the Italian report command for owned or authorized software. */
export const registerReportCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<Record<string, string | undefined>>,
): void => {
  cli.command(CLI_COMMANDS.report, {
    description:
      "Genera un rapporto in italiano (HTML e Markdown) su un'applicazione propria o autorizzata",
    args: z.object({
      path: localPathStringSchema.describe(
        "Cartella o archivio .asar di un'app JavaScript/Electron, oppure un file o bundle .app",
      ),
    }),
    options: reportOptions,
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.report, async () => {
          // Loaded on use so registering the catalog never loads the analyzers.
          const { createReportAnalysisPorts } =
            await import("../composition/reportAnalysis.js");
          const ports = createReportAnalysisPorts({
            environment,
            logger,
            javascript: cliJavaScriptStep(environment),
          });
          const report = await generateReport(
            {
              path: absoluteCallerPath(args.path),
              authorized: options.authorized,
            },
            ports,
            {
              generatedAt: new Date(),
              homeDirectory: homeDirectoryFromEnvironment(
                environment,
                process.platform,
              ),
              signal,
            },
          );
          if (!report.ok) {
            const { error } = report;
            if (error.kind === "authorization-required")
              return authorizationRequired();
            if (error.kind === "analysis-failed") return error.failure;
            return projectAnalysisError(
              new AnalysisOutputError("report", error.error.reason, {
                userMessage:
                  error.error.reason === "unsupported-operation"
                    ? `Il rapporto non è ancora disponibile per l'operazione ${error.error.operation}.`
                    : `Il risultato dell'analisi non è valido: ${error.error.message}`,
              }),
            );
          }
          return {
            report: {
              title: report.value.title,
              operation: report.value.analysis.operation,
              evidence_id: report.value.analysis.evidence_id,
              counts: report.value.counts,
            },
            files: await writeReportFiles(
              report.value,
              options.outputDir,
              options.only,
            ),
          };
        }),
      ),
  });
};
