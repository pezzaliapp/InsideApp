# Sito di InsideApp

Pagina statica di presentazione per `insideapp.pezzalihub.app`.

- Solo HTML e CSS: nessuno script, nessuna risorsa esterna, nessun cookie,
  analytics o modulo. Non riceve file e non esegue analisi.
- `_headers` imposta le intestazioni di sicurezza (Content Security Policy e
  altre) su Cloudflare Pages.
- Pubblicazione prevista: Cloudflare Pages, piano gratuito, solo contenuti
  statici (nessuna Function, Worker, KV, R2 o D1). Vedi
  `proposte/architettura-gui.md`, sezione 7.

Anteprima locale: apri `site/index.html` nel browser.

## Pubblicazione

- Progetto Cloudflare Pages `insideapp` (Direct Upload, ramo `main`):
  <https://insideapp.pages.dev/>. Aggiornamento:
  `wrangler pages deploy site --project-name insideapp --branch main`.
- Il dominio `insideapp.pezzalihub.app` è associato al progetto ma resta in
  attesa del record DNS, che l'accesso di Wrangler (DNS in sola lettura) non
  può creare. Da completare nel pannello Cloudflare, gratuitamente: zona
  `pezzalihub.app` → DNS → record `CNAME` `insideapp` → `insideapp.pages.dev`,
  con proxy attivo. Non toccare i record di `pezzalihub.app` e `www`.
