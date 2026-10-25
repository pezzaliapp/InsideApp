# Proposta: interfaccia grafica di InsideApp

**InsideApp — Guarda dentro il software.**

Stato: proposta architetturale, nessun codice scritto. Richiede approvazione
prima dello sviluppo.

## Obiettivo

Permettere a chi non usa il terminale di:

1. scegliere un'applicazione o un file di sua proprietà (o che è autorizzato ad analizzare);
2. avviare l'analisi;
3. ricevere un rapporto in italiano comprensibile, con le prove a supporto.

Vincoli invariati:

- il motore resta quello locale di InsideApp;
- nessun servizio a pagamento, nessuna API, nessun account;
- funzionamento offline;
- nessuna modifica globale al sistema.

## Scelta raccomandata: interfaccia web locale

Un nuovo comando `./scripts/insideapp.sh gui` avvia un piccolo server HTTP su
`127.0.0.1` e apre il browser predefinito. Non serve installare altro software:
si usano il Node già presente nella toolchain isolata e il browser del Mac.

| Opzione                       | Pro                                                                 | Contro                                               | Costo                                                           |
| ----------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| **Web locale (raccomandata)** | Nessuna nuova dipendenza pesante, multipiattaforma, riusa il motore | Va protetta come ogni server locale (vedi Sicurezza) | Zero                                                            |
| Tauri (WebView di sistema)    | App nativa leggera                                                  | Richiede la toolchain Rust e un secondo linguaggio   | Zero solo per uso locale; la notarizzazione Apple è a pagamento |
| Electron                      | Tutto in JavaScript                                                 | Circa 200 MB, aggiornamenti di sicurezza frequenti   | Come Tauri                                                      |
| SwiftUI nativa                | Integrazione macOS migliore                                         | Solo macOS, motore da collegare via processo esterno | Come Tauri                                                      |

La distribuzione pubblica di un'app firmata e notarizzata per macOS richiede
l'Apple Developer Program, che è a pagamento: per questo è esclusa. Un
contenitore desktop (Tauri) potrà essere valutato in seguito **solo come build
locale**, con firma ad hoc gratuita, riusando la stessa interfaccia web.

## Architettura

```text
Browser (HTML/CSS/JS statici, serviti in locale, nessuna CDN)
   │  JSON su http://127.0.0.1:<porta casuale>  + token di sessione
   ▼
src/gui/            nuovo adapter, allo stesso livello di CLI e MCP
   │  - server HTTP minimale (node:http), nessun framework
   │  - selezione del file tramite finestra nativa di sistema
   │  - avanzamento e annullamento delle analisi
   ▼
Workflow applicativi esistenti (src/application, src/composition)
   │  analyze_javascript_application, inspect_artifact,
   │  inspect_desktop_application, inspect_sqlite_database, …
   ▼
Evidence locali  ──►  Generatore del rapporto (nuovo, src/report/)
                      modello di rapporto → HTML autonomo, Markdown, JSON
```

Principi, coerenti con `AGENTS.md`:

- **Le dipendenze puntano verso l'interno.** La GUI è un terzo adapter, come la CLI e il server
  MCP; non contiene logica di analisi e non reinterpreta i dati grezzi.
- **Contratti condivisi.** La GUI chiama gli stessi workflow e contratti degli strumenti
  MCP, così CLI, MCP e GUI restituiscono gli stessi risultati.
- **Rapporto separato dalla presentazione.** Un modello di rapporto tipizzato
  (sezioni, affermazioni, prove, limiti) viene prodotto dalle Evidence. L'HTML
  e il Markdown sono solo rappresentazioni di quel modello, quindi lo stesso
  rapporto potrà essere generato anche da CLI (`report`) e da Claude Code.

### Selezione dell'applicazione

Un browser non fornisce il percorso reale dei file trascinati. Il pulsante
**Scegli…** chiede quindi al server di aprire la finestra nativa:

- su macOS `osascript` (`choose file` / `choose folder`), già incluso nel sistema;
- su Linux `zenity`, se presente, altrimenti un campo per incollare il percorso.

Non si caricano copie dei file: il motore legge l'originale in sola lettura.
Sono accettati bundle `.app`, `.asar`, cartelle di app, `.exe`/`.dll`, `.apk`,
database SQLite e file generici.

## Esperienza utente

