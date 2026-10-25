import { REPORT_CLAIM_LABELS } from "../domain/report/insideAppReport.js";
import type { NativeFunctionView, NativeOverview } from "./guiNativeView.js";

export interface NativeReportInput {
  readonly overview: NativeOverview;
  /** Functions the user explored, in the order they were opened. */
  readonly functions: readonly NativeFunctionView[];
  readonly engine: string;
  readonly generatedAt: Date;
}

const HEADER_NOTE =
  "Analisi statica eseguita in locale con Ghidra: il programma non è stato eseguito né modificato. Il pseudocodice è una ricostruzione del decompilatore, non il sorgente originale. Le conclusioni valgono solo per le funzioni esaminate.";

const fence = (text: string): string => {
  const ticks = "`".repeat(
    Math.max(3, ...[...text.matchAll(/`+/gu)].map(([run]) => run.length + 1)),
  );
  return `${ticks}\n${text}\n${ticks}`;
};

const blockLine = (block: NativeFunctionView["blocks"][number]): string =>
  `${block.start}–${block.end} → ${block.successors.length === 0 ? "uscita" : block.successors.join(", ")}`;

/** Markdown technical report of the overview and the explored functions. */
export const renderNativeReportMarkdown = ({
  overview,
  functions,
  engine,
  generatedAt,
}: NativeReportInput): string => {
  const lines = [
    `# Reverse engineering — ${overview.name}`,
    "",
    `- **Generato:** ${generatedAt.toISOString()} con InsideApp — PezzaliAPP e ${engine}`,
    `- **Formato:** ${overview.format}; **architettura:** ${overview.architecture}`,
    `- **SHA-256:** \`${overview.sha256}\``,
    `- **Funzioni individuate:** ${overview.function_count}; **stringhe:** ${overview.string_count}`,
    "",
    `> ${HEADER_NOTE}`,
    "",
    "## Segmenti",
    "",
    "| Nome | Inizio | Fine | Permessi |",
    "| --- | --- | --- | --- |",
    ...overview.segments.map(
      (segment) =>
        `| ${segment.name.replaceAll("|", "\\|")} | ${segment.start} | ${segment.end} | ${segment.permissions} |`,
    ),
    "",
  ];
  if (functions.length === 0)
    lines.push("Nessuna funzione è stata aperta nell'interfaccia.", "");
  for (const view of functions) {
    lines.push(
      `## Funzione ${view.name} (${view.address})`,
      "",
      ...(view.signature === null
        ? []
        : [`Firma registrata da Ghidra: \`${view.signature}\``, ""]),
      "### Spiegazione",
      "",
      ...view.explanation.map(
        (claim) => `- **${REPORT_CLAIM_LABELS[claim.kind]}:** ${claim.text}`,
      ),
      "",
      "### Pseudocodice (decompilatore Ghidra)",
      "",
      view.pseudocode === null
        ? "Non disponibile per questa funzione."
        : fence(view.pseudocode),
      "",
      "### Flusso di controllo",
      "",
      ...view.blocks.map((block) => `- ${blockLine(block)}`),
      "",
      "### Disassemblaggio",
      "",
      fence(view.assembly.join("\n")),
      ...(view.assembly_truncated ? ["", "Disassemblaggio troncato."] : []),
      "",
      "### Limitazioni dichiarate dal motore (in inglese)",
      "",
      ...view.limitations.map((limitation) => `- ${limitation}`),
      "",
      `Evidence: \`${view.evidence_id}\``,
      "",
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
};

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/gu, (character) => `&#${character.charCodeAt(0)};`);

/** Self-contained HTML page: no script, no external resource, printable. */
export const renderNativeReportHtml = (input: NativeReportInput): string => {
  const { overview, functions, engine, generatedAt } = input;
  const sections = functions
    .map(
      (view) => `<section>
<h2>Funzione ${escapeHtml(view.name)} <code>${escapeHtml(view.address)}</code></h2>
${view.signature === null ? "" : `<p>Firma registrata da Ghidra: <code>${escapeHtml(view.signature)}</code></p>`}
<h3>Spiegazione</h3>
<ul>${view.explanation.map((claim) => `<li><strong>${REPORT_CLAIM_LABELS[claim.kind]}:</strong> ${escapeHtml(claim.text)}</li>`).join("")}</ul>
<h3>Pseudocodice (decompilatore Ghidra)</h3>
${view.pseudocode === null ? "<p>Non disponibile per questa funzione.</p>" : `<pre>${escapeHtml(view.pseudocode)}</pre>`}
<h3>Flusso di controllo</h3>
<ul>${view.blocks.map((block) => `<li><code>${escapeHtml(blockLine(block))}</code></li>`).join("")}</ul>
<h3>Disassemblaggio</h3>
<pre>${escapeHtml(view.assembly.join("\n"))}</pre>${view.assembly_truncated ? "<p>Disassemblaggio troncato.</p>" : ""}
<details><summary>Limitazioni dichiarate dal motore (in inglese)</summary><ul>${view.limitations.map((limitation) => `<li>${escapeHtml(limitation)}</li>`).join("")}</ul></details>
<p class="note">Evidence: <code>${escapeHtml(view.evidence_id)}</code></p>
</section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Reverse engineering — ${escapeHtml(overview.name)}</title>
<style>
:root{color-scheme:light dark}body{font:15px/1.5 -apple-system,system-ui,sans-serif;max-width:960px;margin:24px auto;padding:0 16px}
pre{overflow-x:auto;padding:12px;border:1px solid #8884;border-radius:8px;font:13px/1.45 ui-monospace,Menlo,monospace}
table{border-collapse:collapse}th,td{border:1px solid #8884;padding:4px 8px;text-align:left}.note{opacity:.75}
section{border-top:1px solid #8884;margin-top:24px}
</style>
</head>
<body>
<h1>Reverse engineering — ${escapeHtml(overview.name)}</h1>
<ul>
<li><strong>Generato:</strong> ${escapeHtml(generatedAt.toISOString())} con InsideApp — PezzaliAPP e ${escapeHtml(engine)}</li>
<li><strong>Formato:</strong> ${escapeHtml(overview.format)}; <strong>architettura:</strong> ${escapeHtml(overview.architecture)}</li>
<li><strong>SHA-256:</strong> <code>${escapeHtml(overview.sha256)}</code></li>
<li><strong>Funzioni individuate:</strong> ${overview.function_count}; <strong>stringhe:</strong> ${overview.string_count}</li>
</ul>
<p class="note">${escapeHtml(HEADER_NOTE)}</p>
<h2>Segmenti</h2>
<table><thead><tr><th>Nome</th><th>Inizio</th><th>Fine</th><th>Permessi</th></tr></thead><tbody>
${overview.segments.map((segment) => `<tr><td>${escapeHtml(segment.name)}</td><td>${escapeHtml(segment.start)}</td><td>${escapeHtml(segment.end)}</td><td>${escapeHtml(segment.permissions)}</td></tr>`).join("\n")}
</tbody></table>
${functions.length === 0 ? "<p>Nessuna funzione è stata aperta nell'interfaccia.</p>" : sections}
</body>
</html>
`;
};

/** Portable download name from the target-controlled program name. */
export const nativeReportFileName = (
  overview: NativeOverview,
  format: "html" | "markdown",
): string => {
  const safe =
    overview.name
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9._-]+/gu, "-")
      .replace(/^[-.]+|-+$/gu, "")
      .slice(0, 60) || "programma";
  return `reverse-${safe}-${overview.sha256.slice(0, 12)}.${format === "html" ? "html" : "md"}`;
};
