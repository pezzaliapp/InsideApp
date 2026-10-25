import type { Logger } from "pino";

import type { BinarySession } from "../application/binary/BinarySession.js";
import { parseConfig } from "../config/parseConfig.js";
import {
  projectAnalysisError,
  type AnalysisErrorProjection,
} from "../domain/analysisErrorProjection.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import type { Evidence } from "../domain/evidence.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { err, ok, type Result } from "../domain/result.js";

type Outcome<Value> = Result<Value, AnalysisErrorProjection>;

/**
 * One static native-code session on one target, kept open so later questions
 * reuse Ghidra's analysis instead of starting it again. Every operation is
 * read-only: Ghidra imports the target into an ephemeral project and never
 * executes or modifies it.
 */
export interface NativeAnalysisSession {
  readonly open: (
    path: string,
    signal: AbortSignal,
  ) => Promise<Outcome<BinaryTarget>>;
  /** Raw provider result of one read-only inventory operation. */
  readonly list: (
    operation: "list_procedures" | "list_strings" | "list_segments",
    signal: AbortSignal,
  ) => Promise<Outcome<JsonValue>>;
  readonly xrefs: (
    address: string,
    signal: AbortSignal,
  ) => Promise<Outcome<JsonValue>>;
  readonly containingProcedure: (
    address: string,
    signal: AbortSignal,
  ) => Promise<Outcome<JsonValue>>;
  /** Complete function dossier Evidence, as the CLI `function` command builds it. */
  readonly analyzeFunction: (
    procedure: string,
    signal: AbortSignal,
  ) => Promise<Outcome<Evidence>>;
  readonly close: () => Promise<void>;
}

/** The free local engine behind the GUI; commercial engines are excluded. */
const PROVIDER = "ghidra";

export const createNativeAnalysisSession = async (
  environment: Readonly<Record<string, string | undefined>>,
  logger: Logger,
): Promise<Outcome<NativeAnalysisSession>> => {
  const config = parseConfig(environment);
  if (!config.ok) return err(projectAnalysisError(config.error));
  // Loaded on use so starting the GUI never loads the provider runtimes.
  const [{ createBinarySession }, { executeFunctionAnalysisEvidence }] =
    await Promise.all([
      import("./binary.js"),
      import("../application/FunctionAnalysisEvidence.js"),
    ]);
  const session: BinarySession = createBinarySession(
    config.value,
    logger,
    environment,
  );
  let target: BinaryTarget | undefined;
  const execute = async (
    operation: Parameters<BinarySession["execute"]>[0],
    arguments_: Readonly<Record<string, JsonValue>>,
    signal: AbortSignal,
  ): Promise<Outcome<JsonValue>> => {
    const result = await session.execute(operation, arguments_, { signal });
    return result.ok
      ? ok(result.value.result)
      : err(projectAnalysisError(result.error));
  };
  return ok({
    open: async (path, signal) => {
      const opened = await session.open(path, {
        providerId: PROVIDER,
        signal,
      });
      if (!opened.ok) return err(projectAnalysisError(opened.error));
      target = opened.value;
      return ok(opened.value);
    },
    list: (operation, signal) => execute(operation, {}, signal),
    xrefs: (address, signal) => execute("xrefs", { address }, signal),
    containingProcedure: (address, signal) =>
      execute("resolve_containing_procedure", { address }, signal),
    analyzeFunction: async (procedure, signal) => {
      if (target === undefined)
        throw new Error("Open a target before analyzing a function");
      const evidence = await executeFunctionAnalysisEvidence(
        session,
        { procedure },
        target,
        { signal },
      );
      return evidence.ok
        ? ok(evidence.value)
        : err(projectAnalysisError(evidence.error));
    },
    close: async () => {
      await session.close();
    },
  });
};
