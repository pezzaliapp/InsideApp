import type { ApplicationGraphEvidence } from "../../domain/javascript/javascriptApplicationEvidenceSchemas.js";
import type { ApplicationNode } from "../../domain/javascript/javascriptApplicationGraphSchemas.js";
import {
  parseOwnedJavaScriptApplicationAnalysisSteps,
  type JavaScriptApplicationAnalysisResult,
} from "../../domain/javascript/javascriptApplicationAnalysis.js";
import type { JAVASCRIPT_SEMANTIC_UNKNOWN_REASONS } from "../../domain/javascript/javascriptSemanticGraphSchemas.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import {
  compareUnicodeCodePoints,
  compositeKey,
} from "../../domain/unicodeCodePointOrder.js";
import {
  classifyEngineAssessment,
  ReportClaimCollector,
  type ReportEvidenceReference,
  type ReportSection,
} from "../../domain/report/insideAppReport.js";
import {
  quoted,
  recordEvidence,
  type RecordContext,
  type ReportClaimBuilder,
} from "./reportText.js";

type NodeKind = ApplicationNode["kind"];
type NodeObservation = ApplicationNode["observations"][number];
type UnknownReason = (typeof JAVASCRIPT_SEMANTIC_UNKNOWN_REASONS)[number];

/** Graph facts restated by richer facts or too granular for readers. */
const OMITTED_KINDS: ReadonlySet<NodeKind> = new Set([
  "artifact",
  "asar-entry",
  "javascript-asset",
  "javascript-chunk",
  "source-module",
  "ipc-handler",
]);

/** Italian nouns for entity kinds without a dedicated sentence. */
const GENERIC_NOUNS: Readonly<
  Record<NodeKind, { section: ReportSection["id"]; noun: string }>
> = {
  package: { section: "summary", noun: "Pacchetto" },
  installer: { section: "summary", noun: "Installer" },
  artifact: { section: "components", noun: "File" },
  "asar-entry": { section: "components", noun: "Voce dell'archivio ASAR" },
  "electron-main": { section: "summary", noun: "Processo principale" },
  "electron-preload": { section: "components", noun: "Script di preload" },
  "electron-renderer": { section: "components", noun: "Interfaccia" },
  "electron-utility": {
    section: "components",
    noun: "Processo di utilità di Electron",
  },
  "javascript-asset": { section: "components", noun: "File JavaScript" },
  "javascript-chunk": { section: "components", noun: "Blocco JavaScript" },
  "javascript-module": { section: "components", noun: "Modulo JavaScript" },
  "javascript-expression": {
    section: "communications",
    noun: "Espressione JavaScript",
  },
  "source-map": { section: "components", noun: "Mappa dei sorgenti" },
  "source-module": { section: "components", noun: "Modulo sorgente" },
  "browser-window": { section: "components", noun: "Finestra" },
  frame: { section: "components", noun: "Frame" },
  target: { section: "components", noun: "Destinazione di esecuzione" },
  "context-bridge-api": {
    section: "communications",
    noun: "API esposta dal preload",
  },
  "ipc-channel": { section: "communications", noun: "Canale IPC" },
  "ipc-handler": { section: "communications", noun: "Gestore IPC" },
  worker: { section: "components", noun: "Web worker" },
  "service-worker": { section: "components", noun: "Service worker" },
  endpoint: {
    section: "communications",
    noun: "Indirizzo di rete trovato nel codice",
  },
  storage: { section: "data", noun: "Archiviazione dei dati" },
  "native-addon": { section: "components", noun: "Modulo nativo (addon)" },
  "native-export": { section: "components", noun: "Funzione nativa esportata" },
  "managed-assembly": { section: "components", noun: "Assembly .NET" },
  "managed-module": { section: "components", noun: "Modulo .NET" },
  "managed-type": { section: "components", noun: "Tipo .NET" },
  "managed-method": { section: "components", noun: "Metodo .NET" },
  "managed-field": { section: "components", noun: "Campo .NET" },
  "managed-pinvoke-import": {
    section: "components",
    noun: "Chiamata nativa da .NET (P/Invoke)",
  },
  "managed-native-implementation": {
    section: "components",
    noun: "Implementazione nativa .NET",
  },
  "runtime-script-instance": {
    section: "components",
    noun: "Script osservato in esecuzione",
  },
  unknown: { section: "limits", noun: "Elemento non classificato" },
};

