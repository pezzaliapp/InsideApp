import type { Logger } from "pino";

import { createReportEvidence } from "../application/report/createReportEvidence.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { createReportAnalysisPorts } from "../composition/reportAnalysis.js";
import { homeDirectoryFromEnvironment } from "../config/homeDirectory.js";
import { toolContract } from "../contracts/toolContracts.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { err, ok } from "../domain/result.js";
import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { runAdmittedToolOperation } from "./admittedToolOperation.js";
import { deliverEvidenceResult } from "./contractToolHandler.js";
import { recordSessionEvidenceSources } from "./sessionEvidence.js";
import { logToolExecution } from "./toolLogging.js";
import { applicationToolRegistrationOptions } from "./toolRegistrationOptions.js";

interface ReportToolRegistration {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly logger: Logger;
  /** The server-wide scope that owns the JavaScript analysis worker. */
  readonly artifactResources: ArtifactResourceScope;
  readonly recordEvidence?: EvidenceWriter["recordEvidence"] | undefined;
  readonly withAdmittedAnalysis?: WithAdmittedAnalysis | undefined;
}

/** Bind `create_report` to the shared report service and session Evidence. */
export const registerReportTool = (
  server: EvidenceMcpServer,
  options: ReportToolRegistration,
): void => {
  const contract = toolContract("create_report");
  const ports = createReportAnalysisPorts({
    environment: options.environment,
    logger: options.logger,
    javascript: async (path, signal) => {
      const { analyzeJavaScriptApplication } =
        await import("../application/javascript/JavaScriptApplicationService.js");
      const result = await analyzeJavaScriptApplication(
        { input_path: path },
        options.artifactResources,
        { environment: options.environment, signal },
      );
      return result.ok
        ? ok(result.value as unknown as JsonValue)
        : err(projectAnalysisError(result.error));
    },
  });
  const homeDirectory = homeDirectoryFromEnvironment(
    options.environment,
    process.platform,
  );
  server.registerTool(
    contract.name,
    applicationToolRegistrationOptions(contract),
    async (input, context) =>
      runAdmittedToolOperation(
        server,
        options.withAdmittedAnalysis,
        contract.name,
        context.mcpReq.signal,
        async () => {
          const result = await logToolExecution(
            options.logger,
            contract.name,
            () =>
              createReportEvidence(input, ports, {
                homeDirectory,
                signal: context.mcpReq.signal,
              }),
          );
          if (!result.ok)
            return result.error.kind === "analysis"
              ? server.delivery.toProjectedErrorToolResult(
                  result.error.projection,
                  contract.returnsTargetContent,
                )
              : server.delivery.toErrorToolResult(
                  result.error.error,
                  contract.returnsTargetContent,
                );
          // Sources first, so the report's Evidence links resolve in the session.
          const recordedSources = recordSessionEvidenceSources(
            options.recordEvidence,
            result.value.sources,
          );
          if (!recordedSources.ok)
            return server.delivery.toErrorToolResult(
              recordedSources.error,
              contract.returnsTargetContent,
            );
          return deliverEvidenceResult(
            server,
            ok(result.value.evidence),
            contract,
            options.recordEvidence,
          );
        },
      ),
  );
};
