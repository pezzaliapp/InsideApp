import {
  REPORT_CLAIM_DEFINITIONS,
  REPORT_CLAIM_KINDS,
  REPORT_CLAIM_LABELS,
  type InsideAppReport,
  type ReportClaim,
  type ReportEvidenceReference,
} from "../../domain/report/insideAppReport.js";

const AUTHORIZATION_NOTE =
  "Chi ha generato il rapporto ha dichiarato che il software è suo o che è autorizzato ad analizzarlo.";
const STATIC_NOTE =
  "Rapporto generato in locale da InsideApp — PezzaliAPP, senza servizi esterni. Le conclusioni valgono solo per i file esaminati: un elemento non trovato non dimostra che sia assente.";
const ATTRIBUTION =
  "InsideApp è un'opera derivata da REA — Reverse Engineer Anything (MIT, © 2026 morluto) e non è affiliato ai suoi autori.";
const EMPTY_SECTION = "Nessun elemento rilevato in questa sezione.";

/** One labelled proof coordinate; the value is shown verbatim as code. */
interface EvidencePart {
  readonly label: string;
  readonly value: string | null;
}

const evidenceParts = (evidence: ReportEvidenceReference): EvidencePart[] => {
  const parts: EvidencePart[] = [];
  if (evidence.path !== null)
    parts.push({ label: "file", value: evidence.path });
  if (evidence.position !== null)
    parts.push({ label: evidence.position, value: null });
  if (evidence.sha256 !== null)
    parts.push({ label: "SHA-256", value: evidence.sha256 });
  if (evidence.evidence_id !== null)
    parts.push({ label: "Evidence", value: evidence.evidence_id });
  if (evidence.method !== null)
    parts.push({ label: "metodo", value: evidence.method });
  parts.push({ label: "valutazione", value: evidence.engine_assessment });
  if (evidence.additional_occurrences > 0)
    parts.push({
      label:
        evidence.additional_occurrences === 1
          ? "un'altra occorrenza"
          : `altre ${evidence.additional_occurrences} occorrenze`,
      value: null,
    });
  return parts;
};

// Markdown -----------------------------------------------------------------

/** Escape CommonMark punctuation and raw HTML in target-controlled text. */
const markdownText = (value: string): string =>
  value.replace(/[\\`*_[\]<>|~&]/gu, (character) => `\\${character}`);

/** A code span whose fence is longer than any backtick run in the value. */
const markdownCode = (value: string): string => {
  const longest = Math.max(
    0,
    ...[...value.matchAll(/`+/gu)].map((run) => run[0].length),
  );
  const fence = "`".repeat(longest + 1);
  const padded = /^`|`$|^ .* $/u.test(value) ? ` ${value} ` : value;
  return `${fence}${padded.replace(/\r?\n/gu, " ")}${fence}`;
};

const markdownParts = (parts: readonly EvidencePart[]): string =>
  parts
    .map(({ label, value }) =>
      value === null
        ? markdownText(label)
        : `${markdownText(label)} ${markdownCode(value)}`,
    )
    .join(" · ");

const markdownClaim = (claim: ReportClaim): string => {
  const head = `- **${REPORT_CLAIM_LABELS[claim.kind]}** — ${markdownText(claim.statement)}`;
  return claim.evidence === null
    ? head
    : `${head}\n  - Prova: ${markdownParts(evidenceParts(claim.evidence))}`;
};

/** Render a report as CommonMark. */
export const renderReportMarkdown = (report: InsideAppReport): string => {
  const lines = [
    `# ${markdownText(report.title)}`,
    "",
    `- **Oggetto:** ${markdownText(report.subject.name)}${report.subject.format === null ? "" : ` (${markdownText(report.subject.format)})`}`,
    ...(report.subject.path === null
      ? []
      : [`- **Percorso:** ${markdownCode(report.subject.path)}`]),
    ...(report.subject.sha256 === null
      ? []
      : [`- **SHA-256:** ${markdownCode(report.subject.sha256)}`]),
    `- **Analisi:** ${markdownText(report.analysis.description)}`,
    `- **Evidence:** ${markdownCode(report.analysis.evidence_id)} (${markdownCode(report.analysis.operation)})`,
    `- **Generato:** ${report.generated_at} con ${markdownText(report.generator.name)} ${report.generator.version}`,
    `- **Autorizzazione:** ${AUTHORIZATION_NOTE}`,
    "",
    "## Come leggere il rapporto",
    "",
    ...REPORT_CLAIM_KINDS.map(
      (kind) =>
        `- **${REPORT_CLAIM_LABELS[kind]}** (${report.counts[kind]}): ${REPORT_CLAIM_DEFINITIONS[kind]}`,
    ),
    "",
    STATIC_NOTE,
  ];
  for (const section of report.sections) {
    lines.push("", `## ${section.title}`, "");
    if (section.claims.length === 0) lines.push(EMPTY_SECTION);
    else lines.push(...section.claims.map(markdownClaim));
  }
  if (report.engine_limitations.length > 0)
    lines.push(
      "",
      "### Limitazioni dichiarate dal motore (testo originale in inglese)",
      "",
      ...report.engine_limitations.map((limit) => `- ${markdownText(limit)}`),
    );
  lines.push("", "---", "", ATTRIBUTION, "");
  return lines.join("\n");
};

