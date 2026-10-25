import { describe, expect, it } from "vitest";

import {
  classifyEngineAssessment,
  countReportClaims,
  ReportClaimCollector,
  type ReportEvidenceReference,
} from "./insideAppReport.js";

const evidence = (
  engine_assessment: string,
  additional_occurrences = 0,
): ReportEvidenceReference => ({
  evidence_id: "ev_example",
  path: "main.js",
  position: "riga 1, colonna 1",
  sha256: null,
  method: "example",
  engine_assessment,
  additional_occurrences,
});

describe("InsideApp report classification", () => {
  it("never promotes inference to observation", () => {
    expect(classifyEngineAssessment("observed", "exact")).toBe("observed");
    expect(classifyEngineAssessment("observed", "low")).toBe("observed");
    expect(classifyEngineAssessment("inferred", "high")).toBe("derived");
    expect(classifyEngineAssessment("inferred", "medium")).toBe("hypothesis");
    expect(classifyEngineAssessment("inferred", "low")).toBe("hypothesis");
    expect(classifyEngineAssessment("unknown", "unknown")).toBe("unknown");
    expect(classifyEngineAssessment("unavailable", "unknown")).toBe("unknown");
  });

  it("merges repeated statements under the strongest class and counts their occurrences", () => {
    const collector = new ReportClaimCollector();
    const statement = "Usa le API di Electron.";
    collector.add("components", {
      kind: "hypothesis",
      statement,
      evidence: evidence("inferred/low", 2),
    });
    collector.add("components", {
      kind: "observed",
      statement,
      evidence: evidence("observed/exact"),
    });
    collector.add("components", {
      kind: "hypothesis",
      statement,
      evidence: evidence("inferred/low"),
    });
    collector.add("security", { kind: "unknown", statement, evidence: null });

    const sections = collector.sections();
    expect(sections.map(({ id }) => id)).toEqual([
      "summary",
      "components",
      "communications",
      "data",
      "security",
      "limits",
    ]);
    expect(sections[1]!.claims).toEqual([
      {
        kind: "observed",
        statement,
        evidence: evidence("observed/exact", 4),
      },
    ]);
    expect(countReportClaims(sections)).toEqual({
      observed: 1,
      derived: 0,
      hypothesis: 0,
      unknown: 1,
    });
  });
});
