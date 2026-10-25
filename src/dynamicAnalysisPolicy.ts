import {
  CLI_COMMAND_NAMES,
  CLI_COMMAND_TOOL_ALIASES,
} from "./cliCommandNames.js";

/**
 * Operations that run or instrument software, drive a debugger or change an
 * attached device: everything whose effects include `executesForeignCode` or
 * `mutatesDevice`, plus Frida sessions and page instrumentation, which attach
 * to running code. The authorization to analyze a file statically does not
 * cover them, so InsideApp refuses them unless the user started it with
 * {@link DYNAMIC_ANALYSIS_ENVIRONMENT}=1. Reports and the GUI never use them.
 */
export const DYNAMIC_ANALYSIS_TOOLS: ReadonlySet<string> = new Set([
  // Debuggers and reverse-engineering consoles.
  "cutter_command",
  "execute_rizin_command",
  "start_rizin_debug_session",
  "rizin_debug_command",
  "close_rizin_debug_session",
  "gdb_console",
  "close_gdb_session",
  // Frida instrumentation.
  "instrument_with_frida",
  "start_frida_session",
  "load_frida_script",
  "resume_frida_session",
  "unload_frida_script",
  "close_frida_session",
  // Programs, apps, browsers and pages run or driven by a scenario.
  "capture_process_scenario",
  "capture_electron_scenario",
  "capture_browser_scenario",
  "capture_native_ui_scenario",
  "observe_native_calls",
  "observe_web_execution",
  // Android devices.
  "push_adb_file",
  "install_adb_package",
  "uninstall_adb_package",
  "start_adb_app",
  "start_adb_activity",
  "stop_adb_app",
]);

/** Set to `1` when starting InsideApp to allow {@link DYNAMIC_ANALYSIS_TOOLS}. */
export const DYNAMIC_ANALYSIS_ENVIRONMENT = "INSIDEAPP_ALLOW_DYNAMIC_ANALYSIS";

/** Read once from the environment the user started InsideApp with. */
export const dynamicAnalysisAllowed = (
  environment: Readonly<Record<string, string | undefined>>,
): boolean => environment[DYNAMIC_ANALYSIS_ENVIRONMENT] === "1";

/** CLI commands that reach a dynamic operation, by name or by alias. */
export const DYNAMIC_ANALYSIS_CLI_COMMANDS: ReadonlySet<string> = new Set([
  ...CLI_COMMAND_NAMES.filter((name) =>
    DYNAMIC_ANALYSIS_TOOLS.has(name.replaceAll("-", "_")),
  ),
  ...Object.entries(CLI_COMMAND_TOOL_ALIASES)
    .filter(([, tools]) =>
      tools.some((tool) => DYNAMIC_ANALYSIS_TOOLS.has(tool)),
    )
    .map(([name]) => name),
]);

/** Why a dynamic operation was refused, and how the user can allow it. */
export const dynamicAnalysisRefusalMessage = (operation: string): string =>
  `InsideApp: '${operation}' è un'analisi dinamica: può avviare o strumentare programmi, usare un debugger o modificare un dispositivo, e può usare la rete. Non è coperta dalla dichiarazione di autorizzazione all'analisi statica ed è disattivata. Se il software e il dispositivo sono tuoi o sei autorizzato, usala in un ambiente isolato avviando InsideApp con ${DYNAMIC_ANALYSIS_ENVIRONMENT}=1 (vedi AVVERTENZE.md).`;
