import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { REPORT_ROUTES } from "../application/report/generateReport.js";
import { PRODUCT_IDENTITY } from "../identity.js";

/** Engine facts shown on the start page; nothing here reads caller-selected paths. */
export interface GuiEngineStatus {
  readonly product: string;
  readonly version: string;
  readonly node: string;
  readonly platform: string;
  readonly analysis: {
    readonly local_only: true;
    readonly executes_targets: false;
    readonly report_routes: readonly string[];
    readonly gui_analysis_available: false;
  };
  readonly claude: {
    readonly mcp_tools: number;
    readonly project_mcp_server: "configured" | "missing" | "invalid";
  };
}

/** Whether `.mcp.json` declares the project launcher, without changing it. */
const projectMcpServer = async (
  projectRoot: string,
): Promise<GuiEngineStatus["claude"]["project_mcp_server"]> => {
  let text: string;
  try {
    text = await readFile(join(projectRoot, ".mcp.json"), "utf8");
  } catch {
    return "missing";
  }
  try {
    const parsed: unknown = JSON.parse(text);
    const server =
      typeof parsed === "object" && parsed !== null && "mcpServers" in parsed
        ? (parsed.mcpServers as Record<string, unknown> | null)?.insideapp
        : undefined;
    return typeof server === "object" &&
      server !== null &&
      "command" in server &&
      server.command === "./scripts/insideapp.sh"
      ? "configured"
      : "invalid";
  } catch {
    return "invalid";
  }
};

export const guiEngineStatus = async (
  projectRoot: string,
): Promise<GuiEngineStatus> => {
  const { TOOL_CONTRACTS } = await import("../contracts/toolContracts.js");
  return {
    product: "InsideApp — PezzaliAPP",
    version: PRODUCT_IDENTITY.packageVersion,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    analysis: {
      local_only: true,
      executes_targets: false,
      report_routes: REPORT_ROUTES,
      gui_analysis_available: false,
    },
    claude: {
      mcp_tools: TOOL_CONTRACTS.length,
      project_mcp_server: await projectMcpServer(projectRoot),
    },
  };
};
