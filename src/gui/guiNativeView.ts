import { z } from "zod";

import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import type { Evidence } from "../domain/evidence.js";
import {
  analysisStringSchema,
  parseFunctionDossier,
  parseSegments,
  type FunctionDossier,
} from "../domain/hopperValues.js";
import type { JsonValue } from "../domain/jsonValue.js";
import type { ReportClaimKind } from "../domain/report/insideAppReport.js";

/** Bounded lists keep the page responsive on large programs. */
export const NATIVE_MAX_FUNCTIONS = 5000;
export const NATIVE_MAX_STRINGS = 2000;
const MAX_ASSEMBLY_LINES = 4000;
const MAX_STRING_CHARS = 200;

/** One function in the inventory, as Ghidra's function manager reports it. */
export interface NativeFunctionEntry {
  readonly address: string;
  readonly name: string;
  readonly external: boolean;
  readonly thunk: boolean;
}

export interface NativeOverview {
  readonly name: string;
  readonly format: string;
  readonly architecture: string;
  readonly sha256: string;
  readonly segments: readonly {
    readonly name: string;
    readonly start: string;
    readonly end: string;
    readonly permissions: string;
  }[];
  readonly functions: readonly NativeFunctionEntry[];
  readonly function_count: number;
  readonly strings: readonly {
    readonly address: string;
    readonly value: string;
  }[];
  readonly string_count: number;
}

export interface NativeClaim {
  readonly kind: ReportClaimKind;
  readonly text: string;
}

export interface NativeFunctionView {
  readonly address: string;
  readonly name: string;
  readonly signature: string | null;
  readonly size_bytes: number | null;
  /** Ghidra decompiler output, or null when the decompiler produced none. */
  readonly pseudocode: string | null;
  readonly assembly: readonly string[];
  readonly assembly_truncated: boolean;
  readonly blocks: readonly {
    readonly start: string;
    readonly end: string;
    readonly successors: readonly string[];
  }[];
  readonly callees: readonly NativeFunctionEntry[];
  readonly callers: readonly NativeFunctionEntry[];
  readonly strings: readonly {
    readonly address: string;
    readonly value: string;
  }[];
  readonly incoming_references: number;
  readonly outgoing_references: number;
  readonly unresolved_calls: number;
  readonly explanation: readonly NativeClaim[];
  readonly limitations: readonly string[];
  readonly evidence_id: string;
}

const procedureListSchema = z.array(
  z.object({
    address: z.string(),
    value: z.string(),
    procedure: z
      .object({ external: z.boolean(), thunk: z.boolean() })
      .nullable()
      .optional(),
  }),
);

const clip = (text: string): string =>
  text.length > MAX_STRING_CHARS ? `${text.slice(0, MAX_STRING_CHARS)}…` : text;

/** Ghidra prefixes imported names with their library; keep the symbol readable. */
const displayName = (name: string): string => {
  const separator = name.lastIndexOf("::");
  return separator === -1 ? name : name.slice(separator + 2);
};

const permissions = (segment: {
  readonly readable: boolean | null;
  readonly writable: boolean | null;
  readonly executable: boolean | null;
}): string =>
  `${segment.readable === true ? "r" : "-"}${segment.writable === true ? "w" : "-"}${segment.executable === true ? "x" : "-"}`;

/**
 * Inventory of one opened target; the local path never leaves the process.
 * Throws when a provider result does not match its owner's schema.
 */
export const nativeOverview = (
  target: BinaryTarget,
  name: string,
  inventory: {
    readonly procedures: JsonValue;
    readonly strings: JsonValue;
    readonly segments: JsonValue;
  },
): NativeOverview => {
  const procedures = procedureListSchema.parse(inventory.procedures);
  const strings = z.array(analysisStringSchema).parse(inventory.strings);
  const parsedSegments = parseSegments(inventory.segments);
  if (!parsedSegments.ok) throw parsedSegments.error;
  const segments = parsedSegments.value;
  // Functions with a body first, in address order; imports after them.
  const functions = procedures
    .map((entry) => ({
      address: entry.address,
      name: entry.value,
      external:
        entry.procedure?.external ?? entry.address.startsWith("EXTERNAL:"),
      thunk: entry.procedure?.thunk ?? false,
    }))
    .sort((left, right) =>
      left.external === right.external
        ? left.address.localeCompare(right.address, "en", { numeric: true })
        : left.external
          ? 1
          : -1,
    );
  return {
    name,
    format: target.format,
    architecture: target.architecture ?? "sconosciuta",
    sha256: target.sha256,
    segments: segments.map((segment) => ({
      name: segment.name,
      start: segment.start,
      end: segment.end,
      permissions: permissions(segment),
    })),
    functions: functions.slice(0, NATIVE_MAX_FUNCTIONS),
    function_count: functions.length,
    strings: strings
      .slice(0, NATIVE_MAX_STRINGS)
      .map(({ address, value }) => ({ address, value: clip(value) })),
    string_count: strings.length,
  };
};

