import { z } from "zod";

import { absoluteLocalPathStringSchema } from "../localPath.js";

/**
 * InsideApp report model: an Italian, reader-oriented projection of completed
 * Evidence. Renderers (HTML, Markdown) only present this model; they never
 * reinterpret analysis results.
 */

/** The four reader-facing certainty classes, ordered from strongest. */
export const REPORT_CLAIM_KINDS = [
  "observed",
  "derived",
  "hypothesis",
  "unknown",
] as const;

export type ReportClaimKind = (typeof REPORT_CLAIM_KINDS)[number];

/** Italian labels shown to readers for each certainty class. */
export const REPORT_CLAIM_LABELS: Readonly<Record<ReportClaimKind, string>> = {
  observed: "Osservato",
  derived: "Derivato",
  hypothesis: "Ipotesi",
  unknown: "Sconosciuto",
};

/** What each certainty class means, printed in every report legend. */
export const REPORT_CLAIM_DEFINITIONS: Readonly<
  Record<ReportClaimKind, string>
> = {
  observed:
    "Letto direttamente dai byte o dal codice dell'applicazione (stato del motore: observed).",
  derived:
    "Dedotto dall'analisi statica con confidenza alta, ad esempio un collegamento tra file o una chiamata (stato: inferred, confidenza high).",
  hypothesis:
    "Possibile ma non dimostrato: dedotto con confidenza media o bassa (stato: inferred, confidenza medium o low).",
  unknown:
    "Non determinabile con l'analisi eseguita: valori dinamici, parti non esaminate o assenze non dimostrabili.",
};

/** Where a claim can be checked; every field is optional because sources vary. */
export interface ReportEvidenceReference {
  /** Evidence record that carries the fact, when one is addressable. */
  readonly evidence_id: string | null;
  /** Application-relative file or entry path. */
  readonly path: string | null;
  /** Human-readable position inside {@link path}, such as `riga 5, colonna 0`. */
  readonly position: string | null;
  /** SHA-256 of the exact bytes that support the claim. */
  readonly sha256: string | null;
  /** Extractor operation that produced the fact. */
  readonly method: string | null;
  /** Engine state and confidence exactly as reported, e.g. `inferred/high`. */
  readonly engine_assessment: string;
  /** Further supporting locations for the same claim. */
  readonly additional_occurrences: number;
}

export interface ReportClaim {
  readonly kind: ReportClaimKind;
  /** One self-contained Italian sentence. */
  readonly statement: string;
  readonly evidence: ReportEvidenceReference | null;
}

export const REPORT_SECTION_IDS = [
  "summary",
  "components",
  "communications",
  "data",
  "security",
  "limits",
] as const;

export type ReportSectionId = (typeof REPORT_SECTION_IDS)[number];

export const REPORT_SECTION_TITLES: Readonly<Record<ReportSectionId, string>> =
  {
    summary: "In breve",
    components: "Componenti",
    communications: "Comunicazioni",
    data: "Dati e file",
    security: "Sicurezza",
    limits: "Limiti e sconosciuti",
  };

export interface ReportSection {
  readonly id: ReportSectionId;
  readonly title: string;
  readonly claims: readonly ReportClaim[];
}

/** One additional analysis that contributed claims, or why it could not. */
export type ReportSupplementRecord =
  | {
      readonly operation: string;
      readonly status: "completed";
      readonly evidence_id: string;
    }
  | {
      readonly operation: string;
      readonly status: "failed";
      /** Engine error code only; engine messages may contain local paths. */
      readonly failure_code: string;
    };

export interface InsideAppReport {
  readonly schema: "InsideAppReport";
  readonly schema_version: 1;
  readonly title: string;
  readonly generated_at: string;
  readonly generator: { readonly name: string; readonly version: string };
  readonly authorization: "declared-by-user";
  readonly subject: {
    readonly name: string;
    readonly path: string | null;
    readonly format: string | null;
    readonly sha256: string | null;
  };
  readonly analysis: {
    readonly operation: string;
    readonly evidence_id: string;
    readonly provider: string;
    readonly description: string;
    /** Further analyses of the same item; a failed one never hides the others. */
    readonly supplements: readonly ReportSupplementRecord[];
  };
  readonly sections: readonly ReportSection[];
  /** Engine limitations, verbatim (in English). */
  readonly engine_limitations: readonly string[];
  readonly counts: Readonly<Record<ReportClaimKind, number>>;
}

const KIND_RANK: Readonly<Record<ReportClaimKind, number>> = {
  observed: 0,
  derived: 1,
  hypothesis: 2,
  unknown: 3,
};

/**
 * Map an engine fact state and confidence to a reader class without promoting
 * inference: only `observed` facts are Osservato, and only high-confidence
 * inference is Derivato.
 */
export const classifyEngineAssessment = (
  state: string,
  confidence: string,
): ReportClaimKind => {
  if (state === "observed") return "observed";
  if (state === "inferred")
    return confidence === "high" || confidence === "exact"
      ? "derived"
      : "hypothesis";
  return "unknown";
};

