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
<p class="local" role="status"><strong>Analisi locale.</strong> Il motore gira su questo Mac: nessun file viene inviato in rete e le applicazioni analizzate non vengono eseguite.</p>

<section class="card" aria-labelledby="engine-title">
<div class="card-head"><h2 id="engine-title">Stato del motore</h2>
<button type="button" id="refresh">Aggiorna</button></div>
<p id="engine-state" class="state">Lettura dello stato…</p>
<dl id="engine-facts" class="facts"></dl>
</section>

<div class="modes">
<section class="card mode" aria-labelledby="standalone-title">
<h2 id="standalone-title">Modalità autonoma</h2>
<p>Scegli un'applicazione tua o autorizzata e ottieni un rapporto in italiano, senza Claude Code.</p>
<ul id="formats" class="formats"></ul>
<button type="button" disabled aria-describedby="standalone-note">Scegli un'applicazione…</button>
<p id="standalone-note" class="note">Disponibile nella prossima versione. Intanto puoi usare <code>./scripts/insideapp.sh report &lt;percorso&gt; --authorized</code>.</p>
</section>

<section class="card mode" aria-labelledby="claude-title">
<h2 id="claude-title">Modalità Claude Code</h2>
<p>Facoltativa. Claude Code usa lo stesso motore tramite il server MCP del progetto, entro il tuo abbonamento: nessuna API a consumo.</p>
<p id="claude-state" class="state">Lettura della configurazione…</p>
<p class="note">Avvia Claude Code dalla cartella del progetto e approva il server <code>insideapp</code> di <code>.mcp.json</code>.</p>
</section>
</div>

<section class="card session" aria-labelledby="session-title">
<h2 id="session-title">Sessione</h2>
<p id="session-state">La sessione resta attiva su questo computer finché la chiudi, finché premi Ctrl+C nel terminale o dopo un periodo di inattività.</p>
<button type="button" id="shutdown" class="danger">Chiudi InsideApp</button>
</section>
${FOOTER}</main>`,
  "/assets/app.js",
);

export const GUI_CSS = `:root{color-scheme:light dark;--bg:#f6f7f9;--fg:#1b1d21;--muted:#5d6370;--card:#fff;--line:#dfe2e7;--accent:#0b6bcb;--accent-fg:#fff;--ok:#1e7a46;--warn:#9a5b00;--danger:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#131518;--fg:#e9ebee;--muted:#a3a9b4;--card:#1c1f24;--line:#30353d;--accent:#5aa2f0;--accent-fg:#0b1220;--ok:#5ccf8f;--warn:#e2b45c;--danger:#f2877c}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:920px;margin:0 auto;padding:28px 16px 56px}
.brand{display:flex;gap:14px;align-items:center;margin-bottom:18px}
.logo{width:48px;height:48px;border-radius:12px;background:var(--accent);color:var(--accent-fg);display:grid;place-items:center;font-weight:800;letter-spacing:.02em}
h1{font-size:1.6rem;margin:0}h1 span{font-weight:500;color:var(--muted)}
.tagline{margin:2px 0 0;color:var(--muted)}
h2{font-size:1.1rem;margin:0 0 8px}
.local{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--ok);border-radius:10px;padding:12px 14px;margin:0 0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:0 0 16px}
.card-head{display:flex;justify-content:space-between;align-items:center;gap:12px}
.modes{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
.mode{margin:0}.session{margin-top:16px}
.state{font-weight:600}.state.ok{color:var(--ok)}.state.warn{color:var(--warn)}.state.error{color:var(--danger)}
.facts{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:10px 0 0}
.facts dt{color:var(--muted)}.facts dd{margin:0;overflow-wrap:anywhere}
.formats{margin:8px 0 12px;padding-left:20px}
.note{color:var(--muted);font-size:.92rem}
code{font:.88em ui-monospace,SFMono-Regular,Menlo,monospace}
button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);cursor:pointer}
button:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
button:disabled{opacity:.55;cursor:not-allowed}
button.danger{border-color:var(--danger);color:var(--danger)}
footer{margin-top:28px;color:var(--muted);font-size:.85rem}
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
export const GUI_APP_JS = `"use strict";
(() => {
  const headers = { "X-InsideApp-Request": "1" };
  const byId = (id) => document.getElementById(id);
  const ROUTES = {
    "javascript-application": "App Electron e JavaScript (cartella o .asar): analisi completa",
    artifact: "Altri file e bundle .app (.exe, .dll…): ispezione del formato",
  };
  const setState = (element, text, tone) => { element.textContent = text; element.className = "state " + tone; };
  const fact = (list, label, value) => {
    const dt = document.createElement("dt"); dt.textContent = label;
    const dd = document.createElement("dd"); dd.textContent = value;
    list.append(dt, dd);
  };
  const ended = (text) => {
    setState(byId("engine-state"), text, "warn");
    byId("session-state").textContent = text;
    for (const button of document.querySelectorAll("button")) button.disabled = true;
  };
  const refresh = async () => {
    let response;
    try { response = await fetch("/api/status", { credentials: "same-origin", headers }); }
    catch { ended("InsideApp è stato chiuso. Riavvia ./scripts/insideapp.sh gui per continuare."); return; }
    if (response.status === 401) { ended("Sessione scaduta. Riavvia ./scripts/insideapp.sh gui per continuare."); return; }
    if (!response.ok) { setState(byId("engine-state"), "Stato non disponibile (" + response.status + ").", "error"); return; }
    const status = await response.json();
    const engine = status.engine;
    setState(byId("engine-state"), "Motore pronto, solo in locale.", "ok");
    const facts = byId("engine-facts"); facts.replaceChildren();
    fact(facts, "Versione", engine.product + " " + engine.version);
    fact(facts, "Node.js", engine.node + " (" + engine.platform + ")");
    fact(facts, "Applicazioni analizzate", "mai eseguite: solo analisi statica");
    fact(facts, "Strumenti MCP", String(engine.claude.mcp_tools));
    fact(facts, "Chiusura per inattività", "dopo " + Math.round(status.session.idle_timeout_seconds / 60) + " minuti");
    const formats = byId("formats"); formats.replaceChildren();
    for (const route of engine.analysis.report_routes) {
      const item = document.createElement("li"); item.textContent = ROUTES[route] ?? route; formats.append(item);
    }
    const mcp = engine.claude.project_mcp_server;
    setState(byId("claude-state"),
      mcp === "configured" ? "Server MCP di progetto configurato (.mcp.json)." :
      mcp === "missing" ? "File .mcp.json non trovato nel progetto." : "File .mcp.json non riconosciuto.",
      mcp === "configured" ? "ok" : "warn");
  };
  byId("refresh").addEventListener("click", () => { void refresh(); });
  byId("shutdown").addEventListener("click", async () => {
    try {
      await fetch("/api/shutdown", { method: "POST", credentials: "same-origin",
        headers: { ...headers, "Content-Type": "application/json" }, body: "{}" });
    } catch {}
    ended("InsideApp è stato chiuso. Puoi chiudere questa scheda.");
  });
  void refresh();
})();
`;
