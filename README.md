# InsideApp — PezzaliAPP

**Analisi locale, documentata e lecita di applicazioni e software propri o
autorizzati, da terminale o da Claude Code.**

InsideApp esamina applicazioni JavaScript/Electron, eseguibili nativi, archivi,
database e altri artefatti **sul tuo computer**, restituendo risultati
accompagnati dalle prove (Evidence) che li sostengono, dai limiti dell'analisi
e da ciò che resta sconosciuto.

InsideApp è un progetto di Alessandro Pezzali (PezzaliAPP) derivato da
[REA — Reverse Engineer Anything](https://github.com/morluto/rea) di morluto,
con licenza MIT. **Non è affiliato né approvato dagli autori di REA.**
Dettagli in [NOTICE.md](NOTICE.md).

> [!IMPORTANT]
> Usa InsideApp solo su software di tua proprietà o che sei autorizzato ad
> analizzare. Leggi le [avvertenze d'uso](AVVERTENZE.md) prima di iniziare.

## Principi

- **Locale e senza costi.** Nessun account, nessuna API a pagamento, nessuna
  carta di credito, nessun server esterno. Il server MCP comunica con Claude
  Code via stdio sul tuo Mac.
- **Solo a livello di progetto.** Nessuna installazione globale e nessuna
  modifica alla configurazione globale di Claude Code: il server MCP è
  dichiarato in [.mcp.json](.mcp.json) dentro questa cartella.
- **Nessun aggiornamento automatico.** InsideApp non interroga npm e non si
  auto-aggiorna: si aggiorna con `git pull`.
- **Prove, non supposizioni.** Ogni risultato distingue osservazioni,
  derivazioni, inferenze ed elementi sconosciuti.

## Requisiti

| Componente  | Versione                            | Note                                                                                                     |
| ----------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| macOS       | Apple Silicon (arm64)               | Verificato su macOS 26. Linux x64/arm64 è supportato dal codice originale ma non verificato in InsideApp |
| Node.js     | 24.22.1 (da [.nvmrc](.nvmrc))       | Installato in una toolchain isolata, vedi sotto                                                          |
| Claude Code | qualsiasi versione con supporto MCP | Facoltativo: InsideApp funziona anche da terminale                                                       |

## Installazione locale

Tutti i passaggi restano nella cartella del progetto e in
`~/.insideapp/toolchain/`. Il Node di sistema, nvm e gli altri progetti non
vengono toccati.

### 1. Node.js nella toolchain isolata

```bash
V=v24.22.1
mkdir -p ~/.insideapp/download ~/.insideapp/toolchain
cd ~/.insideapp/download
curl -fsSLO https://nodejs.org/dist/$V/SHASUMS256.txt
curl -fsSLO https://nodejs.org/dist/$V/node-$V-darwin-arm64.tar.xz
grep " node-$V-darwin-arm64.tar.xz\$" SHASUMS256.txt | shasum -a 256 -c -
tar -xJf node-$V-darwin-arm64.tar.xz -C ~/.insideapp/toolchain
```

Facoltativo: verifica anche la firma GPG di `SHASUMS256.txt` con le
[chiavi di rilascio di Node.js](https://github.com/nodejs/release-keys).

### 2. Dipendenze e build

```bash
cd ~/InsideApp
export PATH="$HOME/.insideapp/toolchain/node-v24.22.1-darwin-arm64/bin:$PATH"
npm ci --ignore-scripts --no-audit --no-fund --no-update-notifier
npm run build:cached
```

`--ignore-scripts` impedisce l'esecuzione degli script di installazione dei
pacchetti (ad esempio il download non verificato del binario di Frida) e degli
hook Git di sviluppo.

### 3. Verifica

```bash
./scripts/insideapp.sh --version
./scripts/insideapp.sh doctor
```

## Uso con Claude Code

1. Apri Claude Code **dalla cartella del progetto**: `cd ~/InsideApp && claude`.
2. Alla prima apertura Claude Code chiede di approvare il server MCP
   `insideapp` dichiarato in `.mcp.json`: approvalo.
3. Chiedi, ad esempio:

```text
Analizza con InsideApp l'applicazione Electron in /percorso/della/mia-app:
spiegami come funziona il salvataggio delle preferenze e mostrami le prove.
```

La skill di progetto [.claude/skills/insideapp](.claude/skills/insideapp/SKILL.md)
guida Claude nell'uso degli strumenti e nella verifica della liceità
dell'analisi.

Per usare InsideApp da un'altra cartella, copia `.mcp.json` in quella cartella
sostituendo il percorso relativo con quello assoluto di `scripts/insideapp.sh`.

## Uso da terminale

```bash
./scripts/insideapp.sh <comando> [opzioni]
./scripts/insideapp.sh --help
./scripts/insideapp.sh <comando> --help
```

Esempi:

```bash
# Applicazione JavaScript/Electron (cartella estratta o file .asar)
./scripts/insideapp.sh analyze-javascript-application /percorso/app --json

# Panoramica di un artefatto qualsiasi (binario, archivio, bundle .app…)
./scripts/insideapp.sh inspect-artifact /percorso/file --json

# Database SQLite
./scripts/insideapp.sh inspect-sqlite-database /percorso/db.sqlite --json
```

### Rapporto in italiano

Il comando `report` analizza un'applicazione e salva un rapporto leggibile in
HTML e Markdown nella cartella `rapporti-insideapp/` (esclusa da Git):

```bash
./scripts/insideapp.sh report /percorso/app --authorized
./scripts/insideapp.sh report /percorso/app --authorized --only html --output-dir ~/Documenti/rapporti
```

- `--authorized` è obbligatorio: dichiara che il software è tuo o che sei
  autorizzato ad analizzarlo (vedi [AVVERTENZE.md](AVVERTENZE.md)).
- Cartelle e file `.asar` vengono analizzati come applicazioni
  JavaScript/Electron; gli altri file e i bundle `.app` con l'ispezione
  generica degli artefatti.
- Il rapporto è diviso in **In breve**, **Componenti**, **Comunicazioni**,
  **Dati e file**, **Sicurezza** e **Limiti e sconosciuti**. Ogni affermazione è
  marcata come **Osservato**, **Derivato**, **Ipotesi** o **Sconosciuto** e
  riporta la prova: file, riga, SHA-256, Evidence e metodo del motore.
- La pagina HTML è autonoma: nessuno script, nessuna risorsa esterna, tema chiaro
  e scuro, stampabile in PDF dal browser. Il percorso della cartella home è
  mostrato come `~`.
- Nessuna esecuzione dell'applicazione analizzata e nessuna connessione di rete.

### Interfaccia locale (anteprima)

```bash
./scripts/insideapp.sh gui                 # apre il browser predefinito
./scripts/insideapp.sh gui --no-browser    # stampa solo il file di avvio
./scripts/insideapp.sh gui --idle-timeout-minutes 60
```

- **Cosa offre:** per ora la pagina mostra lo stato del motore e le due modalità, autonoma e Claude Code. La scelta dell'applicazione e l'analisi dall'interfaccia arriveranno nella prossima versione; nel frattempo usa `report`.
- **Dove ascolta:** solo su `127.0.0.1`, su una porta scelta dal sistema. Non è raggiungibile da altri dispositivi della rete e non richiede di aprire il firewall.
- **Come si accede:** a ogni avvio InsideApp scrive un file di avvio in `.cache/gui/`, leggibile solo dal tuo utente. Il file contiene un codice monouso valido 60 secondi, che non compare mai nel terminale né negli argomenti dei processi. Il browser lo scambia con un cookie di sessione `HttpOnly` e `SameSite=Strict`.
- **Altri controlli:** ogni richiesta deve avere `Host` e `Origin` esatti e un'intestazione dedicata, contro gli attacchi DNS rebinding e CSRF. La pagina ha una Content Security Policy rigida e non carica risorse esterne.
- **Come si chiude:** con Ctrl+C, con il pulsante «Chiudi InsideApp» oppure dopo 30 minuti senza attività (valore modificabile con `--idle-timeout-minutes`).
- **Limite:** un programma ostile che gira con il tuo stesso utente può leggere i tuoi file e il profilo del browser. Nessun server locale può proteggersi da lui, e InsideApp non dichiara di farlo.

## Funzionalità

### Disponibili subito, offline, senza strumenti aggiuntivi

- Applicazioni JavaScript ed Electron: moduli, import, source map, IPC, fuse.
- Installazioni desktop e bundle di app Apple: inventario, plist, storyboard/nib,
  cataloghi di asset, risoluzione delle librerie dinamiche.
- Eseguibili Mach-O (load command, librerie dinamiche, firma, architetture),
  PE (import, export, certificati, risorse) ed ELF (note, export); entropia
  dei byte.
- Binari Go e Rust (metadati di build e dipendenze), metadati Unity IL2CPP,
  archivi Godot, eseguibili PyInstaller e file `.pyc`, bytecode Erlang BEAM.
- Assembly .NET (metadati, CIL, confini nativi).
- APK Android (firme, Flutter) senza dispositivi.
- Database SQLite, report di crash Apple `.ips`, file di modelli GGUF/safetensors.
- Catture di rete già salvate (HAR, Fiddler SAZ) e bundle di Evidence.

### Disponibili con strumenti gratuiti installati da te

| Funzione                                 | Strumento gratuito                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Decompilazione nativa approfondita       | [Ghidra](https://github.com/NationalSecurityAgency/ghidra) 12.1.x con JDK 21+ (es. Eclipse Temurin) |
| Decompilazione di APK                    | jadx-headless-mcp con JDK                                                                           |
| Analisi di siti web **di tua proprietà** | Un browser Chrome/Chromium già installato                                                           |
| Disassemblaggio                          | GNU objdump, Rizin                                                                                  |
| WebAssembly                              | WABT                                                                                                |

InsideApp non scarica né installa questi strumenti: li installi tu e li indichi
con le variabili descritte nella documentazione tecnica (ad esempio
`GHIDRA_INSTALL_DIR`).

### Non disponibili o escluse

- **Hopper, IDA Pro, JEB**: software commerciale, escluso da InsideApp. Il
  codice di integrazione originale resta nel repository ma non viene
  configurato né documentato.
- **Frida** (strumentazione dinamica): il modulo nativo non viene installato.
- **Solo Linux**: layout ELF offline e crash registrati (pwntools/pwndbg),
  estrazione firmware (Binwalk/Unblob), EVM, TShark e sigrok.
- Comandi disattivati: `setup`, `uninstall`, `update`, `--update`, `mcp add`,
  `skills add`.

### Funzioni che usano la rete

Tutte le analisi statiche sono offline. Usano la rete solo le funzioni che
tu chiedi esplicitamente di rivolgere a un sito o a un servizio: analisi e
screenshot di pagine web, recupero di source map remote, `environment-serve`
(server HTTP locale) e `data/add` con un URL https. Usale solo su siti e
servizi che sei autorizzato ad analizzare.

## Privacy

- Nessuna telemetria in InsideApp. La telemetria e il controllo aggiornamenti
  degli strumenti di build (Turborepo, incur) sono disattivati.
- I risultati restano sul tuo computer. Claude Code riceve solo ciò che il
  server MCP restituisce alle sue richieste, nei limiti del tuo abbonamento.

## Documentazione tecnica

La cartella [docs/](docs/) contiene la documentazione tecnica originale di REA
(in inglese), valida anche per InsideApp per comandi, formati e limiti. Il
[catalogo degli strumenti MCP](docs/mcp-contracts.md#generated-catalog) elenca
ogni strumento con i suoi parametri. Dove
menziona `rea`, `npx rea-agents` o `rea setup`, in InsideApp usa
`./scripts/insideapp.sh` e il file `.mcp.json` di progetto.

## Licenza

MIT. Il codice originale è Copyright (c) 2026 morluto; le modifiche di
InsideApp sono Copyright (c) 2026 Alessandro Pezzali (PezzaliAPP). Vedi
[LICENSE](LICENSE), [NOTICE.md](NOTICE.md) e
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
