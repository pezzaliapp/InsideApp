# Compatibilità Windows — audit e stato (sperimentale)

Stato al 25 ottobre 2026. **Windows non è dichiarato supportato**: manca la
validazione su un computer Windows reale. Il sito pubblico resta invariato.

## 1. Audit delle dipendenze da macOS

| Punto                                           | Dove                                     | Esito su Windows                                                                                            | Tipo                                                                       |
| ----------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Avvio `./scripts/insideapp.sh`                  | `scripts/`                               | Script POSIX: non eseguibile da cmd o PowerShell                                                            | Effettiva → risolta con `scripts\insideapp.cmd`                            |
| Finestra di scelta con `osascript`              | `src/gui/guiTargets.ts`                  | AppleScript assente                                                                                         | Effettiva → risolta con le finestre di Windows Forms                       |
| Apertura del browser con `open`                 | `src/gui/guiLauncher.ts`                 | Comando assente                                                                                             | Effettiva → risolta con Esplora risorse                                    |
| Cartelle troppo ampie                           | `src/application/report/reportTarget.ts` | `C:\Program Files`, `C:\Users` e le condivisioni non erano rifiutate; confronto sensibile alle maiuscole    | Effettiva → corretta                                                       |
| Abbreviazione `~` nei rapporti CLI              | `InsideAppReportService.ts`              | Usava solo `/`                                                                                              | Effettiva → usa il separatore del sistema                                  |
| Testi dell'interfaccia                          | `src/gui/guiAssets.ts`                   | Citavano solo `./scripts/insideapp.sh` e «questo Mac»                                                       | Effettiva → testi per sistema                                              |
| `codesign`, `plutil`, `otool`                   | `src/native/`                            | Disponibili solo su macOS                                                                                   | Effettiva → il rapporto le indica come «non disponibili su questo sistema» |
| Copie private di app JavaScript e SQLite        | motore REA, `native/windows/`            | Su Windows richiedono l'addon nativo `rea-windows-x64.node` (Job Object, DACL protette), non incluso in Git | Effettiva → **aperta**, vedi §4                                            |
| `.mcp.json` con `./scripts/insideapp.sh`        | progetto                                 | Claude Code su Windows non può avviarlo                                                                     | Effettiva → dichiarata non disponibile                                     |
| Permessi `0700`/`0600` del file di avvio        | `guiLauncher.ts`                         | Su Windows valgono i permessi ereditati (ACL)                                                               | Effettiva → mitigata: installazione nel profilo utente                     |
| Cookie, CSP, controlli Host/Origin, `127.0.0.1` | `src/gui/guiSecurity.ts`                 | Indipendenti dal sistema                                                                                    | Presunta: nessuna incompatibilità                                          |
| Percorsi, unità, UNC                            | motore REA                               | Il codice originale li gestisce e ha una linea di test Windows x64                                          | Presunta: nessuna incompatibilità                                          |
| Analisi PE, archivi, altri file                 | motore REA                               | JavaScript puro                                                                                             | Presunta, confermata sotto Wine                                            |
| Dipendenze npm native                           | `package-lock.json`                      | Il lockfile include le varianti win32 (rolldown, oxc, esbuild, node-pty)                                    | Presunta: nessuna incompatibilità                                          |

## 2. Cosa è stato realizzato

- `scripts\insideapp.cmd`: launcher con il Node della toolchain isolata in
  `%USERPROFILE%\.insideapp\toolchain\node-v24.22.1-win-<arch>\node.exe` o in
  `INSIDEAPP_NODE`. Usa `goto` invece di blocchi tra parentesi, perché un
  percorso con `)` li chiuderebbe.
- Finestra di scelta: Windows PowerShell 5.1 (incluso in Windows), chiamato
  per percorso assoluto in `%SystemRoot%`, con `-NoProfile -NonInteractive
  -STA -Command` e uno script fisso. Non usa `-ExecutionPolicy`,
  `-EncodedCommand`, elevazione o download. Se la policy (ad esempio
  Constrained Language Mode) blocca i tipi Windows Forms, l'interfaccia
  risponde «finestra di scelta non disponibile» e indica il comando `report`.
- Apertura del browser: `%SystemRoot%\explorer.exe <file di avvio>`. Esplora
  risorse termina con codice 1 anche quando apre il file, quindi conta come
  successo; un errore di avvio o un timeout no.
- Regola delle cartelle troppo ampie, sensibile al sistema: radici di unità e
  condivisioni, cartelle di primo livello, profilo e sua cartella padre, senza
  distinzione tra maiuscole e minuscole su Windows.
- Stato del motore: su Windows riporta se i controlli nativi sono attivi,
  mancanti o non utilizzabili, e quali analisi restano possibili. I messaggi
  di errore non dicono più «elemento non trovato» quando manca una capacità.
- Rapporti: le analisi aggiuntive che il sistema non offre sono «non
  disponibili su questo sistema», non errori generici.

