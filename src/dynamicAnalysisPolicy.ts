import {
  CLI_COMMAND_NAMES,
  CLI_COMMAND_TOOL_ALIASES,
} from "./cliCommandNames.js";

/**
 * Operations that run, instrument or observe live software or devices:
 * everything whose effects include `executesForeignCode` or `mutatesDevice`,
 * Frida and debugger sessions, and passive observation of running processes,
 * pages, screens, logs, files or data on attached devices. The authorization
 * to analyze a file statically does not cover them, so InsideApp refuses them
 * unless the user started it with {@link DYNAMIC_ANALYSIS_ENVIRONMENT}=1.
 * Reports and the GUI never use them.
 */
export const DYNAMIC_ANALYSIS_TOOLS: ReadonlySet<string> = new Set([
  // Debuggers and reverse-engineering consoles.
  "cutter_command",
  "start_gdb_session",
  "gdb_session_status",
  "rizin_debug_session_status",
  "execute_rizin_command",
  "start_rizin_debug_session",
  "rizin_debug_command",
  "close_rizin_debug_session",
  "gdb_console",
  "close_gdb_session",
  // Frida instrumentation and discovery of devices and processes.
  "list_frida_devices",
  "list_frida_processes",
  "frida_session_status",
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
  // Running apps, pages and runtimes observed in place: UI, V8 Inspector, CDP.
  "observe_native_ui",
  "list_javascript_runtime_targets",
  "observe_javascript_runtime",
  "list_electron_targets",
  "inspect_electron_page",
  "list_browser_targets",
  "inspect_web_page",
  "analyze_web_bundle",
  "observe_web_session",
  "discover_webmcp_tools",
  "capture_web_screenshot",
  "inspect_web_event_listeners",
  // Android devices: every operation that contacts a device.
  "list_adb_devices",
  "inspect_adb_device",
  "list_adb_packages",
  "resolve_adb_packages",
  "inspect_adb_package",
  "pull_adb_package",
  "pull_adb_file",
  "read_adb_logcat",
  "capture_adb_screen",
  "list_adb_processes",
  "list_adb_directory",
  "list_adb_features",
  "list_adb_services",
  "inspect_adb_display",
  "inspect_adb_window",
  "read_adb_setting",
  "collect_adb_bugreport",
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
  `InsideApp: '${operation}' è un'analisi dinamica: può avviare, strumentare o osservare programmi e pagine in esecuzione, leggerne dati, log o schermate, usare un debugger o accedere a un dispositivo collegato, e può usare la rete. Non è coperta dalla dichiarazione di autorizzazione all'analisi statica ed è disattivata. Se il software e il dispositivo sono tuoi o sei autorizzato, usala in un ambiente isolato avviando InsideApp con ${DYNAMIC_ANALYSIS_ENVIRONMENT}=1 (vedi AVVERTENZE.md).`;
