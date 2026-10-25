import { sqliteDatabaseSchema } from "../../domain/sqlite/sqliteDatabase.js";
import {
  formatBytes,
  quoted,
  recordEvidence,
  type ReportClaimBuilder,
} from "./reportText.js";

const counted = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/** Most tables described one by one; the rest are counted. */
const MAX_LISTED = 40;

/**
 * Structure of a SQLite database. Only the schema is reported: row contents
 * may hold personal data and are never read for a report.
 */
export const sqliteDatabaseClaims: ReportClaimBuilder = (
  collector,
  value,
  record,
) => {
  const result = sqliteDatabaseSchema.parse(value);
  const evidence = recordEvidence(record);
  const { schema } = result;
  collector.add("summary", {
    kind: "observed",
    statement: `Database ${quoted(`${result.engine.name} ${result.engine.version}`)} di ${formatBytes(result.artifact.bytes)}, codifica ${quoted(result.database_encoding ?? "sconosciuta")}: ${counted(schema.tables.length, "tabella", "tabelle")}, ${counted(schema.indexes.length, "indice", "indici")}, ${counted(schema.views.length, "vista", "viste")}, ${counted(schema.triggers.length, "trigger", "trigger")}.`,
    evidence,
  });
  if (result.wal !== null)
    collector.add("data", {
      kind: "observed",
      statement:
        "Accanto al database c'è un file WAL con modifiche non ancora consolidate; è stato letto solo su una copia privata.",
      evidence,
    });
  for (const table of schema.tables.slice(0, MAX_LISTED)) {
    const columns =
      table.columns_completeness === "complete"
        ? `: ${table.columns.map((column) => `${quoted(column.name)}${column.declared_type === null || column.declared_type === "" ? "" : ` (${column.declared_type})`}${column.primary_key_position > 0 ? " chiave primaria" : ""}`).join(", ")}`
        : "";
    collector.add("data", {
      kind: "observed",
      statement: `Tabella ${quoted(table.name)} con ${table.column_count} ${table.column_count === 1 ? "colonna" : "colonne"}${columns}.`,
      evidence,
    });
  }
  if (schema.tables.length > MAX_LISTED)
    collector.add("data", {
      kind: "observed",
      statement: `Altre ${schema.tables.length - MAX_LISTED} tabelle non sono descritte singolarmente.`,
      evidence,
    });
  for (const view of schema.views)
    collector.add("data", {
      kind: "observed",
      statement: `Vista ${quoted(view.name)} (non eseguita).`,
      evidence,
    });
  for (const trigger of schema.triggers)
    collector.add("data", {
      kind: "observed",
      statement: `Trigger ${quoted(trigger.name)} sulla tabella ${quoted(trigger.table)}: esegue istruzioni automatiche quando i dati cambiano (non eseguito).`,
      evidence,
    });
  collector.add("limits", {
    kind: "unknown",
    statement:
      "Numero di righe e contenuto delle tabelle non sono stati letti, per non esporre dati personali.",
    evidence,
  });
  if (schema.completeness !== "complete")
    collector.add("limits", {
      kind: "unknown",
      statement: "La struttura del database non è stata letta per intero.",
      evidence,
    });
};
