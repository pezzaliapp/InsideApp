import { desktopApplicationSchema } from "../../domain/desktopApplication.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import {
  inspectMachoSchema,
  inspectPlistSchema,
  inspectSignatureSchema,
} from "../../domain/native/nativeInspection.js";
import type {
  ReportClaimCollector,
  ReportEvidenceReference,
} from "../../domain/report/insideAppReport.js";
import {
  formatBytes,
  quoted,
  recordEvidence,
  type RecordContext,
  type ReportClaimBuilder,
} from "./reportText.js";

/** Most bundle entries listed one by one; the rest are counted. */
const MAX_LISTED = 40;

const atPath = (
  record: RecordContext,
  path: string | null,
): ReportEvidenceReference => ({ ...recordEvidence(record), path });

const RUNTIME_FAMILIES: Readonly<Record<string, string>> = {
  electron: "Electron",
  dotnet: ".NET",
  "unity-mono": "Unity (Mono)",
  "unity-il2cpp": "Unity (IL2CPP)",
  unreal: "Unreal Engine",
  godot: "Godot",
  gamemaker: "GameMaker",
};

/** Bundle roles recognised from conventional macOS bundle paths. */
const bundleRole = (path: string): string | undefined => {
  if (/^Contents\/MacOS\/[^/]+$/u.test(path)) return "Eseguibile";
  if (/^Contents\/Frameworks\/[^/]+\.framework$/u.test(path))
    return "Framework incluso";
  if (/^Contents\/Frameworks\/[^/]+\.dylib$/u.test(path))
    return "Libreria dinamica inclusa";
  if (
    /^Contents\/(?:PlugIns|Library\/[^/]+)\/[^/]+\.(?:appex|plugin|bundle|xpc)$/u.test(
      path,
    )
  )
    return "Estensione o plug-in";
  if (/^Contents\/XPCServices\/[^/]+\.xpc$/u.test(path)) return "Servizio XPC";
  if (
    /^Contents\/(?:Helpers|Library\/LoginItems|Frameworks)\/[^/]+\.app$/u.test(
      path,
    )
  )
    return "App di supporto";
  if (/^Contents\/Resources\/[^/]+\.asar$/u.test(path))
    return "Archivio JavaScript (.asar)";
  return undefined;
};

type DesktopResult = ReturnType<typeof desktopApplicationSchema.parse>;

/** Element counts and the measured size, stated as partial when it is. */
const addBundleSize = (
  collector: ReportClaimCollector,
  result: DesktopResult,
  record: RecordContext,
): void => {
  const files = result.files.filter((file) => file.kind === "file");
  const measured = files.filter((file) => file.bytes !== null);
  const bytes = measured.reduce((total, file) => total + (file.bytes ?? 0), 0);
  const complete =
    result.coverage.status === "complete-within-scan" &&
    result.omissions.length === 0 &&
    measured.length === files.length;
  collector.add("summary", {
    kind: "observed",
    statement: `Il bundle contiene ${result.coverage.entries_examined} elementi esaminati: ${files.length} file e ${result.files.filter((file) => file.kind === "directory").length} cartelle.`,
    evidence: recordEvidence(record),
  });
  collector.add("summary", {
    kind: "observed",
    statement: `Dimensione misurata dei file: ${formatBytes(bytes)}${complete ? "" : " (misura parziale: alcuni elementi non sono stati esaminati o non hanno una dimensione leggibile)"}.`,
    evidence: recordEvidence(record),
  });
};

/** Executables, frameworks, plug-ins and other conventional bundle parts. */
const addBundleComponents = (
  collector: ReportClaimCollector,
  result: DesktopResult,
  record: RecordContext,
): void => {
  let listed = 0;
  for (const file of result.files) {
    const role = bundleRole(file.path);
    if (role === undefined) continue;
    listed += 1;
    if (listed <= MAX_LISTED)
      collector.add("components", {
        kind: "observed",
        statement: `${role}: ${quoted(file.path)}${file.bytes === null ? "" : ` (${formatBytes(file.bytes)})`}.`,
        evidence: atPath(record, file.path),
      });
  }
  if (listed > MAX_LISTED)
    collector.add("components", {
      kind: "observed",
      statement: `Altri ${listed - MAX_LISTED} componenti del bundle non sono elencati singolarmente.`,
      evidence: recordEvidence(record),
    });
};

