import {
  createReportInputSchema,
  insideAppReportSchema,
} from "../domain/report/insideAppReport.js";
import type { ToolContract } from "./toolContractTypes.js";
import { toolContractMetadata } from "./toolEffects.js";
import { evidenceResultOf } from "./toolOutputSchemaPrimitives.js";

/** InsideApp's reader report, shared with the CLI `report` command and the GUI. */
export const REPORT_TOOL_CONTRACTS = [
  {
    name: "create_report",
    ...toolContractMetadata("create_report"),
    kind: "application",
    description:
      "Build an Italian InsideApp report for one application, file or folder the user owns or is authorized to analyze. Ask the user first and pass authorized: true only after they confirm; false is refused before anything is read. Static analysis only: the target is never executed, and nothing is sent to external services. Lanes follow the item: JavaScript/Electron folders and .asar files (complete application analysis), macOS .app bundles (structure, measured size, Info.plist, executable, signature and entitlements), Windows .exe/.dll (headers, imports, resources, Authenticode presence, exports; capabilities suggested by imports are hypotheses), SQLite databases (schema only: rows are never read) and other files (format and contents). Disk roots, first-level folders and the home folder are refused. Returns derived Evidence whose result is the report: sections In breve, Componenti, Comunicazioni, Dati e file, Sicurezza and Limiti e sconosciuti, each claim classified as observed (Osservato), derived (Derivato), hypothesis (Ipotesi) or unknown (Sconosciuto) with its proof reference, plus the source Evidence IDs. The report omits the local path. It is the same report the CLI `report` command and the InsideApp GUI produce.",
    inputSchema: createReportInputSchema,
    outputSchema: evidenceResultOf(insideAppReportSchema),
    examples: [
      {
        title: "Report on an Electron application the user owns",
        input: { path: "/Users/me/Projects/MyApp", authorized: true },
      },
      {
        title: "Report on a macOS application bundle",
        input: { path: "/Applications/MyTool.app", authorized: true },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
