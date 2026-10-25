// Static GUI assets, served from memory. Scripts and styles are separate
// same-origin resources so the page policy never needs 'unsafe-inline'.

const page = (
  title: string,
  body: string,
  script?: string,
): string => `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${title}</title>
<link rel="stylesheet" href="/assets/app.css">
${script === undefined ? "" : `<script src="${script}" defer></script>`}
</head>
<body>
${body}
</body>
</html>
`;

const BRAND = `<header class="brand">
<div class="logo" aria-hidden="true">IA</div>
<div><h1>InsideApp <span>— PezzaliAPP</span></h1><p class="tagline">Guarda dentro il software</p></div>
</header>`;

const FOOTER = `<footer>
<p>Analizza solo software tuo o che sei autorizzato ad analizzare (vedi AVVERTENZE.md).</p>
<p>InsideApp è un'opera derivata da REA — Reverse Engineer Anything (MIT, © 2026 morluto) e non è affiliato ai suoi autori.</p>
</footer>`;

/** Shown without a session: no engine data, only how to start again. */
export const GUI_LOCKED_HTML = page(
  "InsideApp — sessione non attiva",
  `<main>${BRAND}
<section class="card"><h2>Sessione non attiva</h2>
<p>Questa pagina si apre solo dalla sessione avviata dal comando <code>./scripts/insideapp.sh gui</code>.</p>
<p>Chiudi questa scheda e riavvia il comando dal terminale.</p></section>
${FOOTER}</main>`,
);

/** Redeems the single-use launch token from the URL fragment. */
export const GUI_START_HTML = page(
  "InsideApp — avvio",
  `<main>${BRAND}
<section class="card"><h2 id="start-title">Avvio della sessione…</h2>
<p id="start-message">Collegamento al motore locale di InsideApp.</p></section>
${FOOTER}</main>`,
  "/assets/start.js",
);

export const GUI_APP_HTML = page(
  "InsideApp — PezzaliAPP",
  `<main>${BRAND}
<p class="local no-print" role="note"><strong>Analisi locale.</strong> Il motore gira su questo Mac: nessun file o rapporto viene inviato in rete e le applicazioni analizzate non vengono mai eseguite.</p>

<ol class="steps no-print" aria-label="Passaggi">
<li id="step-select" aria-current="step">Seleziona</li><li id="step-analyze">Analizza</li><li id="step-understand">Comprendi</li><li id="step-export">Esporta</li>
</ol>

<section class="card no-print" aria-labelledby="select-title">
<h2 id="select-title">1. Seleziona</h2>
<p>Scegli un'applicazione tua o che sei autorizzato ad analizzare. InsideApp legge solo l'elemento che scegli.</p>
<label class="check"><input type="checkbox" id="authorized"> Dichiaro che il software è mio o che sono autorizzato ad analizzarlo (vedi AVVERTENZE.md).</label>
<div class="actions"><button type="button" id="pick-file">Scegli file o app…</button><button type="button" id="pick-folder">Scegli cartella…</button></div>
<p id="target" class="target" aria-live="polite">Nessun elemento scelto.</p>
</section>

<section class="card no-print" aria-labelledby="analyze-title">
<h2 id="analyze-title">2. Analizza</h2>
<div class="actions"><button type="button" id="start" class="primary" disabled>Avvia l'analisi</button><button type="button" id="cancel" hidden>Annulla</button></div>
<p id="phase" class="state" aria-live="polite"></p>
<p id="elapsed" class="note"></p>
<p id="analysis-error" class="state error" role="alert"></p>
</section>

<section class="card report" id="report" aria-labelledby="report-title" hidden>
<h2 class="no-print">3. Comprendi</h2>
<h3 id="report-title"></h3>
<p id="report-meta" class="note"></p>
<div id="counts" class="counts"></div>
<fieldset class="filters no-print"><legend>Mostra</legend><div id="filters"></div></fieldset>
<div id="sections"></div>
<details id="limitations"><summary>Limitazioni dichiarate dal motore (testo originale in inglese)</summary><ul id="limitations-list"></ul></details>
<p class="note">Rapporto generato in locale da InsideApp — PezzaliAPP. Le conclusioni valgono solo per i file esaminati: un elemento non trovato non dimostra che sia assente.</p>
</section>

<section class="card no-print" id="export" aria-labelledby="export-title" hidden>
<h2 id="export-title">4. Esporta</h2>
<p>Il rapporto esportato non contiene il percorso dell'elemento sul tuo computer.</p>
<div class="actions"><button type="button" id="export-html">Scarica HTML</button><button type="button" id="export-md">Scarica Markdown</button><button type="button" id="print">Stampa o salva in PDF</button></div>
</section>

<div class="modes no-print">
<section class="card mode" aria-labelledby="engine-title">
<div class="card-head"><h2 id="engine-title">Stato del motore</h2><button type="button" id="refresh">Aggiorna</button></div>
<p id="engine-state" class="state">Lettura dello stato…</p>
<dl id="engine-facts" class="facts"></dl>
</section>
<section class="card mode" aria-labelledby="claude-title">
<h2 id="claude-title">Modalità Claude Code (facoltativa)</h2>
<p>Non serve per usare InsideApp. Se vuoi, Claude Code usa lo stesso motore tramite il server MCP del progetto, entro il tuo abbonamento: nessuna API a consumo.</p>
<p id="claude-state" class="state">Lettura della configurazione…</p>
<p class="note">Avvia Claude Code dalla cartella del progetto e approva il server <code>insideapp</code> di <code>.mcp.json</code>.</p>
</section>
</div>

<section class="card session no-print" aria-labelledby="session-title">
<h2 id="session-title">Sessione</h2>
<p id="session-state">La sessione resta attiva su questo computer finché la chiudi, finché premi Ctrl+C nel terminale o dopo un periodo di inattività.</p>
<button type="button" id="shutdown" class="danger">Chiudi InsideApp</button>
</section>
${FOOTER}</main>`,
  "/assets/app.js",
);