## 3. Verifiche eseguite

**Su macOS (Apple Silicon, macOS 26)**

- `tests/boundary/gui/insideappWindowsAdapters.test.ts`: regole dei percorsi
  Windows, selettore con un `powershell.exe` sostituito da uno script di prova
  (argomenti, codici d'uscita, percorsi accettati e rifiutati), apertura con
  Esplora risorse simulata, esito `picker_unavailable`, frase del rapporto.
- Regressioni: interfaccia, rapporti CLI, MCP `create_report`, sito,
  importazioni all'avvio; typecheck, lint, Knip, formattazione, `docs:check`.

**Con il Node ufficiale per Windows (`node-v24.22.1-win-x64`, SHA-256
verificato) sotto Wine 9.0**, in un prefisso temporaneo. Wine **non è
Windows**: questi risultati non valgono come validazione.

| Prova                                                      | Esito sotto Wine                                                                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `insideapp.cmd --version`                                  | 6.7.0, codice 0                                                                                                       |
| `insideapp.cmd` senza Node                                 | messaggio italiano, codice 1                                                                                          |
| `report` di un eseguibile PE                               | completato, HTML e Markdown scritti                                                                                   |
| `report` di un archivio ZIP                                | completato                                                                                                            |
| `report` di un'app Electron o di un database SQLite        | si ferma: controlli nativi Windows mancanti                                                                           |
| Stessi rapporti con l'addon upstream di `rea-agents@6.7.0` | l'addon viene accettato (versione, ABI, SHA-256), ma il suo autotest fallisce perché Wine non implementa le DACL NTFS |
| `gui --no-browser`, pagina aperta da Chrome sul Mac        | avvio in circa 0,3 s, piattaforma `win32-x64`, nessuna richiesta esterna                                              |
| File di avvio                                              | monouso: rimosso dopo il primo accesso                                                                                |
| Selettore                                                  | Wine non ha PowerShell: messaggio «non disponibile» corretto                                                          |
| Chiusura dal pulsante e per inattività                     | `reason: shutdown` e `reason: idle`, codice 0, file di avvio rimossi                                                  |

Non verificati: finestre di scelta reali, Esplora risorse reale, Ctrl+C nel
prompt dei comandi, annullamento di un'analisi su Windows, consumo di risorse
su Windows, `npm ci` e `build:cached` su Windows, app Electron e SQLite con i
controlli nativi.

## 4. Decisioni aperte per il proprietario

1. **Controlli nativi Windows.** Servono per app JavaScript/Electron e SQLite.
   Il README upstream (`native/windows/README.md`) prevede di estrarli dal
   pacchetto npm `rea-agents@6.7.0` oppure di compilarli con MinGW-w64 su
   Linux. Il primo è un binario precompilato da REA, non firmato, che Smart
   App Control o le policy aziendali possono bloccare. Il secondo richiede una
   toolchain da installare. InsideApp non adotta nessuna delle due senza
   approvazione.
2. **Pacchetto portabile.** È fattibile senza nuove dipendenze: Node per
   Windows, il repository compilato e `node_modules` installato con
   `npm ci --os=win32 --cpu=x64`, in uno ZIP. Non è stato realizzato perché
   sarebbe inutile senza §4.1 e non verificabile senza Windows reale. Non
   sarebbe un installer, non sarebbe firmato e SmartScreen potrebbe
   segnalarlo.
3. **Claude Code su Windows.** Richiede un `.mcp.json` diverso per sistema,
   oppure un launcher comune: da decidere quando serve.

## 5. Checklist per la validazione su Windows reale

Su Windows 10 e 11 x64, con un utente senza privilegi di amministratore:

1. Installazione secondo il README: download e verifica di Node, `npm.cmd ci`,
   `npm.cmd run build:cached`, `scripts\insideapp.cmd --version` e `doctor`.
2. `scripts\insideapp.cmd gui`: apertura del browser, file di avvio monouso,
   permessi ereditati da `.cache\gui` (solo utente, SYSTEM, Administrators).
3. Finestre di scelta: file, cartella, annullamento, collegamento `.lnk`,
   collegamento simbolico e giunzione (rifiutati), unità diversa da `C:`,
   percorso UNC, nomi con accenti e spazi, radice e `C:\Program Files`
   (rifiutati).
4. Rapporti di un `.exe`, di una `.dll`, di uno ZIP; esportazione HTML,
   Markdown e stampa PDF; assenza di percorsi nei file esportati.
5. Annullamento durante un'analisi; chiusura con Ctrl+C, dal pulsante e per
   inattività; nessun `node.exe` rimasto attivo.
6. Memoria e tempi di un'analisi grande, confrontati con macOS.
7. Con una policy che blocca PowerShell o Windows Forms: messaggio «non
   disponibile» e comando `report` funzionante.
8. Se approvati, i controlli nativi (§4.1): app Electron e SQLite.

Solo dopo questi passaggi si potrà aggiornare il sito.
