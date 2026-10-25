import { z } from "incur";
import type { Logger } from "pino";

import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import { homeDirectoryFromEnvironment } from "../config/homeDirectory.js";
import {
  guiLauncherDirectory,
  guiProjectRoot,
  openGuiLauncher,
} from "../gui/guiLauncher.js";
import { withCommandCancellation } from "./commandCancellation.js";
import type { CliInstance } from "./types.js";

/** Register `gui`: the local interface, served on 127.0.0.1 until closed. */
export const registerGuiCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<Record<string, string | undefined>>,
): void => {
  cli.command(CLI_COMMANDS.gui, {
    description:
      "Avvia l'interfaccia locale di InsideApp su 127.0.0.1; si chiude con Ctrl+C, dalla pagina o dopo un periodo di inattività",
    options: z.object({
      browser: z
        .boolean()
        .default(true)
        .describe(
          "Apre il browser predefinito; con --no-browser stampa solo il file di avvio",
        ),
      idleTimeoutMinutes: z
        .number()
        .int()
        .min(1)
        .max(240)
        .default(30)
        .describe("Minuti senza attività dopo i quali l'interfaccia si chiude"),
    }),
    run: ({ options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.gui, async () => {
          // Loaded here so the command catalog never loads the HTTP listener.
          const { startGuiServer } = await import("../gui/guiServer.js");
          const projectRoot = guiProjectRoot();
          const gui = await startGuiServer({
            projectRoot,
            launcherDirectory: guiLauncherDirectory(projectRoot),
            idleTimeoutMs: options.idleTimeoutMinutes * 60_000,
            environment,
            homeDirectory: homeDirectoryFromEnvironment(
              environment,
              process.platform,
            ),
            logger,
            signal,
          });
          // The origin and the launch file path carry no secret; the token
          // stays in the owner-only file and never reaches stdout or stderr.
          process.stderr.write(
            [
              `InsideApp: interfaccia locale avviata su ${gui.origin} (raggiungibile solo da questo computer).`,
              `InsideApp: file di avvio: ${gui.launcher.path} (vale una sola volta, per 60 secondi).`,
              `InsideApp: chiudi con Ctrl+C, con il pulsante «Chiudi InsideApp» o dopo ${options.idleTimeoutMinutes} minuti di inattività.`,
              "",
            ].join("\n"),
          );
          if (options.browser && !(await openGuiLauncher(gui.launcher.path)))
            process.stderr.write(
              "InsideApp: il browser non si è aperto da solo; apri il file di avvio indicato sopra.\n",
            );
          return { status: "stopped", reason: await gui.stopped };
        }),
      ),
  });
};