/** Runtime candidates, components, follow-up probes and coverage limits. */
const addBundleFindings = (
  collector: ReportClaimCollector,
  result: DesktopResult,
  record: RecordContext,
): void => {
  const pathOf = (id: string | undefined) =>
    (id === undefined ? undefined : pathsById.get(id)) ?? null;
  const pathsById = new Map(
    result.files.map((file) => [file.file_id, file.path]),
  );
  for (const candidate of result.candidates)
    collector.add("summary", {
      kind: candidate.confidence === "derived" ? "derived" : "hypothesis",
      statement: `Tecnologia individuata: ${RUNTIME_FAMILIES[candidate.family] ?? candidate.family}.`,
      evidence: atPath(record, pathOf(candidate.basis_file_ids[0])),
    });
  for (const component of result.components)
    collector.add("security", {
      kind: "hypothesis",
      statement: `Possibile componente di tipo ${component.category === "protection" ? "protezione del codice" : "caricatore di mod"}: ${quoted(component.name)}; la sua presenza durante l'esecuzione non è nota.`,
      evidence: atPath(record, pathOf(component.basis_file_ids[0])),
    });
  for (const probe of result.next_probes)
    if (probe.operation === "analyze_javascript_application")
      collector.add("limits", {
        kind: "unknown",
        statement: `Il codice JavaScript in ${quoted(pathOf(probe.file_id) ?? "un archivio del bundle")} non è analizzato in questo rapporto: sceglilo da solo per l'analisi completa dell'app Electron.`,
        evidence: atPath(record, pathOf(probe.file_id)),
      });
  if (result.omissions.length > 0)
    collector.add("limits", {
      kind: "unknown",
      statement: `${result.omissions.length} elementi non sono stati esaminati (collegamenti simbolici o file speciali).`,
      evidence: recordEvidence(record),
    });
  if (result.coverage.status === "partial")
    collector.add("limits", {
      kind: "unknown",
      statement: `L'ispezione è parziale: raggiunto il limite di ${result.coverage.limits.max_entries} elementi o di ${formatBytes(result.coverage.limits.max_probe_bytes)} letti.`,
      evidence: recordEvidence(record),
    });
};

/** Structure, measured size, runtime candidates and coverage of the bundle. */
const desktopClaims: ReportClaimBuilder = (collector, value, record) => {
  const result = desktopApplicationSchema.parse(value);
  addBundleSize(collector, result, record);
  addBundleComponents(collector, result, record);
  addBundleFindings(collector, result, record);
};

const PRIVACY_KEYS: Readonly<Record<string, string>> = {
  NSCameraUsageDescription: "fotocamera",
  NSMicrophoneUsageDescription: "microfono",
  NSLocationUsageDescription: "posizione",
  NSLocationWhenInUseUsageDescription: "posizione durante l'uso",
  NSLocationAlwaysAndWhenInUseUsageDescription: "posizione anche in background",
  NSContactsUsageDescription: "contatti",
  NSCalendarsUsageDescription: "calendari",
  NSRemindersUsageDescription: "promemoria",
  NSPhotoLibraryUsageDescription: "libreria Foto",
  NSAppleEventsUsageDescription: "controllo di altre app (Apple Events)",
  NSBluetoothAlwaysUsageDescription: "Bluetooth",
  NSDesktopFolderUsageDescription: "cartella Scrivania",
  NSDocumentsFolderUsageDescription: "cartella Documenti",
  NSDownloadsFolderUsageDescription: "cartella Download",
  NSLocalNetworkUsageDescription: "rete locale",
  NSSpeechRecognitionUsageDescription: "riconoscimento vocale",
  NSSystemAdministrationUsageDescription: "amministrazione del sistema",
};

const objectOf = (value: JsonValue | undefined): Record<string, JsonValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : {};