/** Singular and plural Italian descriptions of each semantic unknown. */
const UNKNOWN_REASONS: Readonly<
  Record<UnknownReason, readonly [string, string]>
> = {
  "ambiguous-target": [
    "destinazione ambigua (più candidati possibili)",
    "destinazioni ambigue (più candidati possibili)",
  ],
  "bound-reached": [
    "punto in cui è stato raggiunto un limite di analisi",
    "punti in cui è stato raggiunto un limite di analisi",
  ],
  "dynamic-call": [
    "chiamata dinamica non risolvibile staticamente",
    "chiamate dinamiche non risolvibili staticamente",
  ],
  "dynamic-property": [
    "proprietà calcolata dinamicamente",
    "proprietà calcolate dinamicamente",
  ],
  "dynamic-scope": [
    "ambito dinamico (ad esempio with o eval)",
    "ambiti dinamici (ad esempio with o eval)",
  ],
  "eval-or-generated-code": [
    "punto con codice generato o valutato a runtime",
    "punti con codice generato o valutato a runtime",
  ],
  "incomplete-module": ["modulo incompleto", "moduli incompleti"],
  "missing-source": ["sorgente mancante", "sorgenti mancanti"],
  "resource-limit": [
    "limite di risorse raggiunto",
    "limiti di risorse raggiunti",
  ],
  "unknown-value": [
    "valore non determinabile staticamente",
    "valori non determinabili staticamente",
  ],
  "unsupported-syntax": [
    "costrutto sintattico non supportato",
    "costrutti sintattici non supportati",
  ],
};

/** Security-relevant Electron window preferences explained for readers. */
const WEB_PREFERENCE_NOTES: Readonly<Record<string, string>> = {
  nodeIntegration:
    "se attivo, il codice della pagina può usare direttamente le API di Node.js",
  contextIsolation:
    "se disattivato, la pagina condivide il contesto JavaScript con il preload",
  sandbox:
    "se disattivato, il renderer non è confinato nella sandbox di Chromium",
  webSecurity:
    "se disattivato, la pagina ignora la politica della stessa origine",
  allowRunningInsecureContent:
    "se attivo, una pagina HTTPS può eseguire contenuti HTTP",
  enableRemoteModule:
    "se attivo, il renderer può usare il modulo remote (deprecato)",
};

const DEFAULT_SENSITIVE_PREFERENCES = [
  "contextIsolation",
  "nodeIntegration",
  "sandbox",
] as const;

const text = (
  properties: Readonly<Record<string, JsonValue>>,
  name: string,
): string | undefined => {
  const value = properties[name];
  return typeof value === "string" ? value : undefined;
};

const graphEvidence = (
  evidence: ApplicationGraphEvidence,
  recordEvidenceId: string,
): ReportEvidenceReference => {
  const location = evidence.location.available
    ? evidence.location.value
    : undefined;
  return {
    evidence_id: evidence.evidence_ids[0] ?? recordEvidenceId,
    path:
      location?.kind === "artifact-path"
        ? location.path
        : location?.kind === "source-range"
          ? location.source
          : null,
    position:
      location?.kind === "source-range"
        ? `riga ${location.start.line}, colonna ${location.start.column + 1}`
        : location?.kind === "file-offset-range"
          ? `byte ${location.start}–${location.end}`
          : null,
    sha256: evidence.artifact.available ? evidence.artifact.sha256 : null,
    method: evidence.extractor.operation,
    engine_assessment: `${evidence.state}/${evidence.confidence}`,
    additional_occurrences: 0,
  };
};