export const GUI_CSS = `:root{color-scheme:light dark;--bg:#f6f7f9;--fg:#1b1d21;--muted:#5d6370;--card:#fff;--line:#dfe2e7;--accent:#0b6bcb;--accent-fg:#fff;--ok:#1e7a46;--warn:#9a5b00;--danger:#b42318;
--observed:#1f6f43;--derived:#1d4f91;--hypothesis:#8a5a00;--unknown:#6b6b70}
@media (prefers-color-scheme:dark){:root{--bg:#131518;--fg:#e9ebee;--muted:#a3a9b4;--card:#1c1f24;--line:#30353d;--accent:#5aa2f0;--accent-fg:#0b1220;--ok:#5ccf8f;--warn:#e2b45c;--danger:#f2877c;
--observed:#5cc28a;--derived:#7aa7e8;--hypothesis:#e0b455;--unknown:#a3a3a8}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:960px;margin:0 auto;padding:28px 16px 56px}
.brand{display:flex;gap:14px;align-items:center;margin-bottom:18px}
.logo{width:48px;height:48px;border-radius:12px;background:var(--accent);color:var(--accent-fg);display:grid;place-items:center;font-weight:800;letter-spacing:.02em}
h1{font-size:1.6rem;margin:0}h1 span{font-weight:500;color:var(--muted)}
.tagline{margin:2px 0 0;color:var(--muted)}
h2{font-size:1.1rem;margin:0 0 8px}h3{font-size:1.25rem;margin:4px 0}h4{font-size:1.05rem;margin:22px 0 10px;border-bottom:1px solid var(--line);padding-bottom:4px}
.local{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--ok);border-radius:10px;padding:12px 14px;margin:0 0 16px}
.steps{display:flex;gap:8px;list-style:none;padding:0;margin:0 0 16px;flex-wrap:wrap;counter-reset:step}
.steps li{flex:1;min-width:120px;padding:8px 12px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--muted);text-align:center;font-weight:600}
.steps li[aria-current="step"]{border-color:var(--accent);color:var(--accent)}
.steps li.done{color:var(--ok);border-color:var(--ok)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:0 0 16px}
.card-head{display:flex;justify-content:space-between;align-items:center;gap:12px}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}
.check{display:flex;gap:10px;align-items:flex-start;margin:10px 0}.check input{margin-top:5px}
.target{font-weight:600}
.modes{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
.mode{margin:0}.session{margin-top:16px}
.state{font-weight:600;min-height:1.2em}.state.ok{color:var(--ok)}.state.warn{color:var(--warn)}.state.error{color:var(--danger)}
.facts{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:10px 0 0}
.facts dt{color:var(--muted)}.facts dd{margin:0;overflow-wrap:anywhere}
.note{color:var(--muted);font-size:.92rem}
.counts{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:12px 0}
.count{border:1px solid var(--line);border-left:4px solid var(--c);border-radius:8px;padding:8px 12px}
.count strong{display:block;color:var(--c);font-size:1.4rem}.count span{font-size:.85rem;color:var(--muted)}
.filters{border:1px solid var(--line);border-radius:8px;margin:0 0 8px;padding:6px 12px}.filters label{margin-right:16px;white-space:nowrap}
ul.claims{list-style:none;padding:0;margin:0;display:grid;gap:8px}
.claim{border:1px solid var(--line);border-left:4px solid var(--c);border-radius:8px;padding:8px 12px}
.badge{display:inline-block;font-size:.75rem;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--c);margin-right:8px}
.observed{--c:var(--observed)}.derived{--c:var(--derived)}.hypothesis{--c:var(--hypothesis)}.unknown{--c:var(--unknown)}
details{margin-top:6px;font-size:.9rem;color:var(--muted)}summary{cursor:pointer}
details ul{margin:6px 0 0;padding-left:18px;overflow-wrap:anywhere}
.hidden-kind{display:none}
code{font:.88em ui-monospace,SFMono-Regular,Menlo,monospace}
button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}
button:focus-visible,input:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
button:disabled{opacity:.55;cursor:not-allowed}
button.danger{border-color:var(--danger);color:var(--danger)}
footer{margin-top:28px;color:var(--muted);font-size:.85rem}
@media print{.no-print,footer,.brand .tagline{display:none!important}body{background:#fff;color:#000}main{padding:0}.card{border:0;padding:0}details{display:block}details>summary{display:none}.hidden-kind{display:block}}
`;

