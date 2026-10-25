import type { Logger } from "pino";

import type {
  ReportAnalysisPorts,
  ReportEvidenceSet,
  ReportSupplement,
} from "../application/report/generateReport.js";
import { analysisCliErrorEnvelopeSchema } from "../contracts/errorSchemas.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { artifactInspectionResultSchema } from "../domain/artifactInspection.js";
import type { Evidence } from "../domain/evidence.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  createNativeExportsService,
  createPeCertificatesService,
  createPeImportsService,
  createPeResourcesService,
} from "./binaryDiagnostics.js";
import { createDesktopApplicationService } from "./desktop.js";
import { createDirectAnalysis } from "./directAnalysis.js";
import { createSqliteDatabaseService } from "./sqlite.js";

/** Bundle traversal bound for reports; larger bundles report partial coverage. */
const REPORT_MAX_BUNDLE_ENTRIES = 20_000;

/** One step: completed Evidence JSON, or the projected failure. */
type Step = Result<JsonValue, JsonValue>;

interface ClosableService {
  close(): Promise<void>;
}

/** Run one service call and always release the service. */
const serviceStep = async <Service extends ClosableService>(
  service: Service,
  run: (service: Service) => Promise<Result<Evidence, AnalysisError>>,
): Promise<Step> => {
  let result: Result<Evidence, AnalysisError>;
  try {
    result = await run(service);
  } finally {
    // A failed close keeps the error; the report then states the step failed.
    await service.close();
  }
  return result.ok
    ? ok(result.value as unknown as JsonValue)
    : err(projectAnalysisError(result.error) as unknown as JsonValue);
};

const providerStep = (value: JsonValue): Step =>
  analysisCliErrorEnvelopeSchema.safeParse(value).success
    ? err(value)
    : ok(value);

const failureCode = (failure: JsonValue): string =>
  typeof failure === "object" &&
  failure !== null &&
  !Array.isArray(failure) &&
  typeof failure.code === "string"
    ? failure.code
    : "analysis_failed";

const supplement = async (
  operation: string,
  run: () => Promise<Step>,
): Promise<ReportSupplement> => {
  try {
    const step = await run();
    return step.ok
      ? { operation, evidence: step.value }
      : { operation, failureCode: failureCode(step.error) };
  } catch {
    return { operation, failureCode: "internal" };
  }
};

/** Run supplements one at a time; cancellation stops the remaining ones. */
const supplements = async (
  steps: readonly (readonly [string, () => Promise<Step>])[],
  signal: AbortSignal,
): Promise<readonly ReportSupplement[]> => {
  const done: ReportSupplement[] = [];
  for (const [operation, run] of steps) {
    if (signal.aborted) break;
    done.push(await supplement(operation, run));
  }
  return done;
};

export interface ReportAnalysisDependencies {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly logger: Logger;
  /**
   * JavaScript application analysis, owned by the adapter that keeps the
   * worker. Resolves to Evidence JSON or a projected failure.
   */
  readonly javascript: (path: string, signal: AbortSignal) => Promise<Step>;
}

type ProviderOperation = Parameters<
  ReturnType<typeof createDirectAnalysis>["runProviderAnalysis"]
>[1];

/** A provider-backed step factory bound to one analysis run. */
type ProviderStep = (
  operation: ProviderOperation,
  args?: Readonly<Record<string, JsonValue>>,
) => () => Promise<Step>;

const settle = async (
  primary: Step,
  more: () => Promise<readonly ReportSupplement[]>,
): Promise<Result<ReportEvidenceSet, JsonValue>> =>
  primary.ok
    ? ok({ primary: primary.value, supplements: await more() })
    : err(primary.error);

/** Supplements chosen from the format the inventory owner classified. */
const artifactSupplementSteps = (
  format: string | undefined,
  path: string,
  signal: AbortSignal,
  provider: ProviderStep,
): readonly (readonly [string, () => Promise<Step>])[] => {
  if (format === "pe")
    return [
      ["inspect_managed_artifact", provider("inspect_managed_artifact")],
      [
        "inspect_pe_imports",
        () =>
          serviceStep(createPeImportsService(), (service) =>
            service.inspect({ path }, { signal }),
          ),
      ],
      [
        "inspect_pe_resources",
        () =>
          serviceStep(createPeResourcesService(), (service) =>
            service.inspect({ path }, { signal }),
          ),
      ],
      [
        "inspect_pe_certificates",
        () =>
          serviceStep(createPeCertificatesService(), (service) =>
            service.inspect({ path }, { signal }),
          ),
      ],
      [
        "inspect_native_exports",
        () =>
          serviceStep(createNativeExportsService(), (service) =>
            service.inspect({ path }, { signal }),
          ),
      ],
    ];
  if (format === "mach-o" || format === "mach-o-universal")
    return [
      ["inspect_macho", provider("inspect_macho")],
      ["inspect_signature", provider("inspect_signature")],
    ];
  return [];
};

const classifiedFormat = (primary: Step): string | undefined => {
  if (!primary.ok) return undefined;
  const evidence = primary.value as { normalized_result?: unknown };
  const inspection = artifactInspectionResultSchema.safeParse(
    evidence.normalized_result,
  );
  return inspection.success ? inspection.data.subject.root_format : undefined;
};

/**
 * Engine operations behind each report lane, shared by the CLI and the GUI.
 * Every operation is static: nothing analyzed is executed. A failed primary
 * analysis fails the report; a failed supplement is recorded in it.
 */
export const createReportAnalysisPorts = ({
  environment,
  logger,
  javascript,
}: ReportAnalysisDependencies): ReportAnalysisPorts<JsonValue> => {
  const direct = createDirectAnalysis(environment);
  const providerFor =
    (path: string, signal: AbortSignal): ProviderStep =>
    (operation, args = {}) =>
    async () =>
      providerStep(
        await direct.runProviderAnalysis(path, operation, args, logger, signal),
      );
  return {
    "javascript-application": async (path, signal) =>
      settle(await javascript(path, signal), async () => []),
    "apple-bundle": async (path, signal) => {
      const provider = providerFor(path, signal);
      return settle(
        await serviceStep(createDesktopApplicationService(), (service) =>
          service.inspect(
            { path, max_entries: REPORT_MAX_BUNDLE_ENTRIES },
            { signal },
          ),
        ),
        () =>
          supplements(
            [
              ["inspect_plist", provider("inspect_plist")],
              ["inspect_macho", provider("inspect_macho")],
              ["inspect_signature", provider("inspect_signature")],
            ],
            signal,
          ),
      );
    },
    sqlite: async (path, signal) =>
      settle(
        // Schema only: no table is selected, so no row is ever read.
        await serviceStep(createSqliteDatabaseService(environment), (service) =>
          service.inspect({ path, schema_scope: "database" }, { signal }),
        ),
        async () => [],
      ),
    artifact: async (path, signal) => {
      const provider = providerFor(path, signal);
      const primary = await provider("inspect_artifact", {
        integrity_policy: "fail",
      })();
      // The inventory owner classified the bytes; supplements follow its format.
      return settle(primary, () =>
        supplements(
          artifactSupplementSteps(
            classifiedFormat(primary),
            path,
            signal,
            provider,
          ),
          signal,
        ),
      );
    },
  };
};