/**
 * Collects claims per section. Repeated statements keep their strongest
 * class and count the extra supporting occurrences instead of repeating.
 */
export class ReportClaimCollector {
  readonly #sections = new Map<ReportSectionId, Map<string, ReportClaim>>(
    REPORT_SECTION_IDS.map((id) => [id, new Map()]),
  );

  add(section: ReportSectionId, claim: ReportClaim): void {
    const claims = this.#sections.get(section)!;
    const previous = claims.get(claim.statement);
    if (previous === undefined) {
      claims.set(claim.statement, claim);
      return;
    }
    const [stronger, weaker] =
      KIND_RANK[claim.kind] < KIND_RANK[previous.kind]
        ? [claim, previous]
        : [previous, claim];
    const extra =
      (weaker.evidence === null ? 0 : 1) +
      (weaker.evidence?.additional_occurrences ?? 0);
    claims.set(
      claim.statement,
      stronger.evidence === null
        ? stronger
        : {
            ...stronger,
            evidence: {
              ...stronger.evidence,
              additional_occurrences:
                stronger.evidence.additional_occurrences + extra,
            },
          },
    );
  }

  /** Add every claim of another collector, with the same merging rules. */
  merge(other: ReportClaimCollector): void {
    for (const section of other.sections())
      for (const claim of section.claims) this.add(section.id, claim);
  }

  sections(): readonly ReportSection[] {
    return REPORT_SECTION_IDS.map((id) => ({
      id,
      title: REPORT_SECTION_TITLES[id],
      claims: [...this.#sections.get(id)!.values()].sort(
        (left, right) => KIND_RANK[left.kind] - KIND_RANK[right.kind],
      ),
    }));
  }
}

/** Count claims per class across all sections. */
export const countReportClaims = (
  sections: readonly ReportSection[],
): Readonly<Record<ReportClaimKind, number>> => {
  const counts = { observed: 0, derived: 0, hypothesis: 0, unknown: 0 };
  for (const section of sections)
    for (const claim of section.claims) counts[claim.kind] += 1;
  return counts;
};

const claimKindSchema = z.enum(REPORT_CLAIM_KINDS);

const evidenceReferenceSchema = z.strictObject({
  evidence_id: z.string().nullable(),
  path: z.string().nullable(),
  position: z.string().nullable(),
  sha256: z.string().nullable(),
  method: z.string().nullable(),
  engine_assessment: z.string(),
  additional_occurrences: z.int().min(0),
});

const supplementRecordSchema = z.discriminatedUnion("status", [
  z.strictObject({
    operation: z.string(),
    status: z.literal("completed"),
    evidence_id: z.string(),
  }),
  z.strictObject({
    operation: z.string(),
    status: z.literal("failed"),
    failure_code: z.string(),
  }),
]);

/** Strict shape of an InsideApp report, as MCP delivers it. */
export const insideAppReportSchema = z.strictObject({
  schema: z.literal("InsideAppReport"),
  schema_version: z.literal(1),
  title: z.string(),
  generated_at: z.string(),
  generator: z.strictObject({ name: z.string(), version: z.string() }),
  authorization: z.literal("declared-by-user"),
  subject: z.strictObject({
    name: z.string(),
    path: z.string().nullable(),
    format: z.string().nullable(),
    sha256: z.string().nullable(),
  }),
  analysis: z.strictObject({
    operation: z.string(),
    evidence_id: z.string(),
    provider: z.string(),
    description: z.string(),
    supplements: z.array(supplementRecordSchema),
  }),
  sections: z.array(
    z.strictObject({
      id: z.enum(REPORT_SECTION_IDS),
      title: z.string(),
      claims: z.array(
        z.strictObject({
          kind: claimKindSchema,
          statement: z.string(),
          evidence: evidenceReferenceSchema.nullable(),
        }),
      ),
    }),
  ),
  engine_limitations: z.array(z.string()),
  counts: z.strictObject({
    observed: z.int().min(0),
    derived: z.int().min(0),
    hypothesis: z.int().min(0),
    unknown: z.int().min(0),
  }),
}) satisfies z.ZodType<InsideAppReport>;

/** Provider identity of report Evidence produced by `create_report`. */
export const INSIDEAPP_REPORT_PROVIDER = {
  id: "insideapp-report",
  name: "InsideApp report",
  version: "1",
} as const;

/** Input of the `create_report` MCP tool. */
export const createReportInputSchema = z.strictObject({
  path: absoluteLocalPathStringSchema.describe(
    "Absolute local path of one application, file or folder the user chose: a JavaScript/Electron folder or .asar, a macOS .app bundle, a Windows .exe/.dll, a SQLite database or another file. Disk roots, first-level folders and the home folder are refused.",
  ),
  authorized: z
    .boolean()
    .describe(
      "Set true only after the user stated that the software is theirs or that they may analyze it. false is refused before anything is read.",
    ),
});