// HTML ---------------------------------------------------------------------

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const html = (value: string): string =>
  value.replace(/[&<>"']/gu, (character) => HTML_ESCAPES[character]!);

const STYLE = `
:root{color-scheme:light dark;--bg:#fbfbfa;--fg:#1d1d1f;--muted:#5b5b60;--line:#dedede;--card:#fff;
--observed:#1f6f43;--derived:#1d4f91;--hypothesis:#8a5a00;--unknown:#6b6b70}
@media (prefers-color-scheme:dark){:root{--bg:#161618;--fg:#ececee;--muted:#a3a3a8;--line:#333;--card:#1f1f22;
--observed:#5cc28a;--derived:#7aa7e8;--hypothesis:#e0b455;--unknown:#a3a3a8}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:1.7rem;margin:0 0 4px}h2{font-size:1.25rem;margin:36px 0 12px;border-bottom:1px solid var(--line);padding-bottom:6px}
.meta{color:var(--muted);font-size:.92rem;margin:0 0 20px}.meta dt{font-weight:600;color:var(--fg)}
.meta dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:12px 0}.meta dd{margin:0;overflow-wrap:anywhere}
.note{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px;font-size:.93rem}
.legend{display:grid;gap:8px;margin:12px 0;padding:0;list-style:none}
ul.claims{list-style:none;padding:0;margin:0;display:grid;gap:10px}
.claim{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--c);border-radius:8px;padding:10px 14px}
.badge{display:inline-block;font-size:.75rem;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--c);margin-right:8px}
.observed{--c:var(--observed)}.derived{--c:var(--derived)}.hypothesis{--c:var(--hypothesis)}.unknown{--c:var(--unknown)}
details{margin-top:6px;font-size:.88rem;color:var(--muted)}summary{cursor:pointer}
details ul{margin:6px 0 0;padding-left:18px;overflow-wrap:anywhere}
code{font:.85em ui-monospace,SFMono-Regular,Menlo,monospace}
footer{margin-top:48px;color:var(--muted);font-size:.85rem}
@media print{details{display:block}details>summary{display:none}}
`;

const htmlClaim = (claim: ReportClaim): string => {
  const evidence =
    claim.evidence === null
      ? ""
      : `<details><summary>Mostra prova</summary><ul>${evidenceParts(
          claim.evidence,
        )
          .map(({ label, value }) =>
            value === null
              ? `<li>${html(label)}</li>`
              : `<li>${html(label)}: <code>${html(value)}</code></li>`,
          )
          .join("")}</ul></details>`;
  return `<li class="claim ${claim.kind}"><span class="badge">${REPORT_CLAIM_LABELS[claim.kind]}</span>${html(claim.statement)}${evidence}</li>`;
};

const definition = (term: string, value: string | null): string =>
  value === null ? "" : `<dt>${html(term)}</dt><dd>${html(value)}</dd>`;

/** Render a self-contained HTML page: no scripts, no external resources. */
export const renderReportHtml = (report: InsideAppReport): string => {
  const sections = report.sections
    .map(
      (section) =>
        `<section id="${section.id}"><h2>${html(section.title)}</h2>${
          section.claims.length === 0
            ? `<p class="meta">${EMPTY_SECTION}</p>`
            : `<ul class="claims">${section.claims.map(htmlClaim).join("")}</ul>`
        }</section>`,
    )
    .join("\n");
  const limitations =
    report.engine_limitations.length === 0
      ? ""
      : `<details><summary>Limitazioni dichiarate dal motore (testo originale in inglese)</summary><ul>${report.engine_limitations
          .map((limit) => `<li>${html(limit)}</li>`)
          .join("")}</ul></details>`;
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<meta name="referrer" content="no-referrer">
<meta name="generator" content="${html(`${report.generator.name} ${report.generator.version}`)}">
<title>${html(report.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${html(report.title)}</h1>
<div class="meta"><dl>
${definition("Oggetto", `${report.subject.name}${report.subject.format === null ? "" : ` (${report.subject.format})`}`)}
${definition("Percorso", report.subject.path)}
${definition("SHA-256", report.subject.sha256)}
${definition("Analisi", report.analysis.description)}
${definition("Evidence", `${report.analysis.evidence_id} (${report.analysis.operation})`)}
${definition("Generato", `${report.generated_at} con ${report.generator.name} ${report.generator.version}`)}
${definition("Autorizzazione", AUTHORIZATION_NOTE)}
</dl></div>
<section class="note" aria-label="Come leggere il rapporto">
<strong>Come leggere il rapporto</strong>
<ul class="legend">${REPORT_CLAIM_KINDS.map(
    (kind) =>
      `<li class="${kind}"><span class="badge">${REPORT_CLAIM_LABELS[kind]} · ${report.counts[kind]}</span>${html(REPORT_CLAIM_DEFINITIONS[kind])}</li>`,
  ).join("")}</ul>
<p>${html(STATIC_NOTE)}</p>
</section>
${sections}
${limitations}
<footer>${html(ATTRIBUTION)}</footer>
</main>
</body>
</html>
`;
};