interface Sentence {
  readonly section: ReportSection["id"];
  readonly statement: string;
}

type Properties = NodeObservation["properties"];
type Describer = (
  properties: Properties,
  label: string,
) => Sentence | undefined;

const resolvedPath = (properties: Properties, label: string): string =>
  quoted(text(properties, "resolved_path") ?? label);

const describeModule: Describer = (properties, label) => {
  if (text(properties, "resolution_status") !== "external") return undefined;
  const specifier =
    text(properties, "declared_specifier") ??
    text(properties, "specifier") ??
    label;
  return {
    section: "components",
    statement: specifier.startsWith("node:")
      ? `Usa il modulo di sistema di Node.js ${quoted(specifier)}.`
      : specifier === "electron"
        ? "Usa le API di Electron."
        : `Usa la libreria esterna ${quoted(specifier)}.`,
  };
};

const describeCallPath: Describer = (properties) => {
  const entry = text(properties, "entry");
  const channel = text(properties, "channel");
  // Each path repeats its entry on every step; the first step speaks for it.
  if (properties.step_index !== 0 || entry === undefined) return undefined;
  return {
    section: "communications",
    statement:
      channel === undefined
        ? `La funzione ${quoted(entry)}, esposta all'interfaccia, raggiunge il processo principale.`
        : `La funzione ${quoted(entry)}, esposta all'interfaccia, invia richieste al processo principale sul canale IPC ${quoted(channel)}.`,
  };
};

const describeBridge: Describer = (properties, label) => {
  const members = Array.isArray(properties.members)
    ? properties.members.filter((member) => typeof member === "string")
    : [];
  const listed =
    members.length === 0
      ? ""
      : ` con ${members.length === 1 ? "la funzione" : "le funzioni"} ${members.map((member) => quoted(member)).join(", ")}`;
  return {
    section: "communications",
    statement: `Il preload espone all'interfaccia l'oggetto ${quoted(`window.${text(properties, "api_key") ?? label}`)}${listed}.`,
  };
};

const describeChannel: Describer = (properties) => {
  const channel = text(properties, "channel");
  if (channel === undefined) return undefined;
  const operation = text(properties, "operation") ?? "uso";
  return {
    section: "communications",
    statement:
      text(properties, "side") === "main"
        ? `Il processo principale gestisce il canale IPC ${quoted(channel)} (${operation}).`
        : `L'interfaccia usa il canale IPC ${quoted(channel)} (${operation}).`,
  };
};

/** Dedicated sentences; other kinds use {@link GENERIC_NOUNS}. */
const DESCRIBERS: Readonly<Partial<Record<NodeKind, Describer>>> = {
  package: (properties, label) => {
    const version = text(properties, "version");
    return {
      section: "summary",
      statement: `Il pacchetto dichiara il nome ${quoted(text(properties, "name") ?? label)}${version === undefined ? "" : `, versione ${quoted(version)}`}.`,
    };
  },
  "electron-main": (properties, label) => ({
    section: "summary",
    statement: `È un'applicazione Electron: il processo principale parte da ${resolvedPath(properties, label)}.`,
  }),
  "electron-preload": (properties, label) => ({
    section: "components",
    statement: `Lo script di preload ${resolvedPath(properties, label)} viene caricato prima della pagina e fa da ponte con il processo principale.`,
  }),
  "electron-renderer": (properties, label) => ({
    section: "components",
    statement: `L'interfaccia grafica (renderer) carica ${resolvedPath(properties, label)}.`,
  }),
  "browser-window": (properties, label) => ({
    section: "components",
    statement: `Il codice crea una finestra (BrowserWindow) in ${quoted(text(properties, "source_path") ?? label)}.`,
  }),
  "javascript-module": describeModule,
  "javascript-expression": describeCallPath,
  "context-bridge-api": describeBridge,
  "ipc-channel": describeChannel,
};

