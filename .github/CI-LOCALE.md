# CI di InsideApp

InsideApp **non ha CI attiva**. I workflow GitHub, le azioni composite, gli
script `scripts/ci/` e la configurazione di rilascio ereditati da REA sono stati
rimossi perché servivano a runner self-hosted, cache remote, pubblicazione su
npm e sul registry MCP e al deploy del sito.

Le verifiche si eseguono in locale, con la toolchain isolata (vedi
[README.md](../README.md)):

```bash
export PATH="$HOME/.insideapp/toolchain/node-v24.22.1-darwin-arm64/bin:$PATH"
npm run build:cached
npm run check:fast      # typecheck e lint
npm run knip
npm run test:fast
npm run test:boundary
npm run docs:check
```

Esegui i comandi `npm` dalla radice del progetto. Il file `.npmrc` del progetto
scrive i log di npm in `.cache/npm-logs/`, esclusa da Git, invece che nella
cartella condivisa `~/.npm/_logs`. npm risolve quel percorso rispetto alla
cartella corrente: da una sottocartella creerebbe un altro `.cache/npm-logs`
lì dentro.

## Introdurre in futuro una CI gratuita

Prima di aggiungere un file in `.github/workflows/` serve l'autorizzazione del
proprietario del progetto. Una CI ammessa deve rispettare tutte queste regole:

- **Costo zero.** Solo runner ospitati da GitHub su repository pubblico (gratuiti);
  nessun runner self-hosted, nessun servizio esterno, nessuna cache remota a
  pagamento. Su un repository privato i minuti gratuiti sono limitati: non
  associare metodi di pagamento.
- **Nessuna pubblicazione.** Nessun `npm publish`, registry MCP, GitHub Pages,
  release automatiche o upload di artefatti verso servizi terzi.
- **Permessi minimi.** `permissions: contents: read`, nessun segreto, nessun
  trigger `pull_request_target`.
- **Avvio controllato.** Preferire `workflow_dispatch` (avvio manuale); al più
  `pull_request` e `push` sul ramo `main`.
- **Azioni bloccate per SHA.** Ogni `uses:` indica un commit completo, non un tag.
- **Stessa installazione locale.** `npm ci --ignore-scripts --no-audit --no-fund`.

Bozza di partenza (da non attivare senza autorizzazione). Gli SHA sono quelli
già usati da REA per `actions/checkout` e `actions/setup-node` v4.4.0:

```yaml
name: verifiche
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  verifiche:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
        with:
          persist-credentials: false
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version-file: .nvmrc
      - run: npm ci --ignore-scripts --no-audit --no-fund
      - run: npm run build:cached
      - run: npm run check:fast
      - run: npm run test:fast
```

`turbo.json` considera già `.github/workflows/*.yml` tra gli input di Knip,
quindi un workflow aggiunto viene analizzato dalle verifiche statiche.
