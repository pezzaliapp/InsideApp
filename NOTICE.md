# Avviso di derivazione e attribuzioni

**InsideApp — PezzaliAPP** è un'opera derivata da
[REA — Reverse Engineer Anything](https://github.com/morluto/rea), importata
dal commit `f196ebf80665107aedc16892af25a1e1f9f26f43` (REA 6.7.0).

## Copyright

- Codice originale di REA: Copyright (c) 2026 morluto, rilasciato con
  [licenza MIT](LICENSE). Il file `LICENSE` è conservato senza modifiche.
- Modifiche e aggiunte di InsideApp: Copyright (c) 2026 Alessandro Pezzali
  (PezzaliAPP), rilasciate anch'esse con licenza MIT alle stesse condizioni
  del file `LICENSE`.

La storia Git completa di REA è conservata in questo repository: ogni modifica
di InsideApp è distinguibile dal codice originale tramite `git log` e `git diff`.

## Nessuna affiliazione

InsideApp non è affiliato, sponsorizzato né approvato da morluto, dal progetto
REA o dai suoi contributori. I nomi "REA" e "Reverse Engineer Anything" sono
citati solo per identificare l'origine del codice. Il sito, il logo, la
community e i canali di distribuzione ufficiali di REA non appartengono a
InsideApp.

I nomi di prodotti di terze parti (ad esempio Ghidra, Claude Code, Hopper,
IDA Pro, JEB) servono solo a descrivere integrazioni e non implicano
affiliazione o approvazione.

## Componenti di terze parti

Le licenze, i copyright e gli avvisi dei componenti di terze parti sono
conservati integralmente in:

- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
- [licenses/](licenses/) (inventario completo delle dipendenze npm e testi originali)
- `third_party/*/LICENSE*` e i relativi README di provenienza

## Principali modifiche di InsideApp

- Identità InsideApp — PezzaliAPP e documentazione in italiano.
- Distribuzione esclusivamente locale da Git (`"private": true`).
- Comandi `setup`, `uninstall`, `update`, `--update`, `mcp add` e `skills add`
  disattivati: scriverebbero configurazioni globali o eseguirebbero pacchetti
  scaricati con `npx`/`npm install -g`.
- Server MCP registrato solo a livello di progetto tramite `.mcp.json`.
- Controllo aggiornamenti di `incur`, telemetria e cache remota di Turborepo
  disattivati.
- Infrastruttura di CI, rilascio, pubblicazione npm/registry MCP e deploy di
  REA rimossa: workflow e azioni GitHub, `scripts/ci/` (tranne gli script
  locali `test-group` e `static-check-report`, spostati in `scripts/`),
  Release Please e i relativi script e test. Vedi
  [.github/CI-LOCALE.md](.github/CI-LOCALE.md).
- Sito web, traduzioni del README e installer remoto di REA rimossi; le due
  app di esempio usate dai test sono in `tests/fixtures/examples/`.
- Strumenti commerciali (Hopper, IDA Pro, JEB) esclusi dalla configurazione e
  dalla documentazione di InsideApp.
- Nuovo comando `report`: rapporto in italiano (HTML e Markdown) con le
  affermazioni classificate come Osservato, Derivato, Ipotesi o Sconosciuto
  (`src/domain/report/`, `src/application/report/`, `src/cli/reportCommands.ts`).
- Servizio condiviso `generateReport` per CLI, interfaccia e MCP.
- Interfaccia locale `gui` (`src/gui/`): server su 127.0.0.1 con sessione
  monouso, cookie HttpOnly, controlli Host/Origin/CSRF e CSP rigida;
  scelta nativa dei file, analisi con avanzamento e annullamento, rapporto
  ed esportazione dal browser.
- Rapporti per app macOS (.app), eseguibili Windows (.exe, .dll) e database
  SQLite (solo struttura), composti da operazioni esistenti del motore in
  `src/composition/reportAnalysis.ts`.
- Strumento MCP `create_report`, sullo stesso servizio dei rapporti, e sezione
  facoltativa Claude Code nell'interfaccia, senza chiavi API né configurazioni
  globali.