/** One reader sentence for one node observation, or none when restated elsewhere. */
const describeObservation = (
  kind: NodeKind,
  observation: NodeObservation,
): Sentence | undefined => {
  const label = observation.label ?? "senza nome";
  const describer = DESCRIBERS[kind];
  if (describer !== undefined) return describer(observation.properties, label);
  if (OMITTED_KINDS.has(kind)) return undefined;
  const { section, noun } = GENERIC_NOUNS[kind];
  return { section, statement: `${noun}: ${quoted(label)}.` };
};

/** Explicit and missing security-relevant preferences of one window. */
const describeWindowSecurity = (
  observation: NodeObservation,
  collector: ReportClaimCollector,
  evidence: ReportEvidenceReference,
): void => {
  const { properties } = observation;
  const source = text(properties, "source_path") ?? "codice";
  const preferences = Array.isArray(properties.web_preferences)
    ? properties.web_preferences
    : [];
  const named = new Set<string>();
  for (const preference of preferences) {
    if (
      typeof preference !== "object" ||
      preference === null ||
      Array.isArray(preference)
    )
      continue;
    const name = preference.name;
    const value = preference.value;
    if (typeof name !== "string" || name === "preload") continue;
    named.add(name);
    const note = WEB_PREFERENCE_NOTES[name];
    const literal =
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      value.status === "literal"
        ? value.value
        : undefined;
    collector.add(
      "security",
      literal === undefined
        ? {
            kind: "unknown",
            statement: `In ${quoted(source)} il valore di ${quoted(`webPreferences.${name}`)} è calcolato durante l'esecuzione e non è determinabile staticamente.`,
            evidence: { ...evidence, engine_assessment: "unknown/unknown" },
          }
        : {
            kind: "observed",
            statement: `In ${quoted(source)} la finestra imposta ${quoted(`webPreferences.${name}`)} a ${quoted(JSON.stringify(literal))}${note === undefined ? "" : ` (${note})`}.`,
            evidence,
          },
    );
  }
  if (text(properties, "web_preferences_status") !== "object-literal") return;
  for (const name of DEFAULT_SENSITIVE_PREFERENCES)
    if (!named.has(name))
      collector.add("security", {
        kind: "unknown",
        statement: `In ${quoted(source)} la finestra non imposta esplicitamente ${quoted(`webPreferences.${name}`)}: vale il valore predefinito della versione di Electron usata, che questa analisi non determina.`,
        evidence: { ...evidence, engine_assessment: "unknown/unknown" },
      });
};

const addAnalysisFacts = (
  result: JavaScriptApplicationAnalysisResult,
  record: RecordContext,
  collector: ReportClaimCollector,
): void => {
  const { statistics, summary } = result;
  collector.add("summary", {
    kind: "observed",
    statement: `Sono stati esaminati ${statistics.relevant_files} file rilevanti, di cui ${statistics.parsed_javascript_files} file JavaScript ${statistics.parsed_javascript_files === 1 ? "interpretato" : "interpretati"}${statistics.parse_failures === 0 ? "" : ` (${statistics.parse_failures} non interpretabili)`}.`,
    evidence: recordEvidence(record),
  });
  if (
    summary.ipc.main_handlers > 0 &&
    summary.sender_validation_observations === 0
  )
    collector.add("security", {
      kind: "unknown",
      statement:
        "Nei gestori IPC del processo principale non è stata osservata alcuna verifica del mittente (ad esempio event.senderFrame); l'analisi statica non dimostra che la verifica manchi.",
      evidence: recordEvidence(record),
    });
  if (summary.ipc.dynamic_channel_operations > 0)
    collector.add("communications", {
      kind: "unknown",
      statement: `${summary.ipc.dynamic_channel_operations} operazioni IPC usano un nome di canale calcolato a runtime.`,
      evidence: recordEvidence(record),
    });
  for (const contradiction of result.integrity_contradictions)
    collector.add("security", {
      kind: "observed",
      statement: `L'integrità dichiarata per ${quoted(contradiction.logical_path)} non corrisponde ai byte letti.`,
      evidence: recordEvidence(record),
    });
  if (result.graph.coverage.status !== "complete")
    collector.add("limits", {
      kind: "unknown",
      statement: `L'inventario dell'applicazione è parziale: ${result.graph.coverage.omitted_count} elementi non sono stati inclusi.`,
      evidence: recordEvidence(record),
    });
};

