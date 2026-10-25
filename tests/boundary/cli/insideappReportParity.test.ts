import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";

import { analyzeJavaScriptApplication } from "../../../src/application/javascript/JavaScriptApplicationService.js";
import {
  generateReport,
  reportFileName,
  type ReportAnalysisPorts,
} from "../../../src/application/report/generateReport.js";
import {
  renderReportHtml,
  renderReportMarkdown,
} from "../../../src/application/report/renderInsideAppReport.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { createDirectAnalysis } from "../../../src/composition/directAnalysis.js";
import { ok, err } from "../../../src/domain/result.js";
import { createLogger } from "../../../src/logger.js";
import {
  createIsolatedHost,
  expectNoHostSideEffects,
  runLauncher,
} from "../../fixtures/insideappHost.js";

const TIMEOUT_MS = 180_000;

const cliOutputSchema = z.object({
  files: z.strictObject({ html: z.string(), markdown: z.string() }),
});

/**
 * In-process ports that bypass the CLI: the JavaScript service with its own
 * resource scope, as a GUI adapter would own one, and the composed artifact
 * inspection.
 */
const adapterNeutralPorts = (
  environment: Readonly<Record<string, string>>,
): ReportAnalysisPorts<unknown> => {
  const scope = new ArtifactResourceScope();
  onTestFinished(() => scope.close());
  const analysis = createDirectAnalysis(environment);
  const logger = createLogger("cli", "silent");
  return {
    "javascript-application": async (path, signal) => {
      const result = await analyzeJavaScriptApplication(
        { input_path: path },
        scope,
        { environment, signal },
      );
      return result.ok ? ok(result.value) : err(result.error);
    },
    artifact: async (path, signal) => {
      const value = await analysis.runProviderAnalysis(
        path,
        "inspect_artifact",
        { integrity_policy: "fail" },
        logger,
        signal,
      );
      return typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        "error" in value
        ? err(value)
        : ok(value);
    },
  };
};

const generatedAt = (markdown: string): Date => {
  const match = /^- \*\*Generato:\*\* (\S+) con /mu.exec(markdown);
  expect(match).not.toBeNull();
  return new Date(match![1]!);
};

/** The CLI files must equal a fresh in-process rendering byte for byte. */
const expectParity = async (
  target: string,
  host: Awaited<ReturnType<typeof createIsolatedHost>>,
): Promise<void> => {
  const output = join(host.home, "..", "tmp", "rapporti");
  const cli = await runLauncher(host, [
    "report",
    target,
    "--authorized",
    "--output-dir",
    output,
    "--json",
  ]);
  expect(cli.exitCode, cli.stderr).toBe(0);
  const { files } = cliOutputSchema.parse(JSON.parse(cli.stdout));
  const cliMarkdown = await readFile(files.markdown, "utf8");
  const cliHtml = await readFile(files.html, "utf8");

  const report = await generateReport(
    { path: resolve(target), authorized: true },
    adapterNeutralPorts(host.environment),
    {
      generatedAt: generatedAt(cliMarkdown),
      homeDirectory: host.home,
      signal: new AbortController().signal,
    },
  );
  if (!report.ok) throw new Error(JSON.stringify(report.error));
  expect(renderReportMarkdown(report.value)).toBe(cliMarkdown);
  expect(renderReportHtml(report.value)).toBe(cliHtml);
  expect(join(output, reportFileName(report.value, "markdown"))).toBe(
    files.markdown,
  );
  expect(join(output, reportFileName(report.value, "html"))).toBe(files.html);
};

describe("InsideApp report parity across adapters", () => {
  it(
    "renders the same JavaScript application report from the CLI and the shared service",
    async () => {
      const host = await createIsolatedHost();
      await expectParity("tests/fixtures/examples/notes-electron", host);
      await expectNoHostSideEffects(host);
    },
    TIMEOUT_MS,
  );

  it(
    "renders the same artifact report from the CLI and the shared service",
    async () => {
      const host = await createIsolatedHost();
      const archive = join(host.home, "..", "tmp", "bundle.zip");
      const writer = new ZipWriter(new Uint8ArrayWriter());
      await writer.add("main.js", new TextReader("console.log(1);\n"));
      await writeFile(archive, await writer.close());
      await expectParity(archive, host);
      await expectNoHostSideEffects(host);
    },
    TIMEOUT_MS,
  );
});
