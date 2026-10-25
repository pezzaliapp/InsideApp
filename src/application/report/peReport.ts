import { managedArtifactInspectionSchema } from "../../domain/managed/managedArtifact.js";
import { nativeExportsSchema } from "../../domain/native/nativeExports.js";
import { peCertificatesSchema } from "../../domain/native/peCertificates.js";
import { peImportsSchema } from "../../domain/native/peImports.js";
import { peResourcesSchema } from "../../domain/native/peResources.js";
import {
  quoted,
  recordEvidence,
  type ReportClaimBuilder,
} from "./reportText.js";

/** Most rows listed one by one; the rest are counted. */
const MAX_LISTED = 40;

/** IMAGE_FILE_DLL in the COFF characteristics. */
const IMAGE_FILE_DLL = 0x2000;

/** Header facts and .NET classification of a PE image. */
const managedClaims: ReportClaimBuilder = (collector, value, record) => {
  const result = managedArtifactInspectionSchema.parse(value);
  const evidence = recordEvidence(record);
  const { pe, classification } = result;
  collector.add("summary", {
    kind: "observed",
    statement: `File PE ${pe.optional_header === "pe32-plus" ? "a 64 bit (PE32+)" : "a 32 bit (PE32)"} per l'architettura ${quoted(pe.architecture)}, con ${pe.section_count} ${pe.section_count === 1 ? "sezione" : "sezioni"}.`,
    evidence,
  });
  collector.add("summary", {
    kind: "observed",
    statement:
      (pe.characteristics & IMAGE_FILE_DLL) !== 0
        ? "È una libreria (DLL): il codice viene caricato da altri programmi."
        : "È un programma eseguibile (non una DLL).",
    evidence,
  });
  if (classification.status === "managed") {
    collector.add("summary", {
      kind: "observed",
      statement: `Contiene codice .NET${result.assembly === null ? "" : `: assembly ${quoted(result.assembly.name)} versione ${quoted(result.assembly.version)}`}${result.target_frameworks.length === 0 ? "" : `, per ${result.target_frameworks.map((name) => quoted(name)).join(", ")}`}.`,
      evidence,
    });
    for (const reference of result.references.slice(0, MAX_LISTED))
      collector.add("components", {
        kind: "observed",
        statement: `Usa l'assembly .NET ${quoted(reference.name)} versione ${quoted(reference.version)}.`,
        evidence,
      });
  } else if (classification.status === "not-managed")
    collector.add("summary", {
      kind: "observed",
      statement: "Non contiene metadati .NET: è codice nativo.",
      evidence,
    });
  collector.add("limits", {
    kind: "unknown",
    statement:
      "Nomi, dimensioni e permessi delle singole sezioni non sono riportati da questa versione del motore.",
    evidence,
  });
};

/**
 * Imports that suggest a capability. They show what the program may call,
 * never that it does: they are always hypotheses.
 */
const CAPABILITY_HINTS: readonly {
  readonly capability: string;
  readonly dll?: RegExp;
  readonly fn?: RegExp;
}[] = [
  {
    capability: "comunicare in rete",
    dll: /^(?:ws2_32|wsock32|wininet|winhttp|urlmon|dnsapi|iphlpapi)\.dll$/iu,
  },
  {
    capability: "modificare il registro di Windows",
    fn: /^Reg(?:SetValue|CreateKey|DeleteKey|DeleteValue)/u,
  },
  {
    capability: "avviare altri programmi",
    fn: /^(?:CreateProcess|ShellExecute|WinExec)/u,
  },
  {
    capability: "intervenire sulla memoria di altri processi",
    fn: /^(?:WriteProcessMemory|CreateRemoteThread|VirtualAllocEx|OpenProcess)$/u,
  },
  {
    capability: "creare, modificare o cancellare file",
    fn: /^(?:CreateFile|WriteFile|DeleteFile|MoveFile|CopyFile)/u,
  },
  {
    capability: "usare funzioni crittografiche",
    dll: /^(?:bcrypt|crypt32|ncrypt)\.dll$/iu,
  },
  {
    capability: "installare o gestire servizi di Windows",
    fn: /^(?:OpenSCManager|CreateService)/u,
  },
  {
    capability: "caricare altro codice durante l'esecuzione",
    fn: /^(?:LoadLibrary|GetProcAddress)/u,
  },
];

