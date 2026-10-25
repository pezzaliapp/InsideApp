# Architettura di InsideApp: modalità autonoma e modalità Claude

Stato: architettura approvata. G0–G4 completati; G5 da autorizzare. Sostituisce e dettaglia `proposte/gui-insideapp.md`.

## 1. Obiettivi e vincoli

- **Modalità autonoma.** Interfaccia grafica locale su `127.0.0.1`: scelta
  dell'applicazione, analisi, rapporto in italiano. Funziona senza Claude Code.
- **Modalità Claude.** Facoltativa: Claude Code usa lo stesso motore tramite il
  server MCP di progetto (`.mcp.json`, stdio), entro l'abbonamento esistente.
  Nessuna API a consumo, né dall'interfaccia né dal server.
- **Un solo motore.** CLI, MCP e GUI chiamano gli stessi servizi applicativi e
  lo stesso generatore di rapporti. Nessuna logica di analisi nella GUI.
- **Costo zero, offline.** Nessuna nuova dipendenza di runtime, nessun servizio
  esterno, nessuna telemetria.
- **Sito pubblico** (in seguito) su Cloudflare Free: solo pagine statiche di
  presentazione. Il motore e la GUI non vanno mai online.

## 2. Architettura

```text
              ┌──────────────── Modalità autonoma ────────────────┐
 Browser ──── │ http://127.0.0.1:<porta casuale>                  │
 (HTML/CSS/JS │  src/gui/  adapter HTTP + selezione file nativa   │
 statici)     └──────────────────────┬────────────────────────────┘
                                     │ stesse chiamate
 Claude Code ── stdio MCP ── src/server/ ──┤
 Terminale ─── src/cli/ ───────────────────┤
                                     ▼
          src/application/report/  generateReport()  ← NUOVO punto unico
          src/application/…        analisi JavaScript/Electron, inspect_artifact, …
                                     ▼
          src/domain/              Evidence, modello del rapporto, classificazione
```

### 2.1 Punto unico condiviso: `generateReport` (G0, completato)

`src/application/report/generateReport.ts`:

```ts
generateReport(
  { path, authorized },          // percorso assoluto e dichiarazione di liceità
  ports,                         // ReportAnalysisPorts<Failure>, forniti dall'adapter
  { generatedAt, homeDirectory, signal },
): Promise<Result<InsideAppReport, GenerateReportError<Failure>>>
```

- **Errori:** `authorization-required` (nessuna lettura del target),
  `analysis-failed` (l'errore dell'adapter passa invariato), `report-failed`
  (Evidence non valida o operazione senza rapporto).
- **Porte:** `ReportAnalysisPorts` ha una funzione per ciascuna via
  (`javascript-application`, `artifact`). Ogni adapter mantiene la proprietà
  dei propri scope di risorse e dei worker; il servizio sceglie solo la via.
- **Instradamento:** `selectReportRoute` usa `isJavaScriptApplicationPath`, ora in
  `src/application/javascript/javascriptApplicationPath.ts` e condiviso con
  `analyze`.
- **Nome dei file:** `reportFileName` è condiviso; la GUI lo userà come nome
  proposto nella finestra "Salva con nome".
- **CLI:** `report` è un adapter sottile (`createCliReportAnalysisPorts`), con
  l'output invariato.
- **Parità:** un test confronta byte per byte il rapporto prodotto dalla CLI con
  quello del servizio chiamato in-process, con porte che non passano dalla CLI.
  La JavaScript usa uno scope proprio, come farà la GUI.
- **G4 (fatto):** lo strumento MCP `create_report` usa lo stesso
  `generateReport` con le porte di composizione condivise; l'analisi JavaScript
  usa lo scope di risorse del server MCP.

### 2.2 Adapter GUI (`src/gui/`)

