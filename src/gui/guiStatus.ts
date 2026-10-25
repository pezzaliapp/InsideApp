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
    /**
     * Windows only: the verified native controls that protect private copies
     * of JavaScript applications and SQLite databases. Without them those
     * analyses stop; executables, archives and other files still work.
     */
    readonly windows_native_controls:
      | "not_required"
      | "available"
      | "missing"
      | "refused";
  };
  readonly claude: {
    readonly mcp_tools: number;
    /** `unsupported_host`: the project launcher in .mcp.json is a POSIX script. */
    readonly project_mcp_server:
      | "configured"
      | "missing"
      | "invalid"
      | "unsupported_host";
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

/** Readiness of the Windows native controls, without exposing their diagnostics. */
const windowsNativeControls = async (): Promise<
  GuiEngineStatus["analysis"]["windows_native_controls"]
> => {
  if (process.platform !== "win32") return "not_required";
  const { systemWindowsNativeAuthority } =
    await import("../windows/WindowsNativeLoader.js");
  const loaded = systemWindowsNativeAuthority();
  if (loaded.available) return "available";
  return loaded.failureStage === "artifact" ? "missing" : "refused";
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
      windows_native_controls: await windowsNativeControls(),
    },
    claude: {
      mcp_tools: TOOL_CONTRACTS.length,
      project_mcp_server:
        process.platform === "win32"
          ? "unsupported_host"
          : await projectMcpServer(projectRoot),
    },
  };
};