const entryOf = (
  identity: FunctionDossier["callees"][number],
): NativeFunctionEntry => ({
  address: identity.address,
  name: identity.name,
  external: identity.classification?.external ?? false,
  thunk: identity.classification?.thunk ?? false,
});

/** What a call to a well-known API suggests; a call does not prove the purpose. */
const API_HINTS: readonly [RegExp, string][] = [
  [
    /^(printf|puts|putchar|fprintf|fputs|write|WriteFile|WriteConsole[AW]?|MessageBox[AW]?|NSLog)$/u,
    "mostrare o scrivere testo",
  ],
  [
    /^(ExitProcess|exit|_exit|abort|TerminateProcess)$/u,
    "terminare il processo",
  ],
  [
    /^(strlen|strcmp|strncmp|strcpy|strncpy|strcat|memcpy|memset|memcmp|lstrlen[AW]?)$/u,
    "elaborare stringhe o memoria",
  ],
  [
    /^(socket|connect|send|recv|bind|listen|accept|WSAStartup|getaddrinfo|gethostbyname|Internet\w+|WinHttp\w+|URLDownload\w+)$/u,
    "comunicare in rete",
  ],
  [
    /^(fopen|open|read|CreateFile[AW]?|ReadFile|DeleteFile[AW]?|CopyFile[AW]?|MoveFile\w*)$/u,
    "accedere a file",
  ],
  [/^(Reg\w+)$/u, "leggere o scrivere il registro di Windows"],
  [
    /^(CreateProcess[AW]?|ShellExecute\w*|WinExec|system|execv\w*|execl\w*|posix_spawn\w*|fork)$/u,
    "avviare altri programmi",
  ],
  [
    /^(malloc|calloc|realloc|free|HeapAlloc|HeapFree|VirtualAlloc\w*|VirtualProtect\w*)$/u,
    "gestire memoria",
  ],
  [
    /^(LoadLibrary\w*|GetProcAddress|dlopen|dlsym)$/u,
    "caricare codice o funzioni a runtime",
  ],
];

const hintOf = (name: string): string | undefined =>
  API_HINTS.find(([pattern]) => pattern.test(name.replace(/^_+/u, "")))?.[1];

const hexValue = (address: string): bigint | undefined =>
  /^0x[0-9a-f]+$/iu.test(address) ? BigInt(address) : undefined;

const quoted = (text: string): string =>
  `«${clip(text).replace(/\n/gu, "\\n")}»`;

