import { describe, expect, it } from "vitest";

import {
  countReportClaims,
  REPORT_SECTION_IDS,
  REPORT_SECTION_TITLES,
  type InsideAppReport,
  type ReportSection,
} from "../../domain/report/insideAppReport.js";
import {
  renderReportHtml,
  renderReportMarkdown,
} from "./renderInsideAppReport.js";

const sections: readonly ReportSection[] = REPORT_SECTION_IDS.map((id) => ({
  id,
  title: REPORT_SECTION_TITLES[id],
  claims:
    id === "communications"
      ? [
          {
            kind: "observed",
            statement: "Canale «a`b*c_<x>&|~[y]».",
            evidence: {
              evidence_id: "ev_1",
              path: "dir/`odd`.js",
              position: "riga 2, colonna 1",
              sha256: "ab",
              method: "observe",
              engine_assessment: "observed/exact",
              additional_occurrences: 1,
            },
          },
        ]
      : [],
}));

const report: InsideAppReport = {
  schema: "InsideAppReport",
  schema_version: 1,
  title: "Rapporto InsideApp — <demo>",
  generated_at: "2026-01-01T00:00:00.000Z",
  generator: { name: "InsideApp — PezzaliAPP", version: "0.0.0" },
  authorization: "declared-by-user",
  subject: {
    name: "<demo>",
    path: "~/demo",
    format: "directory",
    sha256: null,
  },
  analysis: {
    operation: "analyze_javascript_application",
    evidence_id: "ev_0",
    provider: "test",
    description: "Analisi di prova.",
    supplements: [],
  },
  sections,
  engine_limitations: ["Static <only>."],
  counts: countReportClaims(sections),
};

describe("InsideApp report rendering", () => {
  it("escapes Markdown syntax and fences code values containing backticks", () => {
    const markdown = renderReportMarkdown(report);
    expect(markdown).toContain(
      [
        "- **Osservato** — Canale «a\\`b\\*c\\_\\<x\\>\\&\\|\\~\\[y\\]».",
        "  - Prova: file ``dir/`odd`.js`` · riga 2, colonna 1 · SHA-256 `ab` · Evidence `ev_1` · metodo `observe` · valutazione `observed/exact` · un'altra occorrenza",
      ].join("\n"),
    );
    expect(markdown).toContain("# Rapporto InsideApp — \\<demo\\>");
    expect(markdown).toContain("Nessun elemento rilevato in questa sezione.");
    expect(markdown).toContain("- Static \\<only\\>.");
  });

  it("renders a script-free page with every value escaped", () => {
    const html = renderReportHtml(report);
    expect(html).toContain("<title>Rapporto InsideApp — &lt;demo&gt;</title>");
    expect(html).toContain(
      '<li class="claim observed"><span class="badge">Osservato</span>Canale «a`b*c_&lt;x&gt;&amp;|~[y]».',
    );
    expect(html).toContain("<li>file: <code>dir/`odd`.js</code></li>");
    expect(html).toContain("<li>Static &lt;only&gt;.</li>");
    expect(html).not.toMatch(/<script|<demo>|https?:\/\//u);
  });

  it("lists supplementary analyses, including failed ones, only when present", () => {
    const withSupplements: InsideAppReport = {
      ...report,
      analysis: {
        ...report.analysis,
        supplements: [
          {
            operation: "inspect_plist",
            status: "completed",
            evidence_id: "ev_2",
          },
          {
            operation: "inspect_signature",
            status: "failed",
            failure_code: "provider_timeout",
          },
        ],
      },
    };
    expect(renderReportMarkdown(withSupplements)).toContain(
      "- **Analisi aggiuntive:** `inspect_plist` (Evidence `ev_2`), `inspect_signature` (non riuscita: `provider_timeout`)",
    );
    expect(renderReportHtml(withSupplements)).toContain(
      "<dt>Analisi aggiuntive</dt><dd>inspect_plist (Evidence ev_2), inspect_signature (non riuscita: provider_timeout)</dd>",
    );
    expect(renderReportMarkdown(report)).not.toContain("Analisi aggiuntive");
    expect(renderReportHtml(report)).not.toContain("Analisi aggiuntive");
  });
});
