import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { Logger } from "pino";

import type { NativeAnalysisSession } from "../composition/nativeAnalysisSession.js";
import type { AnalysisErrorProjection } from "../domain/analysisErrorProjection.js";
import { z } from "zod";

import { parseContainingProcedureResolution } from "../domain/hopperValues.js";
import type { GuiAnalysisFailure } from "./guiAnalyses.js";
import {
  nativeFunctionView,
  nativeOverview,
  type NativeFunctionView,
  type NativeOverview,
} from "./guiNativeView.js";
import type { GuiTarget } from "./guiTargets.js";

/** Explored function dossiers kept per session; older ones are dropped. */
export const GUI_MAX_NATIVE_FUNCTIONS = 200;
/** References resolved to their functions per request. */
const MAX_REFERENCES = 50;

export type GuiNativeStatus = "starting" | "ready" | "failed" | "cancelled";

/** Whether a Ghidra installation is selected for this process. */
export type GuiNativeEngine = "configured" | "not_configured";

interface GuiNativeRun {
  readonly id: string;
  readonly target: GuiTarget;
  readonly startedAt: number;
  readonly controller: AbortController;
  status: GuiNativeStatus;
  phase: string;
  finishedAt: number | undefined;
  failure: GuiAnalysisFailure | undefined;
  overview: NativeOverview | undefined;
  session: NativeAnalysisSession | undefined;
  readonly functions: Map<string, NativeFunctionView>;
}

export type NativeOutcome<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly status: number; readonly error: string };

const failureOf = ({
  code,
  category,
}: AnalysisErrorProjection): GuiAnalysisFailure => ({
  code,
  category,
});

/**
 * Static native-code exploration for the GUI: one Ghidra session at a time on
 * the item the user chose. Results are projected without local paths.
 */
export class GuiNative {
  #run: GuiNativeRun | undefined;
  /** Serializes engine calls; the session answers one question at a time. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly environment: Readonly<Record<string, string | undefined>>,
    private readonly logger: Logger,
    private readonly now: () => number,
  ) {}

  /** A selected installation, checked again by the engine when it opens. */
  get engine(): GuiNativeEngine {
    const home = this.environment.GHIDRA_INSTALL_DIR;
    return home !== undefined &&
      home.length > 0 &&
      existsSync(join(home, "support", "analyzeHeadless"))
      ? "configured"
      : "not_configured";
  }

  get current(): GuiNativeRun | undefined {
    return this.#run;
  }

  #serialized<Value>(operation: () => Promise<Value>): Promise<Value> {
    const next = this.#queue.then(operation, operation);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  /** Open the target with Ghidra, replacing any earlier session. */
  async start(target: GuiTarget): Promise<GuiNativeRun> {
    await this.close();
    const run: GuiNativeRun = {
      id: randomBytes(16).toString("base64url"),
      target,
      startedAt: this.now(),
      controller: new AbortController(),
      status: "starting",
      phase: "Avvio di Ghidra e analisi del programma",
      finishedAt: undefined,
      failure: undefined,
      overview: undefined,
      session: undefined,
      functions: new Map(),
    };
    this.#run = run;
    void this.#serialized(() => this.#open(run));
    return run;
  }

