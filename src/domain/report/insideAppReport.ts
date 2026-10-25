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