const addGraphFacts = (
  result: JavaScriptApplicationAnalysisResult,
  record: RecordContext,
  collector: ReportClaimCollector,
): void => {
  for (const node of result.graph.nodes)
    for (const observation of node.observations) {
      const evidence = graphEvidence(observation.evidence, record.evidenceId);
      const sentence = describeObservation(node.kind, observation);
      if (sentence !== undefined)
        collector.add(sentence.section, {
          kind: classifyEngineAssessment(
            observation.evidence.state,
            observation.evidence.confidence,
          ),
          statement: sentence.statement,
          evidence,
        });
      if (node.kind === "browser-window")
        describeWindowSecurity(observation, collector, evidence);
    }
};

interface UnknownGroup {
  readonly reason: UnknownReason;
  readonly source: string;
  count: number;
  readonly first: ReportEvidenceReference;
}

/** One claim per unknown reason and source file, with its first location. */
const addSemanticUnknowns = (
  result: JavaScriptApplicationAnalysisResult,
  record: RecordContext,
  collector: ReportClaimCollector,
): void => {
  const groups = new Map<string, UnknownGroup>();
  for (const unknown of result.semantic_graph.unknowns) {
    const location = unknown.evidence.location.available
      ? unknown.evidence.location.value
      : undefined;
    const source =
      location?.kind === "source-range"
        ? location.source
        : location?.kind === "artifact-path"
          ? location.path
          : "posizione non disponibile";
    const key = compositeKey([unknown.reason, source]);
    const group = groups.get(key);
    if (group !== undefined) {
      group.count += 1;
      continue;
    }
    groups.set(key, {
      reason: unknown.reason,
      source,
      count: 1,
      first: {
        evidence_id: record.evidenceId,
        path: location === undefined ? null : source,
        position:
          location?.kind === "source-range"
            ? `riga ${location.start.line}, colonna ${location.start.column + 1}`
            : null,
        sha256: null,
        method: `semantic-unknown:${unknown.family}`,
        engine_assessment: `unknown/${unknown.reason}`,
        additional_occurrences: 0,
      },
    });
  }
  const ordered = [...groups.values()].sort(
    (left, right) =>
      compareUnicodeCodePoints(left.source, right.source) ||
      compareUnicodeCodePoints(left.reason, right.reason),
  );
  for (const group of ordered)
    collector.add("limits", {
      kind: "unknown",
      statement: `In ${quoted(group.source)}: ${group.count} ${UNKNOWN_REASONS[group.reason][group.count === 1 ? 0 : 1]}.`,
      evidence: { ...group.first, additional_occurrences: group.count - 1 },
    });
};

const parseJavaScriptResult = (
  value: unknown,
): JavaScriptApplicationAnalysisResult => {
  const steps = parseOwnedJavaScriptApplicationAnalysisSteps(value);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
};

/** Claims of one JavaScript application analysis, parsed by its owner. */
export const javascriptApplicationClaims: ReportClaimBuilder = (
  collector,
  value,
  record,
) => {
  const result = parseJavaScriptResult(value);
  addAnalysisFacts(result, record, collector);
  addGraphFacts(result, record, collector);
  addSemanticUnknowns(result, record, collector);
};