/** Identity, declared requirements and declared permissions from Info.plist. */
const plistClaims: ReportClaimBuilder = (collector, value, record) => {
  const result = inspectPlistSchema.parse(value);
  const evidence = atPath(record, "Contents/Info.plist");
  const { bundle } = result;
  const info = objectOf(result.value);
  if (bundle.name !== null)
    collector.add("summary", {
      kind: "observed",
      statement: `L'app si chiama ${quoted(bundle.name)}${bundle.identifier === null ? "" : `, identificativo ${quoted(bundle.identifier)}`}.`,
      evidence,
    });
  if (bundle.short_version !== null || bundle.version !== null)
    collector.add("summary", {
      kind: "observed",
      statement: `Versione dichiarata: ${quoted(bundle.short_version ?? bundle.version ?? "")}${bundle.short_version !== null && bundle.version !== null ? ` (build ${quoted(bundle.version)})` : ""}.`,
      evidence,
    });
  if (typeof info.LSMinimumSystemVersion === "string")
    collector.add("summary", {
      kind: "observed",
      statement: `Richiede macOS ${quoted(info.LSMinimumSystemVersion)} o successivo.`,
      evidence,
    });
  for (const [key, text] of Object.entries(info))
    if (/^NS[A-Za-z]+UsageDescription$/u.test(key) && typeof text === "string")
      collector.add("security", {
        kind: "observed",
        statement: `Dichiara di poter chiedere l'accesso a ${PRIVACY_KEYS[key] ?? quoted(key)}, con la motivazione ${quoted(text)}.`,
        evidence,
      });
  for (const type of Array.isArray(info.CFBundleURLTypes)
    ? info.CFBundleURLTypes
    : [])
    for (const scheme of Array.isArray(objectOf(type).CFBundleURLSchemes)
      ? (objectOf(type).CFBundleURLSchemes as JsonValue[])
      : [])
      if (typeof scheme === "string")
        collector.add("communications", {
          kind: "observed",
          statement: `Registra lo schema URL ${quoted(`${scheme}://`)}: altre app o pagine web possono aprirla con questi indirizzi.`,
          evidence,
        });
  if (objectOf(info.NSAppTransportSecurity).NSAllowsArbitraryLoads === true)
    collector.add("security", {
      kind: "observed",
      statement:
        "Disattiva App Transport Security (NSAllowsArbitraryLoads): sono consentite connessioni HTTP non cifrate.",
      evidence,
    });
};