/** Start page: redeem the fragment token, then drop it from the address bar. */
export const GUI_START_JS = `"use strict";
(() => {
  const token = location.hash.slice(1);
  history.replaceState(null, "", "/avvio");
  const title = document.getElementById("start-title");
  const message = document.getElementById("start-message");
  const fail = (text) => { title.textContent = "Sessione non avviata"; message.textContent = text; };
  if (token === "") { fail("Manca il codice di avvio. Riavvia ./scripts/insideapp.sh gui dal terminale."); return; }
  fetch("/api/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-InsideApp-Request": "1" },
    body: JSON.stringify({ token }),
  }).then((response) => {
    if (response.ok) location.replace("/");
    else fail("Il codice di avvio non è più valido (vale una sola volta e per 60 secondi). Riavvia ./scripts/insideapp.sh gui dal terminale.");
  }, () => fail("Il motore locale non risponde. Riavvia ./scripts/insideapp.sh gui dal terminale."));
})();
`;

/** App page: read engine status and offer shutdown; text only, never HTML. */

/** App page: select, analyze, read and export; DOM built from text only, never HTML. */
export const GUI_APP_JS = `"use strict";
(() => {
  const POLL_MS = 2000;
  const byId = (id) => document.getElementById(id);
  const api = async (path, body) => {
    const init = { credentials: "same-origin", headers: { "X-InsideApp-Request": "1" } };
    if (body !== undefined) {
      init.method = "POST";
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return fetch(path, init);
  };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const setState = (node, text, tone) => { node.textContent = text; node.className = "state " + (tone || ""); };
  const state = { target: undefined, analysis: undefined, poll: undefined, report: undefined };
  const KINDS = ["observed", "derived", "hypothesis", "unknown"];

  const steps = (current) => {
    const order = ["select", "analyze", "understand", "export"];
    order.forEach((name, index) => {
      const item = byId("step-" + name);
      if (name === current) item.setAttribute("aria-current", "step"); else item.removeAttribute("aria-current");
      item.classList.toggle("done", index < order.indexOf(current));
    });
  };
  const ended = (text) => {
    clearTimeout(state.poll);
    setState(byId("engine-state"), text, "warn");
    byId("session-state").textContent = text;
    for (const button of document.querySelectorAll("button")) button.disabled = true;
  };
  const sessionLost = (response) => {
    if (response.status !== 401) return false;
    ended("Sessione scaduta. Riavvia ./scripts/insideapp.sh gui per continuare.");
    return true;
  };

  const targetLabel = (target) =>
    target.route === "javascript-application" ? "applicazione JavaScript/Electron: analisi completa" :
    target.route === "apple-bundle" ? "app macOS: struttura, Info.plist, eseguibile e firma" :
    target.route === "sqlite" ? "database SQLite: solo la struttura, nessun dato delle tabelle" :
    target.kind === "folder" ? "cartella: ispezione generica" :
    "file: formato e contenuti (per gli eseguibili Windows anche importazioni, risorse e firma)";
  const updateStart = () => {
    byId("start").disabled = !(byId("authorized").checked && state.target && !state.analysis);
  };

  const pick = async (kind) => {
    for (const id of ["pick-file", "pick-folder"]) byId(id).disabled = true;
    byId("target").textContent = "Finestra di scelta aperta…";
    try {
      const response = await api("/api/targets", { kind });
      if (sessionLost(response)) return;
      const result = await response.json();
      if (result.outcome === "selected") {
        state.target = result.target;
        byId("target").textContent = "Scelto: " + result.target.name + " — " + targetLabel(result.target) + ".";
        steps("analyze");
      } else {
        byId("target").textContent = result.outcome === "cancelled" ? "Nessun elemento scelto." :
          result.outcome === "too_broad" ? "Questa cartella è troppo ampia: scegli un'applicazione o una cartella più specifica, non la radice del disco o la cartella Inizio." :
          response.status === 409 ? "La finestra di scelta è già aperta." : "L'elemento scelto non è utilizzabile.";
      }
    } catch { byId("target").textContent = "Il motore locale non risponde."; }
    finally {
      for (const id of ["pick-file", "pick-folder"]) byId(id).disabled = state.analysis !== undefined;
      updateStart();
    }
  };

  const showAnalysis = (analysis) => {
    const seconds = Math.round(analysis.elapsed_ms / 1000);
    byId("elapsed").textContent = "Tempo trascorso: " + seconds + " s";
    if (analysis.status === "running") { setState(byId("phase"), analysis.phase + "…", ""); return false; }
    clearTimeout(state.poll);
    state.analysis = undefined;
    byId("cancel").hidden = true;
    for (const id of ["pick-file", "pick-folder"]) byId(id).disabled = false;
    updateStart();
    if (analysis.status === "completed") { setState(byId("phase"), "Analisi completata.", "ok"); void loadReport(analysis.id); }
    else if (analysis.status === "cancelled") setState(byId("phase"), "Analisi annullata.", "warn");
    else { setState(byId("phase"), "", ""); byId("analysis-error").textContent = analysis.failure ? analysis.failure.message : "L'analisi non è riuscita."; }
    return true;
  };
  const poll = async () => {
    try {
      const response = await api("/api/analyses/" + state.analysis);
      if (sessionLost(response)) return;
      if (!showAnalysis(await response.json())) state.poll = setTimeout(poll, POLL_MS);
    } catch { ended("InsideApp è stato chiuso. Riavvia ./scripts/insideapp.sh gui per continuare."); }
  };
  const start = async () => {
    byId("analysis-error").textContent = "";
    byId("report").hidden = true; byId("export").hidden = true;
    byId("start").disabled = true;
    for (const id of ["pick-file", "pick-folder"]) byId(id).disabled = true;
    const response = await api("/api/analyses", { target_id: state.target.id, authorized: byId("authorized").checked });
    if (sessionLost(response)) return;
    const analysis = await response.json();
    if (response.status !== 202) {
      byId("analysis-error").textContent = analysis.error === "analysis_running" ? "Un'altra analisi è in corso." : "L'analisi non è partita.";
      for (const id of ["pick-file", "pick-folder"]) byId(id).disabled = false;
      updateStart();
      return;
    }
    state.analysis = analysis.id;
    byId("cancel").hidden = false; byId("cancel").disabled = false;
    showAnalysis(analysis);
    state.poll = setTimeout(poll, POLL_MS);
  };
  const cancel = async () => {
    byId("cancel").disabled = true;
    setState(byId("phase"), "Annullamento in corso…", "warn");
    await api("/api/analyses/" + state.analysis + "/cancel", {});
  };

  const evidenceItems = (evidence) => {
    const items = [];
    if (evidence.path !== null) items.push(["file", evidence.path]);
    if (evidence.position !== null) items.push([evidence.position, null]);
    if (evidence.sha256 !== null) items.push(["SHA-256", evidence.sha256]);
    if (evidence.evidence_id !== null) items.push(["Evidence", evidence.evidence_id]);
    if (evidence.method !== null) items.push(["metodo", evidence.method]);
    items.push(["valutazione del motore", evidence.engine_assessment]);
    if (evidence.additional_occurrences > 0)
      items.push([evidence.additional_occurrences === 1 ? "un'altra occorrenza" : "altre " + evidence.additional_occurrences + " occorrenze", null]);
    return items;
  };
  const claimNode = (claim, labels) => {
    const item = el("li", "claim " + claim.kind);
    item.dataset.kind = claim.kind;
    item.append(el("span", "badge", labels[claim.kind]), document.createTextNode(claim.statement));
    if (claim.evidence !== null) {
      const details = el("details");
      details.append(el("summary", "", "Mostra prova"));
      const list = el("ul");
      for (const [label, value] of evidenceItems(claim.evidence)) {
        const row = el("li", "", value === null ? label : label + ": ");
        if (value !== null) row.append(el("code", "", value));
        list.append(row);
      }
      details.append(list);
      item.append(details);
    }
    return item;
  };
  const renderReport = ({ report, legend }) => {
    state.report = report;
    byId("report-title").textContent = report.title;
    byId("report-meta").textContent = report.analysis.description + " Evidence " + report.analysis.evidence_id + ".";
    const counts = byId("counts"); counts.replaceChildren();
    const filters = byId("filters"); filters.replaceChildren();
    for (const kind of KINDS) {
      const box = el("div", "count " + kind);
      box.title = legend.definitions[kind];
      box.append(el("strong", "", String(report.counts[kind])), el("span", "", legend.labels[kind] + " — " + legend.definitions[kind]));
      counts.append(box);
      const label = el("label");
      const input = el("input"); input.type = "checkbox"; input.checked = true;
      input.addEventListener("change", () => {
        for (const node of document.querySelectorAll('#sections li[data-kind="' + kind + '"]')) node.classList.toggle("hidden-kind", !input.checked);
      });
      label.append(input, document.createTextNode(" " + legend.labels[kind]));
      filters.append(label);
    }
    const sections = byId("sections"); sections.replaceChildren();
    for (const section of report.sections) {
      sections.append(el("h4", "", section.title));
      if (section.claims.length === 0) { sections.append(el("p", "note", "Nessun elemento rilevato in questa sezione.")); continue; }
      const list = el("ul", "claims");
      for (const claim of section.claims) list.append(claimNode(claim, legend.labels));
      sections.append(list);
    }
    const limits = byId("limitations-list"); limits.replaceChildren();
    for (const limit of report.engine_limitations) limits.append(el("li", "", limit));
    byId("limitations").hidden = report.engine_limitations.length === 0;
    byId("report").hidden = false; byId("export").hidden = false;
    steps("understand");
  };
  const loadReport = async (id) => {
    const response = await api("/api/reports/" + id);
    if (sessionLost(response)) return;
    if (!response.ok) { byId("analysis-error").textContent = "Il rapporto non è disponibile."; return; }
    state.reportId = id;
    renderReport(await response.json());
  };
  const download = async (extension) => {
    const response = await api("/api/reports/" + state.reportId + "/export." + extension);
    if (sessionLost(response) || !response.ok) return;
    const name = /filename="([A-Za-z0-9._-]+)"/.exec(response.headers.get("Content-Disposition") || "");
    const url = URL.createObjectURL(await response.blob());
    const link = el("a"); link.href = url; link.download = name ? name[1] : "rapporto-insideapp." + extension;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    steps("export");
  };

  const ROUTES = {
    "javascript-application": "App Electron e JavaScript (cartella o .asar): analisi completa",
    "apple-bundle": "App macOS (.app): struttura, Info.plist, eseguibile e firma",
    sqlite: "Database SQLite: struttura, senza leggere i dati",
    artifact: "Altri file: formato e contenuti; eseguibili Windows con importazioni, risorse e firma",
  };
  const fact = (list, label, value) => list.append(el("dt", "", label), el("dd", "", value));
  const refresh = async () => {
    let response;
    try { response = await api("/api/status"); }
    catch { ended("InsideApp è stato chiuso. Riavvia ./scripts/insideapp.sh gui per continuare."); return; }
    if (sessionLost(response)) return;
    if (!response.ok) { setState(byId("engine-state"), "Stato non disponibile (" + response.status + ").", "error"); return; }
    const status = await response.json();
    const engine = status.engine;
    setState(byId("engine-state"), "Motore pronto, solo in locale.", "ok");
    const facts = byId("engine-facts"); facts.replaceChildren();
    fact(facts, "Versione", engine.product + " " + engine.version);
    fact(facts, "Node.js", engine.node + " (" + engine.platform + ")");
    fact(facts, "Applicazioni analizzate", "mai eseguite: solo analisi statica");
    fact(facts, "Analisi disponibili", engine.analysis.report_routes.map((route) => ROUTES[route] || route).join("; "));
    fact(facts, "Strumenti MCP", String(engine.claude.mcp_tools));
    fact(facts, "Chiusura per inattività", "dopo " + Math.round(status.session.idle_timeout_seconds / 60) + " minuti");
    const mcp = engine.claude.project_mcp_server;
    setState(byId("claude-state"),
      mcp === "configured" ? "Server MCP di progetto configurato (.mcp.json)." :
      mcp === "missing" ? "File .mcp.json non trovato nel progetto." : "File .mcp.json non riconosciuto.",
      mcp === "configured" ? "ok" : "warn");
  };

  byId("authorized").addEventListener("change", updateStart);
  byId("pick-file").addEventListener("click", () => { void pick("file"); });
  byId("pick-folder").addEventListener("click", () => { void pick("folder"); });
  byId("start").addEventListener("click", () => { void start(); });
  byId("cancel").addEventListener("click", () => { void cancel(); });
  byId("export-html").addEventListener("click", () => { void download("html"); });
  byId("export-md").addEventListener("click", () => { void download("md"); });
  byId("print").addEventListener("click", () => { steps("export"); window.print(); });
  byId("refresh").addEventListener("click", () => { void refresh(); });
  byId("shutdown").addEventListener("click", async () => {
    clearTimeout(state.poll);
    try { await api("/api/shutdown", {}); } catch {}
    ended("InsideApp è stato chiuso. Puoi chiudere questa scheda.");
  });
  void refresh();
})();
`;
