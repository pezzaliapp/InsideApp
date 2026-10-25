---
name: insideapp
description: Analizza in modo locale e lecito applicazioni, eseguibili, pacchetti e artefatti propri o autorizzati con InsideApp — PezzaliAPP (server MCP `insideapp` o CLI `./scripts/insideapp.sh`). Usala per spiegare come funziona una funzionalità di un'app distribuita senza sorgenti, confrontare versioni o decompilare codice con prove. Non usarla per analizzare un normale repository di codice sorgente.
---

# InsideApp — PezzaliAPP

Rispondi all'utente in italiano.

## 1. Verifica di liceità (sempre, prima di analizzare)

Prima della prima analisi di un obiettivo, accertati che sia:

- software, app o sito **di proprietà dell'utente**, oppure
- un obiettivo che l'utente dichiara di essere **autorizzato** ad analizzare
  (incarico, licenza che lo consente, bug bounty, ricerca di sicurezza o
  didattica nei limiti di legge).

Se non è chiaro, chiedilo con una sola domanda. Rifiuta richieste di aggirare
DRM, licenze, attivazioni, anti-cheat, autenticazione o altre protezioni, di
copiare codice proprietario o di accedere a sistemi altrui. Vedi
[AVVERTENZE.md](../../../AVVERTENZE.md).

## 2. Regole della distribuzione locale

- Usa solo gli strumenti MCP del server `insideapp` oppure la CLI
  `./scripts/insideapp.sh` dalla radice del progetto.
- **Non usare mai** `npx`, `npx rea-agents`, `npm install -g`, `rea setup`,
  `rea update`, `uninstall`, `mcp add` o `skills add`: InsideApp li rifiuta
  perché scriverebbero configurazioni globali o eseguirebbero pacchetti
  scaricati.
- Non modificare la configurazione globale di Claude Code né installare
  software. Se manca uno strumento esterno (ad esempio Ghidra), spiega
  all'utente cosa serve e lascia a lui l'installazione.
- Non proporre né usare Hopper, IDA Pro o JEB: sono esclusi da InsideApp.

Se gli strumenti `insideapp` non compaiono: verifica che Claude Code sia stato
avviato dalla radice del progetto e che il server di `.mcp.json` sia stato
approvato; poi esegui `./scripts/insideapp.sh doctor`. Se il launcher segnala
Node mancante, rimanda alla sezione "Installazione locale" del README.

## 3. Come analizzare

1. Parti dalla domanda dell'utente (quale funzionalità o comportamento vuole
   capire) e scegli l'analisi statica più mirata.
2. Preferisci operazioni che non eseguono l'obiettivo. Avvia o osserva
   programmi, browser o dispositivi solo se l'utente lo chiede e l'obiettivo è
   autorizzato. Gli strumenti dinamici (debugger, Frida, scenari, modifiche ai
   dispositivi Android) sono rifiutati finché l'utente non avvia InsideApp con
   `INSIDEAPP_ALLOW_DYNAMIC_ANALYSIS=1`: non cercare di aggirare il rifiuto e
   non impostare tu la variabile; spiega all'utente rischi e procedura, e
   lascia a lui la decisione.
3. Riporta i risultati distinguendo **osservazioni**, **derivazioni**,
   **inferenze** ed elementi **sconosciuti**, citando le prove (percorsi,
   offset, digest) restituite da InsideApp.
4. Restituisci la risposta più breve che sia sufficiente; usa paginazione,
   viste selettive e riferimenti alle Evidence già salvate invece di ripetere
   analisi complete. Per `analyze_javascript_application` parti da
   `detail: "summary"` (sull'app di prova circa 24 KB invece di circa 940 KB)
   e approfondisci con `inspect_analysis_view`.

Punti di partenza tipici:

| Obiettivo                                  | Strumento / comando                                                 |
| ------------------------------------------ | ------------------------------------------------------------------- |
| App JavaScript/Electron (cartella o .asar) | `analyze_javascript_application` / `analyze-javascript-application` |
| File o bundle sconosciuto                  | `inspect_artifact` / `inspect-artifact`                             |
| App desktop installata                     | `inspect_desktop_application`                                       |
| Eseguibile nativo, decompilazione          | `open_binary`, poi `analyze_function` (richiede Ghidra configurato) |
| Assembly .NET                              | `inspect_managed_artifact`, `inspect_managed_members`               |
| Database SQLite                            | `inspect_sqlite_database`                                           |
| Rapporto completo in italiano              | `create_report` (`authorized: true`) / CLI `report --authorized`    |

Per `create_report` (e per il comando `report`) usa `authorized: true`
(`--authorized`) solo dopo che l'utente ha confermato la liceità (sezione 1).

- Parti da `create_report` quando l'utente vuole capire un'app nel suo insieme:
  copre app Electron, bundle `.app`, eseguibili Windows, SQLite (solo struttura)
  e altri file, con le classi Osservato, Derivato, Ipotesi e Sconosciuto.
- Riporta le Ipotesi come tali e cita le prove.
- Il comando CLI salva i file in `rapporti-insideapp/` o nella cartella indicata
  con `--output-dir`.

Per i flussi dettagliati consulta i riferimenti tecnici originali (in inglese)
in `.agents/skills/reverse-engineer-anything/references/`. Quando citano
`npx rea-agents …` o `rea …`, sostituisci con `./scripts/insideapp.sh …`;
ignora le istruzioni su `setup` e sui provider commerciali.