/** Imported DLLs and the capabilities they suggest. */
const importClaims: ReportClaimBuilder = (collector, value, record) => {
  const result = peImportsSchema.parse(value);
  const evidence = recordEvidence(record);
  const tables = [...result.imports, ...result.delay_imports];
  for (const dll of tables.slice(0, MAX_LISTED))
    collector.add("components", {
      kind: "observed",
      statement: `Importa ${dll.functions.length} ${dll.functions.length === 1 ? "funzione" : "funzioni"} da ${quoted(dll.name ?? "DLL senza nome")}${result.delay_imports.includes(dll as never) ? " (caricamento ritardato)" : ""}.`,
      evidence,
    });
  if (tables.length > MAX_LISTED)
    collector.add("components", {
      kind: "observed",
      statement: `Altre ${tables.length - MAX_LISTED} DLL importate non sono elencate singolarmente.`,
      evidence,
    });
  for (const hint of CAPABILITY_HINTS) {
    let basis: string | undefined;
    for (const dll of tables) {
      if (
        hint.dll !== undefined &&
        dll.name !== null &&
        hint.dll.test(dll.name)
      )
        basis = dll.name;
      const fn =
        hint.fn === undefined
          ? undefined
          : dll.functions.find(
              (item) => item.name !== null && hint.fn!.test(item.name),
            );
      if (fn?.name != null)
        basis = `${fn.name} da ${dll.name ?? "DLL senza nome"}`;
      if (basis !== undefined) break;
    }
    if (basis !== undefined)
      collector.add("communications", {
        kind: "hypothesis",
        statement: `Potrebbe ${hint.capability}: importa ${quoted(basis)}. Un'importazione non dimostra che la funzione venga usata.`,
        evidence,
      });
  }
  if (result.coverage.status !== "complete")
    collector.add("limits", {
      kind: "unknown",
      statement: "La tabella delle importazioni non è stata letta per intero.",
      evidence,
    });
};

/** Resource kinds by standard type id (RT_*). */
const RESOURCE_TYPES: Readonly<Record<number, string>> = {
  3: "icone",
  14: "gruppi di icone",
  4: "menu",
  5: "finestre di dialogo",
  6: "tabelle di testi",
  16: "informazioni di versione",
  24: "manifest",
  10: "dati personalizzati (RCDATA)",
};

const resourceClaims: ReportClaimBuilder = (collector, value, record) => {
  const result = peResourcesSchema.parse(value);
  const counts = new Map<string, number>();
  for (const resource of result.resources) {
    const label =
      resource.type.kind === "id"
        ? (RESOURCE_TYPES[resource.type.id] ?? `tipo ${resource.type.id}`)
        : `tipo ${resource.type.name}`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  if (counts.size > 0)
    collector.add("components", {
      kind: "observed",
      statement: `Risorse incluse: ${[...counts].map(([label, count]) => `${label} (${count})`).join(", ")}. Il loro contenuto non è decodificato.`,
      evidence: recordEvidence(record),
    });
};

const certificateClaims: ReportClaimBuilder = (collector, value, record) => {
  const result = peCertificatesSchema.parse(value);
  const evidence = recordEvidence(record);
  if (result.table === null) {
    collector.add("security", {
      kind: "observed",
      statement: "Il file non contiene una firma Authenticode incorporata.",
      evidence,
    });
    collector.add("limits", {
      kind: "unknown",
      statement:
        "Una firma tramite catalogo di Windows non è verificabile da questo file da solo.",
      evidence,
    });
    return;
  }
  for (const entry of result.entries)
    collector.add("security", {
      kind: "observed",
      statement: `Contiene una firma ${quoted(entry.certificate_type_name)}${entry.pkcs7?.signers[0]?.issuer == null ? "" : ` emessa da ${quoted(entry.pkcs7.signers[0].issuer.text)}`}.`,
      evidence,
    });
  collector.add("limits", {
    kind: "unknown",
    statement:
      "Validità della firma, catena dei certificati e marca temporale non sono state verificate.",
    evidence,
  });
};

const exportClaims: ReportClaimBuilder = (collector, value, record) => {
  const result = nativeExportsSchema.parse(value);
  if (result.format !== "pe") return;
  const evidence = recordEvidence(record);
  for (const row of result.exports.slice(0, MAX_LISTED))
    collector.add("components", {
      kind: "observed",
      statement: `Esporta ${row.name === null ? `l'ordinale ${row.ordinal}` : `la funzione ${quoted(row.name)}`}${row.forwarder === null ? "" : `, inoltrata a ${quoted(row.forwarder)}`}.`,
      evidence,
    });
  if (result.exports.length > MAX_LISTED)
    collector.add("components", {
      kind: "observed",
      statement: `Altre ${result.exports.length - MAX_LISTED} funzioni esportate non sono elencate singolarmente.`,
      evidence,
    });
};

/** Builders for PE supplements, keyed by engine operation. */
export const peClaimBuilders: Readonly<Record<string, ReportClaimBuilder>> = {
  inspect_managed_artifact: managedClaims,
  inspect_pe_imports: importClaims,
  inspect_pe_resources: resourceClaims,
  inspect_pe_certificates: certificateClaims,
  inspect_native_exports: exportClaims,
};