  async #open(run: GuiNativeRun): Promise<void> {
    const { signal } = run.controller;
    const settle = (status: GuiNativeStatus, failure?: GuiAnalysisFailure) => {
      run.status = signal.aborted ? "cancelled" : status;
      run.failure = signal.aborted ? undefined : failure;
      run.finishedAt = this.now();
    };
    try {
      const { createNativeAnalysisSession } =
        await import("../composition/nativeAnalysisSession.js");
      const created = await createNativeAnalysisSession(
        this.environment,
        this.logger,
      );
      if (!created.ok) return settle("failed", failureOf(created.error));
      run.session = created.value;
      const opened = await created.value.open(run.target.path, signal);
      if (!opened.ok) return settle("failed", failureOf(opened.error));
      run.phase = "Lettura di funzioni, stringhe e segmenti";
      const procedures = await created.value.list("list_procedures", signal);
      if (!procedures.ok) return settle("failed", failureOf(procedures.error));
      const strings = await created.value.list("list_strings", signal);
      if (!strings.ok) return settle("failed", failureOf(strings.error));
      const segments = await created.value.list("list_segments", signal);
      if (!segments.ok) return settle("failed", failureOf(segments.error));
      run.overview = nativeOverview(opened.value, run.target.name, {
        procedures: procedures.value,
        strings: strings.value,
        segments: segments.value,
      });
      run.phase = "Pronto";
      settle("ready");
    } catch {
      settle("failed", { code: "internal", category: "internal" });
    }
    if (run.status !== "ready") await this.#release(run);
  }

  async #release(run: GuiNativeRun): Promise<void> {
    const session = run.session;
    run.session = undefined;
    await session?.close().catch(() => undefined);
  }

  #ready(): NativeOutcome<GuiNativeRun> {
    const run = this.#run;
    if (run === undefined)
      return { ok: false, status: 404, error: "no_native_analysis" };
    if (run.status !== "ready" || run.session === undefined)
      return { ok: false, status: 409, error: "native_analysis_not_ready" };
    return { ok: true, value: run };
  }

  /** The complete dossier of one listed function, analyzed on first request. */
  async function(address: string): Promise<NativeOutcome<NativeFunctionView>> {
    const ready = this.#ready();
    if (!ready.ok) return ready;
    const run = ready.value;
    const entry = run.overview?.functions.find(
      (candidate) => candidate.address === address,
    );
    if (entry === undefined || entry.external)
      return { ok: false, status: 404, error: "unknown_function" };
    const cached = run.functions.get(address);
    if (cached !== undefined) return { ok: true, value: cached };
    return this.#serialized(async () => {
      const session = run.session;
      if (session === undefined)
        return { ok: false, status: 409, error: "native_analysis_not_ready" };
      const evidence = await session.analyzeFunction(
        address,
        run.controller.signal,
      );
      if (!evidence.ok)
        return { ok: false, status: 422, error: evidence.error.code };
      const view = nativeFunctionView(evidence.value);
      run.functions.set(address, view);
      for (const key of run.functions.keys()) {
        if (run.functions.size <= GUI_MAX_NATIVE_FUNCTIONS) break;
        run.functions.delete(key);
      }
      return { ok: true, value: view };
    });
  }

  /** Code that references a listed string, resolved to its functions. */
  async stringReferences(address: string): Promise<
    NativeOutcome<
      readonly {
        readonly from: string;
        readonly function: {
          readonly address: string;
          readonly name: string;
        } | null;
      }[]
    >
  > {
    const ready = this.#ready();
    if (!ready.ok) return ready;
    const run = ready.value;
    if (
      run.overview?.strings.some((entry) => entry.address === address) !== true
    )
      return { ok: false, status: 404, error: "unknown_string" };
    return this.#serialized(async () => {
      const session = run.session;
      if (session === undefined)
        return { ok: false, status: 409, error: "native_analysis_not_ready" };
      const { signal } = run.controller;
      const references = await session.xrefs(address, signal);
      if (!references.ok)
        return { ok: false, status: 422, error: references.error.code };
      // Ghidra reports xrefs as the source addresses of each reference.
      const sources = z.array(z.string()).safeParse(references.value);
      if (!sources.success)
        return { ok: false, status: 422, error: "invalid_output" };
      const resolved = [];
      for (const from of sources.data.slice(0, MAX_REFERENCES)) {
        const containing = await session.containingProcedure(from, signal);
        const procedure = containing.ok
          ? parseContainingProcedureResolution(containing.value)
          : undefined;
        resolved.push({
          from,
          function:
            procedure?.ok === true && procedure.value.found
              ? {
                  address: procedure.value.procedure.address,
                  name: procedure.value.procedure.name,
                }
              : null,
        });
      }
      return { ok: true, value: resolved };
    });
  }

  /** Cancel a start in progress; the session closes once its step settles. */
  cancel(): boolean {
    const run = this.#run;
    if (run?.status !== "starting") return false;
    run.controller.abort();
    return true;
  }

  /** Close the session and forget its results. */
  async close(): Promise<void> {
    const run = this.#run;
    this.#run = undefined;
    if (run === undefined) return;
    run.controller.abort();
    await this.#serialized(() => this.#release(run));
  }
}
