import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "incur";
import type { Logger } from "pino";

import { createInsideAppReport } from "../application/report/InsideAppReportService.js";
import type { InsideAppReport } from "../domain/report/insideAppReport.js";
import {
  renderReportHtml,
  renderReportMarkdown,
} from "../application/report/renderInsideAppReport.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { homeDirectoryFromEnvironment } from "../config/homeDirectory.js";
import { isCliOperationFailure, logCliCommand } from "../cliLogging.js";
import type { DirectAnalysis } from "../composition/directAnalysis.js";
import {
  AnalysisInputError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { localPathStringSchema } from "../domain/localPath.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { isJavaScriptApplicationPath } from "./coreBinaryCommands.js";
import { runCliJavaScriptApplicationAnalysis } from "./javascriptApplicationAnalysis.js";
import type { CliInstance } from "./types.js";

const DEFAULT_OUTPUT_DIRECTORY = "rapporti-insideapp";

/** Portable file stem from a target-controlled subject name and its digest. */
const reportFileStem = (name: string, sha256: string | null): string => {
  const safe =
    name
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9._-]+/gu, "-")
      .replace(/^[-.]+|-+$/gu, "")
      .slice(0, 60) || "applicazione";
  return sha256 === null ? safe : `${safe}-${sha256.slice(0, 12)}`;
};

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

/** Write the selected renderings; an existing report for the same input is replaced. */
const writeReportFiles = async (
  report: InsideAppReport,
  outputDir: string,
  only: "html" | "markdown" | undefined,
): Promise<Record<string, string>> => {
  const directory = absoluteCallerPath(outputDir);
  await mkdir(directory, { recursive: true });
  const stem = reportFileStem(report.subject.name, report.subject.sha256);
  const files: Record<string, string> = {};
  if (only !== "markdown") {
    files.html = join(directory, `${stem}.html`);
    await writeFile(files.html, renderReportHtml(report), "utf8");
  }
  if (only !== "html") {
    files.markdown = join(directory, `${stem}.md`);
    await writeFile(files.markdown, renderReportMarkdown(report), "utf8");
  }
  return files;
};

/** Register the Italian report command for owned or authorized software. */
export const registerReportCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<Record<string, string | undefined>>,
  runProviderAnalysis: DirectAnalysis["runProviderAnalysis"],
): void => {
  // Directories and .asar files take the same route as `analyze`.
  const analyze = async (
    path: string,
    signal: AbortSignal,
  ): Promise<JsonValue> =>
    (await isJavaScriptApplicationPath(path))
      ? runCliJavaScriptApplicationAnalysis(
          { input_path: path },
          environment,
          signal,
        )
      : runProviderAnalysis(
          path,
          "inspect_artifact",
          { integrity_policy: "fail" },
          logger,
          signal,
        );
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
          if (!options.authorized) return authorizationRequired();
          const evidence = await analyze(absoluteCallerPath(args.path), signal);
          if (isCliOperationFailure(evidence)) return evidence;
          const report = createInsideAppReport(evidence, {
            generatedAt: new Date(),
            homeDirectory: homeDirectoryFromEnvironment(
              environment,
              process.platform,
            ),
          });
          if (!report.ok)
            return projectAnalysisError(
              new AnalysisOutputError("report", report.error.reason, {
                userMessage:
                  report.error.reason === "unsupported-operation"
                    ? `Il rapporto non è ancora disponibile per l'operazione ${report.error.operation}.`
                    : `Il risultato dell'analisi non è valido: ${report.error.message}`,
              }),
            );
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