/** Capabilities a linked system framework suggests; never proof of use. */
const FRAMEWORK_HINTS: readonly [RegExp, string][] = [
  [/\/(?:Network|CFNetwork)\.framework\//u, "comunicare in rete"],
  [
    /\/Security\.framework\//u,
    "usare il portachiavi o funzioni crittografiche",
  ],
  [
    /\/(?:AVFoundation|CoreAudio|CoreMedia)\.framework\//u,
    "registrare o riprodurre audio e video",
  ],
  [/\/CoreLocation\.framework\//u, "leggere la posizione"],
  [/\/(?:Contacts|AddressBook)\.framework\//u, "leggere i contatti"],
  [/\/IOKit\.framework\//u, "interagire con l'hardware"],
  [/\/ScreenCaptureKit\.framework\//u, "catturare lo schermo"],
];

/** Architectures, platform and linked libraries of the main executable. */
const machoClaims: ReportClaimBuilder = (collector, value, record) => {
  const result = inspectMachoSchema.parse(value);
  const evidence = recordEvidence(record);
  const architectures = result.architectures.items.map((item) => item.name);
  if (architectures.length > 0)
    collector.add("summary", {
      kind: "observed",
      statement: `L'eseguibile principale contiene codice per ${architectures.length === 1 ? "l'architettura" : "le architetture"} ${architectures.map((name) => quoted(name)).join(", ")}.`,
      evidence,
    });
  for (const build of result.build_metadata.items)
    collector.add("summary", {
      kind: "observed",
      statement: `Compilato per ${quoted(build.platform ?? "piattaforma sconosciuta")}${build.minimum_os === null ? "" : `, sistema minimo ${quoted(build.minimum_os)}`}${build.sdk === null ? "" : `, SDK ${quoted(build.sdk)}`}.`,
      evidence,
    });
  const dependencies = result.dependencies.items;
  for (const dependency of dependencies.slice(0, MAX_LISTED)) {
    const framework = /\/([^/]+)\.framework\//u.exec(dependency.path)?.[1];
    collector.add("components", {
      kind: "observed",
      statement: dependency.path.startsWith("@")
        ? `Usa la libreria inclusa nell'app ${quoted(dependency.path)}.`
        : framework === undefined
          ? `Usa la libreria di sistema ${quoted(dependency.path)}.`
          : `Usa il framework ${quoted(framework)}.`,
      evidence,
    });
  }
  if (dependencies.length > MAX_LISTED)
    collector.add("components", {
      kind: "observed",
      statement: `Altre ${dependencies.length - MAX_LISTED} librerie collegate non sono elencate singolarmente.`,
      evidence,
    });
  for (const [pattern, capability] of FRAMEWORK_HINTS) {
    const basis = dependencies.find((dependency) =>
      pattern.test(dependency.path),
    );
    if (basis !== undefined)
      collector.add("communications", {
        kind: "hypothesis",
        statement: `Potrebbe ${capability}: collega ${quoted(basis.path)}. Il collegamento non dimostra che la funzione venga usata.`,
        evidence,
      });
  }
  if (!result.dependencies.exhaustive || !result.architectures.exhaustive)
    collector.add("limits", {
      kind: "unknown",
      statement:
        "L'elenco delle architetture o delle librerie dell'eseguibile è incompleto.",
      evidence,
    });
};

const ENTITLEMENT_NOTES: Readonly<Record<string, string>> = {
  "com.apple.security.app-sandbox": "l'app gira nella sandbox di macOS",
  "com.apple.security.network.client": "connessioni di rete in uscita",
  "com.apple.security.network.server": "connessioni di rete in entrata",
  "com.apple.security.files.user-selected.read-only":
    "lettura dei file scelti dall'utente",
  "com.apple.security.files.user-selected.read-write":
    "lettura e scrittura dei file scelti dall'utente",
  "com.apple.security.files.downloads.read-write":
    "accesso alla cartella Download",
  "com.apple.security.device.camera": "fotocamera",
  "com.apple.security.device.audio-input": "microfono",
  "com.apple.security.device.usb": "dispositivi USB",
  "com.apple.security.device.bluetooth": "Bluetooth",
  "com.apple.security.personal-information.location": "posizione",
  "com.apple.security.personal-information.addressbook": "contatti",
  "com.apple.security.personal-information.calendars": "calendari",
  "com.apple.security.automation.apple-events": "controllo di altre app",
  "com.apple.security.cs.allow-jit":
    "codice generato durante l'esecuzione (JIT)",
  "com.apple.security.cs.allow-unsigned-executable-memory":
    "memoria eseguibile non firmata",
  "com.apple.security.cs.disable-library-validation":
    "caricamento di librerie firmate da altri sviluppatori",
  "com.apple.security.cs.allow-dyld-environment-variables":
    "variabili d'ambiente che cambiano il caricamento delle librerie",
  "com.apple.security.get-task-allow": "collegamento di un debugger",
};

/** Signing identity, hardened runtime and declared entitlements. */
const signatureClaims: ReportClaimBuilder = (collector, value, record) => {
  const result = inspectSignatureSchema.parse(value);
  const evidence = recordEvidence(record);
  if (!result.signed) {
    collector.add("security", {
      kind: "observed",
      statement: "L'eseguibile principale non è firmato.",
      evidence,
    });
    return;
  }
  collector.add("security", {
    kind: "observed",
    statement: `L'eseguibile principale è firmato${result.identifier === null ? "" : ` con identificativo ${quoted(result.identifier)}`}${result.team_identifier === null ? "" : `, team ${quoted(result.team_identifier)}`}.`,
    evidence,
  });
  collector.add(
    "security",
    result.authorities.length === 0
      ? {
          kind: "derived",
          statement:
            "La firma non riporta autorità di certificazione: è una firma ad hoc, non legata a uno sviluppatore identificato.",
          evidence,
        }
      : {
          kind: "observed",
          statement: `Catena di firma dichiarata: ${result.authorities.map((authority) => quoted(authority)).join(" → ")}.`,
          evidence,
        },
  );
  if (result.hardened_runtime !== null)
    collector.add("security", {
      kind: "observed",
      statement: result.hardened_runtime
        ? "Usa l'Hardened Runtime di macOS."
        : "Non usa l'Hardened Runtime di macOS.",
      evidence,
    });
  for (const [key, setting] of Object.entries(objectOf(result.entitlements)))
    collector.add("security", {
      kind: "observed",
      statement: `Entitlement ${quoted(key)} = ${quoted(JSON.stringify(setting))}${ENTITLEMENT_NOTES[key] === undefined ? "" : ` (${ENTITLEMENT_NOTES[key]})`}.`,
      evidence,
    });
  collector.add("limits", {
    kind: "unknown",
    statement:
      "La validità della firma e della catena di fiducia non è stata verificata: InsideApp non contatta i servizi di Apple.",
    evidence,
  });
};

/** Builders for the Apple bundle lane, keyed by engine operation. */
export const appleBundleClaimBuilders: Readonly<
  Record<string, ReportClaimBuilder>
> = {
  inspect_desktop_application: desktopClaims,
  inspect_plist: plistClaims,
  inspect_macho: machoClaims,
  inspect_signature: signatureClaims,
};
