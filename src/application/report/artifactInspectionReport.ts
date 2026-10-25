import type { ArtifactInspectionResult } from "../../domain/artifactInspection.js";
import {
  ReportClaimCollector,
  type ReportEvidenceReference,
  type ReportSection,
} from "../../domain/report/insideAppReport.js";
import { quoted, type RecordContext } from "./reportText.js";

type Inventory =
  ArtifactInspectionResult["substeps"][number]["evidence"]["normalized_result"];
type ArtifactKind = Inventory["occurrences"][number]["artifact_kind"];

/** Reader nouns for inventory entries worth listing; others are only counted. */
const LISTED_KINDS: Readonly<Partial<Record<ArtifactKind, string>>> = {
  executable: "Eseguibile",
  "dynamic-library": "Libreria dinamica",
  framework: "Framework",
  "native-addon": "Modulo nativo (addon)",
  entitlements: "Entitlement (permessi dichiarati)",
  "package-metadata": "Metadati del pacchetto",
  "universal-slice": "Architettura in un binario universale",
};

/** Largest number of inventory entries listed individually in one report. */
const MAX_LISTED_ENTRIES = 40;

const KNOWN_HYPOTHESES: Readonly<Record<string, string>> = {
  "The PE artifact may contain managed CLI metadata or native code; inventory bytes alone do not distinguish them.":
    "Il file PE può contenere codice .NET (metadati CLI) o codice nativo: i soli byte dell'inventario non permettono di distinguerli.",
  "The artifact may contain a recoverable JavaScript application graph.":
    "Il file può contenere un'applicazione JavaScript ricostruibile.",
};

const UNEXPLORED_REASONS: Readonly<
  Record<
    ArtifactInspectionResult["unexplored_branches"][number]["reason"],
    string
  >
> = {
  "format-specific-analysis-required":
    "Serve un'analisi specifica per questo formato",
  "unknown-format": "Formato non riconosciuto",
};

const inventoryEvidence = (
  inventoryEvidenceId: string,
  path: string | null,
  sha256: string | null,
  assessment: string,
): ReportEvidenceReference => ({
  evidence_id: inventoryEvidenceId,
  path,
  position: null,
  sha256,
  method: "inventory_artifact",
  engine_assessment: assessment,
  additional_occurrences: 0,
});

const formatBytes = (bytes: number): string =>
  `${String(bytes).replace(/\B(?=(\d{3})+(?!\d))/gu, ".")} byte`;

const addInventoryFacts = (
  inventory: Inventory,
  evidenceId: string,
  collector: ReportClaimCollector,
): void => {
  const { manifest } = inventory;
  const digests = new Map(
    inventory.nodes.map((node) => [node.artifact_id, node.sha256] as const),
  );
  const root = inventory.nodes.find(
    (node) => node.artifact_id === manifest.root_artifact_id,
  );
  const rootEvidence = inventoryEvidence(
    evidenceId,
    null,
    manifest.root_sha256,
    "observed/artifact-bytes",
  );
  collector.add("summary", {
    kind: "observed",
    statement: `Formato riconosciuto: ${quoted(manifest.root_format)}${root === undefined ? "" : `, dimensione ${formatBytes(root.size)}`}.`,
    evidence: rootEvidence,
  });
  collector.add("summary", {
    kind: "observed",
    statement: `L'inventario contiene ${manifest.occurrence_count} ${manifest.occurrence_count === 1 ? "elemento" : "elementi"}${manifest.node_count === manifest.occurrence_count ? "" : ` (${manifest.node_count} contenuti distinti)`}.`,
    evidence: rootEvidence,
  });

  let listed = 0;
  for (const occurrence of inventory.occurrences) {
    const evidence = inventoryEvidence(
      evidenceId,
      occurrence.logical_path,
      occurrence.artifact_id === null
        ? null
        : (digests.get(occurrence.artifact_id) ?? null),
      "observed/artifact-bytes",
    );
    if (occurrence.encrypted)
      collector.add("security", {
        kind: "observed",
        statement: `${quoted(occurrence.logical_path)} è cifrato: il contenuto non è leggibile senza la chiave.`,
        evidence,
      });
    const noun = LISTED_KINDS[occurrence.artifact_kind];
    if (noun === undefined) continue;
    listed += 1;
    if (listed <= MAX_LISTED_ENTRIES)
      collector.add("components", {
        kind: "observed",
        statement: `${noun}: ${occurrence.logical_path === "." ? "il file analizzato" : quoted(occurrence.logical_path)} (formato ${quoted(occurrence.artifact_format)}).`,
        evidence,
      });
  }
  if (listed > MAX_LISTED_ENTRIES)
    collector.add("components", {
      kind: "observed",
      statement: `Altri ${listed - MAX_LISTED_ENTRIES} componenti dello stesso tipo non sono elencati singolarmente in questo rapporto.`,
      evidence: rootEvidence,
    });
};

const addInspectionFindings = (
  result: ArtifactInspectionResult,
  inventory: Inventory,
  record: RecordContext,
  collector: ReportClaimCollector,
): void => {
  const rootSha256 = inventory.manifest.root_sha256;
  for (const hypothesis of result.hypotheses)
    collector.add("summary", {
      kind: "hypothesis",
      statement: KNOWN_HYPOTHESES[hypothesis.statement] ?? hypothesis.statement,
      evidence: inventoryEvidence(
        hypothesis.basis_evidence_ids[0]!,
        null,
        rootSha256,
        `hypothesis/${hypothesis.confidence}`,
      ),
    });
  for (const contradiction of result.contradictions)
    collector.add("security", {
      kind: "observed",
      statement: `L'integrità dichiarata per un elemento non corrisponde ai byte letti (${contradiction.statement}).`,
      evidence: inventoryEvidence(
        contradiction.evidence_id,
        null,
        null,
        "observed/integrity-contradiction",
      ),
    });
  for (const branch of result.unexplored_branches)
    collector.add("limits", {
      kind: "unknown",
      statement: `${UNEXPLORED_REASONS[branch.reason]}${branch.next_probe === null ? "" : `; passo successivo suggerito: ${quoted(branch.next_probe.operation)}`}.`,
      evidence: inventoryEvidence(
        branch.evidence_id,
        null,
        rootSha256,
        `unknown/${branch.reason}`,
      ),
    });
  if (
    inventory.coverage.status !== "complete" ||
    result.coverage.status !== "complete-within-substeps"
  )
    collector.add("limits", {
      kind: "unknown",
      statement:
        "L'inventario non è completo: alcune parti del file non sono state esaminate.",
      evidence: inventoryEvidence(
        record.evidenceId,
        null,
        rootSha256,
        `unknown/${inventory.coverage.status}`,
      ),
    });
};

/** Build report sections from one validated provider-neutral inspection. */
export const artifactInspectionReportSections = (
  result: ArtifactInspectionResult,
  record: RecordContext,
): readonly ReportSection[] => {
  const collector = new ReportClaimCollector();
  const substep = result.substeps[0]!;
  const inventory = substep.evidence.normalized_result;
  addInventoryFacts(inventory, substep.evidence_id, collector);
  addInspectionFindings(result, inventory, record, collector);
  return collector.sections();
};
