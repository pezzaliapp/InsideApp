# Sicurezza

## Versioni supportate

Le correzioni di sicurezza riguardano l'ultima versione sul ramo `main` di
[pezzaliapp/InsideApp](https://github.com/pezzaliapp/InsideApp).

## Segnalare una vulnerabilità

Non pubblicare vulnerabilità, exploit, credenziali, binari privati o
progetti di analisi in una issue pubblica. Usa **Report a vulnerability** nella
scheda **Security** del repository InsideApp per una segnalazione privata.

Indica la versione (commit) di InsideApp, il sistema operativo, lo strumento
esterno coinvolto e la sua versione, l'impatto e le condizioni per riprodurre
il problema. Rimuovi credenziali, binari proprietari, token e percorsi locali
non pertinenti da log ed esempi.

Le vulnerabilità del codice originale di REA possono interessare anche il
progetto upstream: valuta di segnalarle anche a
[morluto/rea](https://github.com/morluto/rea/security) secondo la sua policy.

## Confine di sicurezza

- InsideApp gira localmente con i permessi del tuo utente e **non è una
  sandbox**: aprire un file non fidato significa farlo elaborare dagli
  strumenti locali (ad esempio Ghidra) con i tuoi permessi. Per campioni non
  fidati usa una macchina virtuale o un account dedicato.
- I bridge verso i motori di analisi usano socket Unix dell'utente corrente e
  token casuali per sessione, trasferiti tramite descrittori privati e non
  tramite argomenti o variabili d'ambiente.
- Le sessioni Ghidra usano un progetto temporaneo isolato, eliminato alla
  chiusura; InsideApp non apre né modifica progetti Ghidra dell'utente e non
  installa né aggiorna Ghidra o Java.
- InsideApp non esegue `npx` né installazioni globali e non modifica la
  configurazione globale degli agent: i comandi che lo farebbero sono
  disattivati.