/** Italian explanation built only from the dossier's facts. */
const explanation = (
  dossier: FunctionDossier,
  instructions: number,
): readonly NativeClaim[] => {
  const claims: NativeClaim[] = [];
  const name = dossier.procedure.name;
  const body = dossier.procedure.body;
  claims.push({
    kind: "observed",
    text: `${instructions} istruzioni sono state decodificate dai byte della funzione ${name} a partire da ${dossier.procedure.address}.`,
  });
  if (body.available)
    claims.push({
      kind: "derived",
      text: `Ghidra delimita la funzione in ${body.total_bytes} byte${body.non_contiguous ? ", in più intervalli non contigui" : ""}.`,
    });
  const blocks = dossier.basic_blocks;
  if (blocks.length > 0) {
    const branches = blocks.filter(
      (block) => block.successors.length > 1,
    ).length;
    const loops = blocks.filter((block) => {
      const start = hexValue(block.start);
      return block.successors.some((successor) => {
        const target = hexValue(successor);
        return start !== undefined && target !== undefined && target <= start;
      });
    }).length;
    claims.push({
      kind: "derived",
      text: `Il flusso di controllo ricostruito ha ${blocks.length === 1 ? "un solo blocco base" : `${blocks.length} blocchi base`}, ${branches === 0 ? "nessuna diramazione condizionale" : `${branches} con una diramazione condizionale`}${loops > 0 ? ` e ${loops} con un salto all'indietro, tipico di un ciclo` : ", senza salti all'indietro"}.`,
    });
  }
  // Stubs (thunks) only jump to an imported function; count them as imports.
  const imported = (callee: FunctionDossier["callees"][number]) =>
    callee.classification?.external === true ||
    callee.classification?.thunk === true;
  const internal = dossier.callees.filter((callee) => !imported(callee));
  const external = dossier.callees.filter(imported);
  if (internal.length > 0)
    claims.push({
      kind: "derived",
      text: `Chiama ${internal.length === 1 ? "la funzione" : "le funzioni"} del programma: ${internal.map((callee) => `${callee.name} (${callee.address})`).join(", ")}.`,
    });
  if (external.length > 0)
    claims.push({
      kind: "derived",
      text: `Chiama ${external.length === 1 ? "la funzione importata" : "le funzioni importate"}, direttamente o tramite uno stub: ${external.map((callee) => displayName(callee.name)).join(", ")}.`,
    });
  if (dossier.callers.length > 0)
    claims.push({
      kind: "derived",
      text: `È chiamata da: ${dossier.callers.map((caller) => `${caller.name} (${caller.address})`).join(", ")}.`,
    });
  if (dossier.referenced_strings.length > 0)
    claims.push({
      kind: "derived",
      text: `Usa ${dossier.referenced_strings.length === 1 ? "la stringa" : "le stringhe"} ${dossier.referenced_strings.map(({ value }) => quoted(value)).join(", ")}.`,
    });
  const hints = [
    ...new Set(
      external.flatMap((callee) => {
        const hint = hintOf(displayName(callee.name));
        return hint === undefined
          ? []
          : [`${hint} (${displayName(callee.name)})`];
      }),
    ),
  ];
  if (hints.length > 0)
    claims.push({
      kind: "hypothesis",
      text: `Dalle funzioni importate che chiama, potrebbe ${hints.join("; ")}. Una chiamata non dimostra lo scopo né che venga eseguita.`,
    });
  const unresolved = dossier.unresolved_calls?.length ?? 0;
  if (unresolved > 0)
    claims.push({
      kind: "unknown",
      text: `${unresolved} ${unresolved === 1 ? "chiamata indiretta non ha" : "chiamate indirette non hanno"} una destinazione determinabile staticamente.`,
    });
  claims.push({
    kind: "unknown",
    text: "I valori effettivi a runtime (argomenti, dati letti, risultati) e il comportamento in esecuzione non sono determinabili con l'analisi statica: il programma non è stato eseguito.",
  });
  return claims;
};

/** Path-free view of one analyze_function Evidence; throws on an invalid dossier. */
export const nativeFunctionView = (evidence: Evidence): NativeFunctionView => {
  const parsed = parseFunctionDossier(evidence.normalized_result);
  if (!parsed.ok) throw parsed.error;
  const dossier = parsed.value;
  const body = dossier.procedure.body;
  const pseudocodeAvailable =
    dossier.facet_availability?.pseudocode?.available !== false &&
    dossier.pseudocode.trim() !== "";
  return {
    address: dossier.procedure.address,
    name: dossier.procedure.name,
    signature: dossier.procedure.signature,
    size_bytes: body.available ? body.total_bytes : null,
    pseudocode: pseudocodeAvailable ? dossier.pseudocode.trim() : null,
    assembly: dossier.assembly.slice(0, MAX_ASSEMBLY_LINES),
    assembly_truncated: dossier.assembly.length > MAX_ASSEMBLY_LINES,
    blocks: dossier.basic_blocks,
    callees: dossier.callees.map(entryOf),
    callers: dossier.callers.map(entryOf),
    strings: dossier.referenced_strings.map(({ address, value }) => ({
      address,
      value: clip(value),
    })),
    incoming_references: dossier.incoming_references.length,
    outgoing_references: dossier.outgoing_references.length,
    unresolved_calls: dossier.unresolved_calls?.length ?? 0,
    explanation: explanation(dossier, dossier.assembly.length),
    limitations: dossier.limitations,
    evidence_id: evidence.evidence_id,
  };
};
