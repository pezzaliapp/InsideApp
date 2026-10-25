import type { ReportEvidenceReference } from "../../domain/report/insideAppReport.js";

/** Longest target-controlled text quoted in one report sentence. */
const MAX_QUOTED_CHARACTERS = 160;

/**
 * Quote target-controlled text for a sentence. Names come from the analyzed
 * application, so they are bounded, and control and bidirectional-override
 * characters are made visible instead of altering how the sentence reads.
 */
export const quoted = (value: string): string => {
  const visible = value.replace(
    /[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  const bounded =
    visible.length > MAX_QUOTED_CHARACTERS
      ? `${visible.slice(0, MAX_QUOTED_CHARACTERS).replace(/[\ud800-\udbff]$/u, "")}…`
      : visible;
  return `«${bounded}»`;
};

/** Record-level provenance shared by facts without a finer location. */
export interface RecordContext {
  readonly evidenceId: string;
  readonly operation: string;
  readonly subjectSha256: string | null;
  readonly confidence: string;
}

export const recordEvidence = (
  record: RecordContext,
): ReportEvidenceReference => ({
  evidence_id: record.evidenceId,
  path: null,
  position: null,
  sha256: record.subjectSha256,
  method: record.operation,
  engine_assessment: `record/${record.confidence}`,
  additional_occurrences: 0,
});