| Modulo                | Compito                                                                         |
| --------------------- | ------------------------------------------------------------------------------- |
| `guiCommand.ts`       | comando `insideapp gui`: avvia il server, apre il browser, gestisce la chiusura |
| `guiServer.ts`        | `node:http` su `127.0.0.1`, instradamento, limiti, intestazioni di sicurezza    |
| `guiSession.ts`       | token di sessione, obiettivi autorizzati, rapporti in memoria                   |
| `guiJobs.ts`          | coda analisi (una alla volta), avanzamento, annullamento, pulizia               |
| `nativeFilePicker.ts` | porta per la finestra di scelta file (macOS `osascript`, Linux `zenity`)        |
| `assets/`             | `index.html`, `app.css`, `app.ts` compilato con il `tsc` già presente           |

Riuso di codice esistente, senza duplicazioni:

- `src/server/http/listenHttpServer.ts` e le funzioni di convalida di `Host` e
  `Origin` già usate dal trasporto MCP HTTP (`hostHeaderAllowlist`,
  `hostHeaderValidationResponse`, `originValidationResponse`);
- `ArtifactResourceScope` e il worker JavaScript per ciclo di vita e pulizia;
- `ProgressReporter` per l'avanzamento delle analisi;
- `renderReportHtml` e `renderReportMarkdown` per esportazione e anteprima.

### 2.3 API locale (JSON)

| Metodo e percorso               | Funzione                                                             |
| ------------------------------- | -------------------------------------------------------------------- |
| `GET /`, `GET /assets/*`        | interfaccia statica, inclusa nel build                               |
| `POST /api/session`             | scambio del token di avvio monouso con il cookie di sessione (4.1)   |
| `POST /api/targets/pick`        | apre la finestra nativa; restituisce un `target_id` opaco e il nome  |
| `POST /api/analyses`            | `{ target_id, authorized: true }` → `analysis_id`                    |
| `GET /api/analyses/:id`         | stato, fase, tempo trascorso                                         |
| `POST /api/analyses/:id/cancel` | annullamento                                                         |
| `GET /api/reports/:id`          | modello del rapporto (JSON) per l'interfaccia                        |
| `GET /api/reports/:id/preview`  | HTML del rapporto, mostrato in un `iframe` con `sandbox`             |
| `POST /api/reports/:id/export`  | `{ format: "html" \| "markdown" }`: finestra nativa "Salva con nome" |
| `GET /api/reports/:id/claude`   | testo pronto per Claude Code (modalità Claude)                       |
| `POST /api/shutdown`            | chiusura esplicita                                                   |

Il browser non riceve mai percorsi assoluti: solo `target_id` e nomi da
mostrare. Si possono analizzare solo gli obiettivi scelti in quella sessione
con la finestra nativa. In seguito si può aggiungere un campo "incolla
percorso", con conferma esplicita.

### 2.4 Flusso utente

1. `./scripts/insideapp.sh gui`: il browser predefinito apre la pagina.
2. **Benvenuto e liceità.** Estratto di `AVVERTENZE.md` e casella obbligatoria
   "Il software è mio o sono autorizzato ad analizzarlo".
3. **Scegli…** (file, cartella o `.app`): l'interfaccia mostra il tipo previsto
   (applicazione JavaScript/Electron o artefatto generico).
4. **Analizza:** barra delle fasi, tempo, pulsante **Annulla**.
5. **Rapporto:** riepilogo con i conteggi Osservato, Derivato, Ipotesi e
   Sconosciuto, sezioni, filtri per classe, "Mostra prova" per ogni
   affermazione.
6. **Esporta** HTML o Markdown; PDF con la stampa del browser.
7. **Modalità Claude** (facoltativa): pulsante "Copia richiesta per Claude
   Code" con l'Evidence ID e il percorso del rapporto salvato.

### 2.5 Modalità Claude

- **Già disponibile.** Il server MCP di progetto (227 strumenti) e la skill
  `.claude/skills/insideapp/`. Claude Code può già lanciare
  `./scripts/insideapp.sh report … --authorized` dopo aver chiesto la conferma di
  liceità.
- **`create_report` (G4, fatto).**
  - Restituisce Evidence derivata con il rapporto: circa 15 KB per l'app di
    esempio, invece dei circa 940 KB dell'analisi completa.
  - Richiede `authorized: true` e omette il percorso locale.
  - Registra nella sessione le Evidence di origine.
  - Il catalogo passa a 228 strumenti.