1. **Benvenuto e liceità.** Breve testo da `AVVERTENZE.md`. Casella obbligatoria: "Dichiaro
   che il software è mio o che sono autorizzato ad analizzarlo".
2. **Selezione.** Scelta del file o della cartella. InsideApp riconosce il tipo
   (`inspect_artifact`) e propone le analisi adatte, spiegandole in una riga.
3. **Analisi.** Barra di avanzamento per fase, pulsante **Annulla**, tempo trascorso.
   Nessuna esecuzione dell'applicazione analizzata: solo analisi statica, salvo
   scelta esplicita in una sezione "Avanzate".
4. **Rapporto.**
   - **In breve**: cos'è l'applicazione, con quale tecnologia è costruita, cosa fa di rilevante.
   - **Componenti**: moduli, librerie, framework, versioni.
   - **Comunicazioni**: canali IPC, indirizzi di rete trovati nel codice, permessi.
   - **Dati e file**: dove legge e scrive, database, preferenze.
   - **Sicurezza**: firma del codice, entitlement, fuse di Electron, impostazioni rischiose.
   - **Limiti e sconosciuti**: cosa non è stato possibile verificare e perché.

   Ogni affermazione porta un'etichetta (**Osservato**, **Derivato**, **Ipotesi**,
   **Sconosciuto**) e un collegamento "Mostra prova" con percorso, offset e digest.
   Un glossario spiega i termini tecnici.

5. **Esportazione.** HTML autonomo, PDF (tramite la stampa del browser), Markdown e bundle
   JSON delle Evidence, salvati dove sceglie l'utente.

Claude Code resta facoltativo: un pulsante **Copia richiesta per Claude Code**
prepara un testo da incollare in una sessione avviata nella cartella del
progetto. La GUI non chiama API di Claude, quindi non genera costi a consumo.

## Sicurezza e privacy

- **Ascolto locale.** Il server accetta connessioni solo da `127.0.0.1`, su una porta casuale.
- **Token di sessione.**
  - È casuale e viene passato nel frammento dell'URL aperto nel browser.
  - Ogni richiesta lo richiede, insieme al controllo delle intestazioni `Host`
    e `Origin`, contro gli attacchi DNS rebinding e CSRF.
- **Pagina isolata.**
  - Content Security Policy restrittiva.
  - Nessuna risorsa esterna: font, icone e script sono inclusi.
  - Nessuna telemetria.
- **Accesso ai file.**
  - Il server analizza solo i percorsi scelti dall'utente in quella sessione.
  - Nessuna esecuzione di comandi arbitrari.
- **Pulizia.** Gli spazi di lavoro temporanei vengono rimossi alla chiusura; il server si spegne quando
  si chiude la scheda o dopo un periodo di inattività.

## Tecnologia

- **Server.** `node:http`, senza nuove dipendenze di runtime.
- **Interfaccia.** HTML, CSS e TypeScript senza framework, oppure Preact (MIT, circa 4 KB) se
  la complessità lo richiede, compilati con l'esbuild già presente nel progetto.
- **Test.**
  - Test di confine sul server: token, `Host`, percorsi non autorizzati.
  - Golden del modello di rapporto sulle app di prova in `tests/fixtures/examples`.
  - Facoltativo: test end-to-end con il Chrome di sistema, tramite il Playwright
    già usato dal progetto.

## Fasi proposte

| Fase | Contenuto                                                                     | Esito verificabile                                       |
| ---- | ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| 0    | Modello di rapporto e generatore (HTML/Markdown) da CLI, senza GUI            | `insideapp report <percorso>` sull'app di prova          |
| 1    | Server locale sicuro, selezione file, analisi JavaScript/Electron e artefatti | Rapporto completo dell'app Electron di prova dal browser |
| 2    | Mach-O/app macOS, PE, APK, SQLite; annullamento e avanzamento                 | Rapporti per ciascun tipo sulle fixture                  |
| 3    | Esportazione PDF/HTML/JSON, glossario, accessibilità                          | Esportazioni verificate, navigazione da tastiera         |
| 4    | Facoltativa: contenitore desktop locale (Tauri), solo build locale            | App avviabile senza costi di firma                       |

## Decisioni richieste

1. Approvare l'interfaccia web locale come prima soluzione.
2. Approvare la Fase 0 (rapporto da CLI) come primo passo, utile anche senza GUI.
3. Indicare i tipi di applicazione prioritari: ad esempio app Electron, app macOS o APK.
