// Browser script for the Reverse Engineering section, served as a same-origin
// file like the other GUI scripts. It only reads the GUI's own API.

export const GUI_NATIVE_JS = `"use strict";
(() => {
  const POLL_MS = 1500;
  const LABELS = { observed: "Osservato", derived: "Derivato", hypothesis: "Ipotesi", unknown: "Sconosciuto" };
  const byId = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const api = (path, body) => {
    const init = { credentials: "same-origin", headers: { "X-InsideApp-Request": "1" } };
    if (body !== undefined) {
      init.method = "POST";
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return fetch(path, init);
  };
  const setState = (node, text, tone) => { node.textContent = text; node.className = "state " + (tone || ""); };
  const state = { target: undefined, engine: undefined, status: "idle", poll: undefined, overview: undefined, view: undefined, tab: "explain", selected: undefined };

  const updateStart = () => {
    const ready = state.target !== undefined && byId("authorized").checked && state.engine === "configured" && state.status !== "starting";
    byId("native-start").disabled = !ready;
  };
  const seconds = (ms) => Math.round(ms / 1000) + " s";

  const showStatus = (view) => {
    state.engine = view.engine;
    state.status = view.status;
    setState(byId("native-engine"), view.engine === "configured"
      ? "Motore: Ghidra configurato su questo computer."
      : "Motore: Ghidra non configurato. Installalo con scripts/install-ghidra.sh (vedi il README), poi riavvia l'interfaccia.",
      view.engine === "configured" ? "ok" : "warn");
    byId("native-cancel").hidden = view.status !== "starting";
    byId("native-close").hidden = view.status !== "ready";
    byId("native-error").textContent = view.failure ? view.failure.message : "";
    if (view.status === "starting") setState(byId("native-phase"), view.phase + " (" + seconds(view.elapsed_ms) + ")…");
    else if (view.status === "ready") setState(byId("native-phase"), "Analisi pronta in " + seconds(view.elapsed_ms) + ": " + view.target.name + ".", "ok");
    else if (view.status === "cancelled") setState(byId("native-phase"), "Analisi annullata.", "warn");
    else if (view.status === "failed") setState(byId("native-phase"), "Analisi non riuscita.", "error");
    else setState(byId("native-phase"), "");
    if (view.status === "ready" && view.overview && state.overview !== view.overview) renderOverview(view.overview);
    if (view.status !== "ready") { byId("native-result").hidden = true; state.overview = undefined; }
    updateStart();
  };
  const poll = async () => {
    clearTimeout(state.poll);
    let response;
    try { response = await api("/api/native"); } catch { return; }
    if (!response.ok) return;
    const view = await response.json();
    showStatus(view);
    if (view.status === "starting") state.poll = setTimeout(poll, POLL_MS);
  };

  const fact = (list, label, value) => list.append(el("dt", "", label), el("dd", "", value));
  const renderOverview = (overview) => {
    state.overview = overview;
    const facts = byId("native-facts"); facts.replaceChildren();
    fact(facts, "Programma", overview.name);
    fact(facts, "Formato e architettura", overview.format + ", " + overview.architecture);
    fact(facts, "SHA-256", overview.sha256);
    fact(facts, "Segmenti", overview.segments.map((s) => s.name + " " + s.start + "–" + s.end + " " + s.permissions).join("; "));
    fact(facts, "Funzioni individuate da Ghidra", String(overview.function_count));
    fact(facts, "Stringhe", String(overview.string_count));
    renderFunctions();
    renderStrings();
    byId("native-result").hidden = false;
    byId("native-function").hidden = true;
    byId("native-hint").hidden = false;
  };
  const functionButton = (entry) => {
    const button = el("button");
    button.type = "button";
    button.dataset.address = entry.address;
    button.append(el("span", "addr", entry.address), el("span", "", entry.name));
    if (entry.thunk) button.append(el("span", "tag exit", "stub"));
    if (state.selected === entry.address) button.setAttribute("aria-current", "true");
    button.addEventListener("click", () => { void openFunction(entry.address); });
    return button;
  };
  const renderFunctions = () => {
    const list = byId("native-functions"); list.replaceChildren();
    const filter = byId("native-filter").value.trim().toLowerCase();
    const entries = state.overview.functions.filter((entry) => !filter || entry.name.toLowerCase().includes(filter) || entry.address.includes(filter));
    for (const entry of entries) {
      const item = el("li");
      if (entry.external) item.append(el("div", "ext", entry.name + " — importata, codice non presente nel file"));
      else item.append(functionButton(entry));
      list.append(item);
    }
    const internal = state.overview.functions.filter((entry) => !entry.external && !entry.thunk).length;
    const stubs = state.overview.functions.filter((entry) => !entry.external && entry.thunk).length;
    byId("native-functions-note").textContent = internal + " con codice nel programma, " + stubs + " stub verso librerie, " + (state.overview.functions.length - internal - stubs) + " importate" +
      (state.overview.function_count > state.overview.functions.length ? "; elenco limitato alle prime " + state.overview.functions.length : "") + ".";
  };
  const renderStrings = () => {
    const list = byId("native-strings"); list.replaceChildren();
    for (const entry of state.overview.strings) {
      const item = el("li");
      const button = el("button"); button.type = "button";
      button.append(el("span", "addr", entry.address), el("span", "", entry.value));
      button.title = "Mostra quali funzioni usano questa stringa";
      button.addEventListener("click", () => { void showStringReferences(entry, item); });
      item.append(button);
      list.append(item);
    }
    byId("native-strings-note").textContent = state.overview.string_count > state.overview.strings.length
      ? "Elenco limitato alle prime " + state.overview.strings.length + " di " + state.overview.string_count + "."
      : "Seleziona una stringa per vedere dove è usata.";
  };
  const showStringReferences = async (entry, item) => {
    const old = item.querySelector(".refs"); if (old) { old.remove(); return; }
    const box = el("div", "ext refs", "Ricerca dei riferimenti…");
    item.append(box);
    const response = await api("/api/native/strings/" + entry.address + "/references");
    if (!response.ok) { box.textContent = "Riferimenti non disponibili."; return; }
    const { references } = await response.json();
    box.replaceChildren();
    if (references.length === 0) { box.textContent = "Nessun riferimento ricostruito da Ghidra."; return; }
    box.append(el("span", "", "Usata da: "));
    references.forEach((reference, index) => {
      if (index > 0) box.append(", ");
      if (reference.function) {
        const link = el("button", "linkish", reference.function.name + " (" + reference.from + ")");
        link.type = "button";
        link.addEventListener("click", () => { void openFunction(reference.function.address); });
        box.append(link);
      } else box.append(reference.from + " (fuori da una funzione)");
    });
  };

  const openFunction = async (address) => {
    state.selected = address;
    for (const button of byId("native-functions").querySelectorAll("button")) {
      if (button.dataset.address === address) button.setAttribute("aria-current", "true"); else button.removeAttribute("aria-current");
    }
    byId("native-hint").hidden = true;
    byId("native-function").hidden = false;
    byId("native-function-title").textContent = "Analisi della funzione " + address + "…";
    byId("native-function-meta").textContent = "";
    byId("native-panel").replaceChildren();
    const response = await api("/api/native/functions/" + address);
    if (state.selected !== address) return;
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      byId("native-function-title").textContent = "Funzione " + address;
      byId("native-panel").append(el("p", "state error", body.message || "Ghidra non ha prodotto un'analisi per questa funzione."));
      return;
    }
    state.view = await response.json();
    const view = state.view;
    byId("native-function-title").textContent = view.name + " — " + view.address;
    byId("native-function-meta").textContent = (view.signature ? "Firma registrata da Ghidra: " + view.signature + ". " : "") +
      (view.size_bytes === null ? "" : view.size_bytes + " byte, ") + (view.blocks.length === 1 ? "1 blocco base, " : view.blocks.length + " blocchi base, ") + view.assembly.length + (view.assembly.length === 1 ? " istruzione." : " istruzioni.");
    renderTab();
  };

  const codeBlock = (text) => { const pre = el("pre", "code"); pre.textContent = text; return pre; };
  const hex = (text) => { try { return BigInt(text); } catch { return undefined; } };
  const lineAddress = (line) => { const match = /^(0x[0-9a-fA-F]+):/.exec(line); return match ? hex(match[1]) : undefined; };
  const panels = {
    explain: (view, panel) => {
      const list = el("ul", "claims");
      for (const claim of view.explanation) {
        const item = el("li", "claim " + claim.kind);
        item.append(el("span", "badge", LABELS[claim.kind]), el("span", "", claim.text));
        list.append(item);
      }
      panel.append(list);
      panel.append(el("p", "note", "Osservato: letto dai byte. Derivato: ricostruito dall'analisi di Ghidra. Ipotesi: possibile ma non dimostrato. Sconosciuto: non determinabile senza eseguire il programma."));
      const details = el("details");
      details.append(el("summary", "", "Limitazioni dichiarate dal motore (testo originale in inglese)"));
      const items = el("ul");
      for (const limitation of view.limitations) items.append(el("li", "", limitation));
      details.append(items);
      panel.append(details);
    },
    pseudo: (view, panel) => {
      if (view.pseudocode === null) { panel.append(el("p", "note", "Il decompilatore non ha prodotto pseudocodice per questa funzione.")); return; }
      panel.append(el("p", "note", "Ricostruzione del decompilatore di Ghidra: non è il sorgente originale; nomi di variabili e tipi possono essere generici."));
      panel.append(codeBlock(view.pseudocode));
    },
    asm: (view, panel) => {
      panel.append(codeBlock(view.assembly.join("\\n")));
      if (view.assembly_truncated) panel.append(el("p", "note", "Disassemblaggio troncato."));
    },
    flow: (view, panel) => {
      panel.append(el("p", "note", "Blocchi base in ordine di indirizzo, con i successori ricostruiti da Ghidra."));
      for (const block of view.blocks) {
        const box = el("div", "block");
        const head = el("div", "block-head");
        head.append(el("strong", "", block.start + "–" + block.end));
        head.append(el("span", "", "→ " + (block.successors.length === 0 ? "uscita dalla funzione" : block.successors.join(", "))));
        const start = hex(block.start), end = hex(block.end);
        if (block.successors.length > 1) head.append(el("span", "tag branch", "diramazione"));
        if (block.successors.some((successor) => { const target = hex(successor); return target !== undefined && start !== undefined && target <= start; })) head.append(el("span", "tag loop", "salto all'indietro"));
        if (block.successors.length === 0) head.append(el("span", "tag exit", "uscita"));
        box.append(head);
        const lines = view.assembly.filter((line) => { const address = lineAddress(line); return address !== undefined && start !== undefined && end !== undefined && address >= start && address < end; });
        const pre = el("pre"); pre.textContent = lines.join("\\n"); box.append(pre);
        panel.append(box);
      }
    },
    refs: (view, panel) => {
      const section = (title, entries, empty) => {
        panel.append(el("h4", "", title));
        if (entries.length === 0) { panel.append(el("p", "note", empty)); return; }
        const list = el("ul");
        for (const entry of entries) {
          const item = el("li");
          if (entry.external || !/^0x/.test(entry.address)) item.append(entry.name + " (importata)");
          else {
            const link = el("button", "linkish", entry.name + " (" + entry.address + ")");
            link.type = "button";
            link.addEventListener("click", () => { void openFunction(entry.address); });
            item.append(link);
          }
          list.append(item);
        }
        panel.append(list);
      };
      section("Funzioni chiamate", view.callees, "Nessuna chiamata diretta ricostruita.");
      section("Chiamata da", view.callers, "Nessun chiamante ricostruito.");
      panel.append(el("h4", "", "Stringhe usate"));
      if (view.strings.length === 0) panel.append(el("p", "note", "Nessuna stringa referenziata."));
      else { const list = el("ul"); for (const entry of view.strings) list.append(el("li", "", entry.address + ": «" + entry.value + "»")); panel.append(list); }
      panel.append(el("p", "note", "Riferimenti in ingresso: " + view.incoming_references + "; in uscita: " + view.outgoing_references + "; chiamate indirette non risolte: " + view.unresolved_calls + "."));
    },
  };
  const renderTab = () => {
    for (const tab of document.querySelectorAll("#native .tabs button")) tab.setAttribute("aria-selected", String(tab.dataset.tab === state.tab));
    const panel = byId("native-panel"); panel.replaceChildren();
    if (state.view) panels[state.tab](state.view, panel);
  };

  const download = async (extension) => {
    const response = await api("/api/native/export." + extension);
    if (!response.ok) return;
    const name = /filename="([A-Za-z0-9._-]+)"/.exec(response.headers.get("Content-Disposition") || "");
    const url = URL.createObjectURL(await response.blob());
    const link = el("a"); link.href = url; link.download = name ? name[1] : "reverse-engineering." + extension;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  document.addEventListener("insideapp:target", (event) => { state.target = event.detail; updateStart(); });
  byId("authorized").addEventListener("change", updateStart);
  byId("native-start").addEventListener("click", async () => {
    byId("native-start").disabled = true;
    state.selected = undefined; state.view = undefined;
    const response = await api("/api/native", { target_id: state.target.id, authorized: byId("authorized").checked });
    const view = await response.json().catch(() => ({}));
    if (!response.ok) { byId("native-error").textContent = view.message || "Impossibile avviare l'analisi."; updateStart(); return; }
    showStatus(view);
    state.poll = setTimeout(poll, POLL_MS);
  });
  byId("native-cancel").addEventListener("click", () => { void api("/api/native/cancel", {}).then(poll); });
  byId("native-close").addEventListener("click", () => { void api("/api/native/close", {}).then(poll); });
  byId("native-filter").addEventListener("input", () => { if (state.overview) renderFunctions(); });
  for (const tab of document.querySelectorAll("#native .tabs button")) tab.addEventListener("click", () => { state.tab = tab.dataset.tab; renderTab(); });
  byId("native-export-md").addEventListener("click", () => { void download("md"); });
  byId("native-export-html").addEventListener("click", () => { void download("html"); });
  void poll();
})();
`;