- **Collegamento tra le modalità.** Ponte manuale, nessuna chiamata
  automatica: la GUI prepara un testo da incollare in Claude Code. Claude Code
  non controlla la GUI e la GUI non avvia Claude Code.
- **Nessun server MCP HTTP.** Si resta su stdio: nessuna porta aperta in più.

## 3. Dipendenze

| Esigenza             | Soluzione                                                              | Nuove dipendenze                   |
| -------------------- | ---------------------------------------------------------------------- | ---------------------------------- |
| Server HTTP          | `node:http`, `node:crypto`                                             | nessuna                            |
| Interfaccia          | HTML, CSS e TypeScript senza framework, compilato con `tsc`            | nessuna                            |
| Selezione file       | `osascript` (macOS, di sistema); `zenity` (Linux, se c'è)              | nessuna                            |
| Apertura del browser | `open` (macOS), `xdg-open` (Linux) con `execFile`                      | nessuna                            |
| Test end-to-end      | `playwright-core` (già dipendenza di runtime) con il Chrome di sistema | nessuna (nessun browser scaricato) |

Escluse: Electron, Tauri e framework UI (React, Preact). Nessuna CDN e nessun
font esterno: si usano i font di sistema.

## 4. Sicurezza e privacy

| Rischio                              | Contromisura                                                                                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accesso da altri computer della rete | ascolto solo su `127.0.0.1` (mai `0.0.0.0` o `::`), porta casuale                                                                                                                                                         |
| Altri siti aperti nel browser (CSRF) | cookie `SameSite=Strict` più intestazione obbligatoria `X-InsideApp-Request`, `Origin` e `Sec-Fetch-Site` verificati, solo `POST` JSON, nessuna intestazione CORS (dettagli in 4.1)                                       |
| DNS rebinding                        | allowlist dell'intestazione `Host` e controllo di `Origin`, con le funzioni già usate dal trasporto MCP                                                                                                                   |
| Furto del token                      | token di avvio monouso valido 60 secondi, consegnato con un file `0600` e mai sulla riga di comando; poi cookie `HttpOnly`; confronto a tempo costante (dettagli in 4.1)                                                  |
| Contenuto ostile dell'app analizzata | escape già verificato nei renderer; anteprima in `iframe sandbox` senza script; CSP `default-src 'none'`                                                                                                                  |
| Pagina dell'interfaccia              | CSP `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` |
| Lettura di file non scelti           | solo `target_id` della sessione; nessun percorso dal browser                                                                                                                                                              |
| Iniezione di comandi                 | `osascript` ed `open` con `execFile`, script fissi, nessuna interpolazione di input                                                                                                                                       |
| Abuso di risorse                     | una analisi alla volta, corpo delle richieste limitato (16 KB), rapporti in memoria limitati (ad esempio 20)                                                                                                              |
| Server dimenticato acceso            | chiusura dopo 30 minuti di inattività, pulsante **Chiudi**, chiusura con Ctrl+C                                                                                                                                           |
| Privacy                              | home mostrata come `~`; nessun percorso nei log; nessuna telemetria; i rapporti si salvano solo dove sceglie l'utente                                                                                                     |

Nessuna esecuzione dell'applicazione analizzata: la GUI espone solo analisi
statiche. Le funzioni dinamiche (browser, processi, Frida) restano escluse
dalla GUI.

### 4.1 Accesso al server locale: modello di minaccia

L'ascolto su `127.0.0.1` impedisce solo l'accesso da altri computer. Qualsiasi
processo del Mac, di qualsiasi utente, e qualsiasi pagina web aperta nel
browser possono comunque raggiungere la porta. Per questo ogni richiesta deve
superare tutti i controlli seguenti, indipendenti tra loro.

**Chi può tentare l'accesso e come viene fermato**

| Origine dell'attacco                                     | Difese                                                                                                                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pagina web ostile nel browser (CSRF)                     | cookie di sessione `SameSite=Strict`; intestazione obbligatoria `X-InsideApp-Request: 1` (impone un preflight CORS che il server non autorizza mai); controllo di `Origin` e `Sec-Fetch-Site: same-origin`; solo JSON                |
| DNS rebinding (un dominio esterno che punta a 127.0.0.1) | `Host` deve essere esattamente `127.0.0.1:<porta>`; `Origin` esattamente `http://127.0.0.1:<porta>`; il cookie non viene inviato a un altro nome host                                                                                |
| Altri processi o altri utenti dello stesso Mac           | nessuna richiesta API senza sessione valida; token di avvio monouso a 256 bit, mai sulla riga di comando (visibile con `ps`), consegnato tramite un file `0600` in una cartella `0700`; nessun secondo browser dopo il primo accesso |
| Perdita del token (cronologia, log, copia dell'URL)      | il token di avvio vale una sola volta e scade dopo 60 secondi; poi resta solo il cookie `HttpOnly`, che lo script della pagina non legge; nessun token nei log o nelle risposte                                                      |
| Scansione della porta                                    | porta casuale scelta dal sistema; risposta `401` senza dettagli; nessuna pagina utile senza sessione                                                                                                                                 |
| Porta occupata da un altro programma                     | il server verifica l'indirizzo effettivamente aperto e si rifiuta di partire se non è il proprio `127.0.0.1`                                                                                                                         |
| Browser collegato e poi lasciato aperto                  | chiusura per inattività; nuova sessione a ogni avvio; pulsante **Chiudi** che invalida il cookie                                                                                                                                     |

**Avvio della sessione**

1. Il server parte su `127.0.0.1:0` e genera un token di avvio casuale
   (`crypto.randomBytes(32)`).
2. Scrive una pagina di avvio in una cartella temporanea `0700` (file `0600`)
   e apre quel file con `open`. La riga di comando contiene solo il percorso
   del file, non il token.
3. La pagina invia il token con `POST /api/session`. Il server lo confronta a
   tempo costante, lo invalida, cancella il file e risponde con il cookie
   `HttpOnly; SameSite=Strict; Path=/`.
4. Ogni richiesta successiva deve avere cookie, intestazione
   `X-InsideApp-Request`, `Host` e `Origin` corretti.

**Fuori dal modello**

Un programma ostile che gira con il tuo stesso utente può già leggere i tuoi
file e il profilo del browser, quindi nessun server locale può proteggersi da
lui. InsideApp non lo dichiara come protetto. Lo stesso vale per le estensioni
del browser con accesso a tutti i siti. Il documento lo dirà esplicitamente
all'utente.

**Verifica**

I test di confine (sezione 5) devono provare ogni riga della tabella con una
richiesta reale. Disattivare uno qualsiasi dei controlli deve far fallire
almeno un test.

### 4.2 Implementazione in G1 (`src/gui/`, comando `gui`)

| Misura                                                                                                             | Dove                                | Test che la dimostra                                                                      |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------- |
| Ascolto solo su `127.0.0.1`, porta del sistema, verifica dell'indirizzo effettivo                                  | `startGuiServer`                    | `insideappGuiServer.test.ts` (indirizzo e porta), `lsof` nella prova manuale              |
| Token monouso a 256 bit, 60 secondi, mai in argomenti o log                                                        | `GuiSession`, `writeGuiLauncher`    | riutilizzo e scadenza rifiutati; `ps -axww` e l'output non contengono il token            |
| File di avvio `0600` in cartella `0700`, dentro `.cache/gui/` del progetto, cancellato prima di emettere il cookie | `guiLauncher.ts`                    | permessi e cancellazione verificati                                                       |
| Cookie `HttpOnly; SameSite=Strict; Path=/`, scaduto alla chiusura                                                  | `guiSecurity.ts`                    | intestazione esatta; in Chrome `document.cookie` è vuoto                                  |
| `Host` esatto (DNS rebinding)                                                                                      | `guiRequestRefusal`                 | `localhost`, altri nomi, altre porte, Host senza porta: tutti 403                         |
| `Origin` esatto, `Sec-Fetch-Site`, intestazione `X-InsideApp-Request` (CSRF e altri siti locali)                   | `guiRequestRefusal`                 | origini estranee, `same-site`, `cross-site`, POST senza Origin, intestazione assente: 403 |
| Instradamento esatto, nessun file dal disco                                                                        | `ROUTE_METHODS`, risorse in memoria | percorsi con `..`, `%2e%2e`, `/package.json`: 404                                         |
| Limiti: corpo 4 KB, intestazioni 8 KB, tempi di richiesta, 16 connessioni                                          | `readJsonBody`, `createServer`      | 413, 411, 415, 400, 431, 405                                                              |
| CSP senza `unsafe-*`, nessuna CORS, intestazioni di sicurezza su ogni risposta                                     | `GUI_SECURITY_HEADERS`              | intestazioni su pagine, risorse e rifiuti; in Chrome nessuna violazione                   |
| Chiusura: Ctrl+C, pulsante, inattività; porta rilasciata                                                           | `stop`                              | dopo la chiusura la porta rifiuta le connessioni; il processo termina                     |

**Inattività:** il timer riparte a ogni richiesta autenticata. La pagina non
interroga il server da sola, quindi una scheda dimenticata non tiene acceso il
server.

**Mutazioni verificate:** disattivando, uno per volta, il controllo di Host,
di Origin o dell'intestazione dedicata, la verifica della sessione, `HttpOnly`,
il token monouso o i limiti del corpo, almeno un test fallisce.

### 4.3 Implementazione in G2 (scelta, analisi, rapporto)

| Misura                                                                                                                        | Dove                                   | Test che la dimostra                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Scelta solo con la finestra nativa; AppleScript fisso, senza testo dell'utente, senza `tell application` né `do shell script` | `guiTargets.ts` (`osascriptArguments`) | `osascript` finto: argomenti esatti; `osacompile` compila i due script; annullamento = "cancelled" |
| Percorsi solo nel processo: il browser riceve un identificativo opaco a 128 bit, il nome e il tipo                            | `GuiTargets`, `guiTargetView`          | nessun percorso nelle risposte; mutazione "percorso nella vista": 3 test falliscono                |
| Analisi solo con dichiarazione esplicita (`authorized: true`) e solo di elementi scelti nella sessione                        | `startAnalysis`                        | `authorized` falso o assente: 400; identificativo sconosciuto: 404                                 |
| Rapporti senza percorso locale, a schermo e nei file esportati                                                                | `GuiAnalyses` (`subject.path: null`)   | rapporto, Markdown e HTML senza percorso; identici al servizio condiviso, salvo il percorso        |
| Errori in italiano, classificati per codice, senza testo del motore (che può contenere percorsi)                              | `failureMessage`                       | SQLite: "non è supportato in questa versione", nessun percorso                                     |
| Una analisi alla volta, un solo dialogo aperto, al massimo 20 elementi e 10 rapporti in memoria                               | `GuiAnalyses`, `pickTarget`            | seconda analisi: 409; secondo dialogo: 409                                                         |
| Annullamento reale tramite `AbortSignal`; il worker termina; la chiusura del server ferma il lavoro in corso                  | `cancel`, `close`                      | annullamento sotto 10 s; nessun processo figlio rimasto                                            |
| Avanzamento senza percentuali: fase reale del motore e tempo trascorso; interrogazione ogni 2 s solo durante l'analisi        | `guiAssets.ts`                         | in Chrome intervalli ≥ 1,9 s; nessuna interrogazione dopo la fine                                  |
| Esportazione dal browser (download), senza scritture del server su disco                                                      | `export.html`, `export.md`             | nome file e `Content-Disposition` verificati                                                       |

**Memoria (misurata in G2 e G3, limite non bloccante).**

- In G3, 8 analisi consecutive dell'app sintetica grande (200 file, circa
  12.000 funzioni) nello stesso server: RSS 1.258 → 1.289 → 1.292 MB, poi
  stabile fino all'ottava (1.293 MB). L'heap dopo la garbage collection resta
  stabile a circa 189 MB.
- La crescita osservata in G2 era quindi un assestamento dell'allocatore, non
  una perdita.
- Il primo uso delle analisi native carica una sola volta circa 150 MB di
  moduli e schemi.
- Picco durante un'analisi grande: circa 1,48 GB nel server. Il worker
  JavaScript resta in attesa (circa 255 MB) e si chiude con il server; non
  restano processi figli.

Ottimizzazione possibile ma non urgente: eseguire le analisi molto grandi in
un processo usa e getta, per restituire subito la memoria al sistema.

## 5. Piano dei test

Ogni test usa l'host isolato di `tests/fixtures/insideappHost.ts`: home
temporanea, `npm`, `npx` e `claude` finti, guardia di rete. La guardia verrà
estesa per ammettere solo connessioni a `127.0.0.1` sulla porta della GUI.

1. **Unitari.** Confronto del token, allowlist di Host e Origin, intestazioni
   CSP, limiti del corpo, coda delle analisi.
2. **Confine HTTP.** Server reale su `127.0.0.1`. Va rifiutato tutto ciò che
   non è autorizzato:
   - richieste senza token o con un token errato;
   - `Host` estranei, `Origin` di altri siti, `Content-Type` non JSON;
   - `target_id` sconosciuti, corpi troppo grandi.

   Inoltre: nessun ascolto su interfacce non locali e chiusura per inattività.

3. **Flusso completo.** Selettore di file sostituito da una porta di test.
   Percorso verificato: scelta, analisi, rapporto ed esportazione sulle
   fixture `notes-electron`, `bundle.zip` e app ostile. Annullamento durante
   l'analisi, con pulizia completa del worker.
4. **Parità.** Stesso rapporto (salvo l'orario) da CLI `report` e da GUI.
5. **Effetti sull'host.** Nessuna rete esterna, nessuna chiamata a npm, npx o
   claude, nessuna scrittura nella home, salvo i file esportati dove indicato.
6. **End-to-end nel browser** (facoltativo). `playwright-core` con il Chrome
   installato: navigazione da tastiera, etichette accessibili, anteprima
   sandbox senza script. Se Chrome manca, il test lo dichiara come copertura
   non verificata e non lo conta come superato.
7. **Mutazioni.** Come per la Fase 0: disattivare token, controllo dell'Host
   ed escape deve far fallire i test.
8. **Regressione completa.** Build, `check:fast`, Knip, `test:fast`,
   `test:boundary`, MCP end-to-end (227 strumenti).

## 6. Roadmap (ogni passo si ferma per l'approvazione)

| Passo | Contenuto                                                                                        | Esito verificabile                                     |
| ----- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| G0    | `generateReport` applicativo, instradamento condiviso, CLI adattata, log npm locali (fatto)      | test della Fase 0 invariati, parità                    |
| G1    | server GUI sicuro (sessione, Host, Origin, CSRF, CSP, limiti, chiusura); pagina iniziale (fatto) | test di confine HTTP e mutazioni                       |
| G2    | flusso completo: liceità, scelta, analisi, rapporto, esportazione (fatto)                        | test di flusso, parità ed effetti sull'host            |
| G3    | formati prioritari .app, PE e SQLite; dimensioni misurate; limiti (fatto)                        | rapporti sulle fixture di ciascun tipo                 |
| G4    | strumento MCP `create_report` sullo stesso servizio; sezione Claude Code nella GUI (fatto)       | test MCP, parità CLI/GUI/MCP, catalogo a 228 strumenti |
| G5    | sito statico su `insideapp.pezzalihub.app` (Cloudflare Free)                                     | sito pubblicato dopo la tua approvazione               |

### 6.1 Formati prioritari (G3, completato)

Ogni via del rapporto usa operazioni del motore già esistenti, attraverso
`src/composition/reportAnalysis.ts`, condiviso da CLI e GUI. L'analisi
principale decide il rapporto; le analisi aggiuntive arricchiscono, e se una
fallisce viene indicata come "Sconosciuto" con il suo codice.

| Formato                   | Analisi principale                                   | Analisi aggiuntive                                                                                                            | Nel rapporto                                                                                                                                                                                                                                                                        | Non promesso                                                                                                  |
| ------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| App macOS `.app`          | `inspect_desktop_application`                        | `inspect_plist`, `inspect_macho`, `inspect_signature`                                                                         | struttura e dimensione misurata; identità, versione, sistema minimo, permessi dichiarati (`NS*UsageDescription`), schemi URL, App Transport Security; architetture, piattaforma, librerie; firma, team, Hardened Runtime, entitlement; tecnologia individuata (ad esempio Electron) | validità della firma presso Apple; decompilazione senza Ghidra                                                |
| Electron cartella/`.asar` | `analyze_javascript_application`                     | —                                                                                                                             | come in Fase 0                                                                                                                                                                                                                                                                      | comportamento a runtime                                                                                       |
| Windows `.exe`/`.dll`     | `inspect_artifact` (riconosce il PE)                 | `inspect_managed_artifact`, `inspect_pe_imports`, `inspect_pe_resources`, `inspect_pe_certificates`, `inspect_native_exports` | PE32/PE32+, architettura, numero di sezioni, EXE o DLL, .NET o nativo; DLL importate; capacità potenziali sempre come **Ipotesi**; risorse; firma Authenticode presente o assente; esportazioni                                                                                     | nomi e permessi delle sezioni (non esposti dal motore); verifica dei certificati; decompilazione senza Ghidra |
| SQLite                    | `inspect_sqlite_database` (`schema_scope: database`) | —                                                                                                                             | motore, dimensione, codifica, tabelle con colonne e tipi, indici, viste, trigger                                                                                                                                                                                                    | contenuto delle righe: mai letto; database cifrati                                                            |

Altre scelte:

- Il formato dei file viene deciso dal classificatore dei byte del motore
  (`inspect_artifact`); solo SQLite viene riconosciuto dall'intestazione
  documentata `SQLite format 3\0`, poi convalidato da SQLite stesso.
- Il difetto "dimensione 0 byte" è corretto: la dimensione è la somma misurata
  dei file, e il rapporto dichiara quando la misura è parziale.
- **Limiti di risorse:**
  - bundle: al massimo 20.000 elementi esaminati, oltre la copertura è parziale;
  - limiti di byte e voci dei servizi PE e SQLite;
  - risorse del worker JavaScript;
  - la GUI rifiuta la radice del disco, le cartelle di primo livello e la
    cartella Inizio.

## 7. Sito pubblico su Cloudflare Free (G5, non ora)

- **Contenuto.** Solo pagine statiche: presentazione, guida all'installazione
  da GitHub, avvertenze legali, licenze e attribuzioni a REA. Nessun motore,
  nessun caricamento di file, nessun modulo.
- **Servizio.** Cloudflare Pages (o asset statici di Workers) sul piano Free,
  senza Functions, KV, R2, D1, Images o Stream. Nessun metodo di pagamento
  associato.
- **Pubblicazione.** Due possibilità, entrambe senza GitHub Actions e senza
  `wrangler`/`npx`:
  1. caricamento diretto dalla dashboard di Cloudflare, consigliato all'inizio;
  2. integrazione Git di Pages limitata a una cartella `site/`.
- **Dominio:** `insideapp.pezzalihub.app`, sul tuo account Cloudflare Free.
- **Prima di G5** verificherò sulla documentazione ufficiale le condizioni del
  piano Free in vigore in quel momento. Nessun servizio a pagamento o a consumo.

## 8. Decisioni prese

1. Architettura approvata; G0 autorizzato e completato.
2. Strumento MCP `create_report`: approvato per G4, sullo stesso servizio.
3. Test end-to-end: approvati per le fasi GUI, solo con il Chrome già
   installato e `playwright-core` esistente, senza scaricare browser.
4. Priorità dei formati: `.app`, Electron/`.asar`, `.exe`/`.dll`, SQLite
   (tabella 6.1).
5. Sito: `insideapp.pezzalihub.app` su Cloudflare Free, solo statico, deploy
   non ancora autorizzato.
6. Log di npm: `.npmrc` di progetto con `logs-dir=.cache/npm-logs` (fatto in G0).
