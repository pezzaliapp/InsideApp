import type { GuiAnalysisFailure } from "./guiAnalyses.js";

/** Italian, path-free explanations; engine messages may name local paths. */
export const failureMessage = ({
  code,
  category,
}: GuiAnalysisFailure): string => {
  if (category === "unsupported_target" || code === "unsupported_target")
    return "Questo elemento non è supportato in questa versione. InsideApp analizza app Electron (cartelle o file .asar) e ispeziona eseguibili, archivi e bundle .app.";
  if (category === "invalid_input")
    return "L'elemento non è leggibile nel formato previsto: potrebbe essere danneggiato o di un altro tipo.";
  if (code === "access_denied")
    return "InsideApp non ha il permesso di leggere l'elemento scelto.";
  if (code === "capability_unavailable")
    return "Questa analisi non è disponibile su questo computer: su Windows richiede i controlli nativi di InsideApp (vedi il README). Eseguibili, archivi e altri file restano analizzabili.";
  if (category === "unavailable")
    return "L'elemento scelto non è stato trovato o non è leggibile.";
  if (code === "resource_constraint")
    return "L'elemento supera i limiti di analisi di questa versione.";
  if (code === "artifact_integrity_mismatch")
    return "L'integrità dichiarata di un componente non corrisponde ai byte letti: l'analisi si è fermata.";
  return `L'analisi non è riuscita (codice ${code}).`;
};
