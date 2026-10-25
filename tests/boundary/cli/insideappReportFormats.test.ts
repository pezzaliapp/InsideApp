import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { peImportImage } from "../../fixtures/binaryDiagnostics/peImports.js";
import {
  createIsolatedHost,
  expectNoHostSideEffects,
  runLauncher,
} from "../../fixtures/insideappHost.js";

const execute = promisify(execFile);
const TIMEOUT_MS = 180_000;
const COMPILER = "/usr/bin/cc";

const outputSchema = z.object({
  report: z.object({ operation: z.string() }),
  files: z.object({ markdown: z.string() }),
});

type Host = Awaited<ReturnType<typeof createIsolatedHost>>;

/** Run `report` like a user and return the Markdown, failing loudly on errors. */
const report = async (host: Host, target: string) => {
  const result = await runLauncher(host, [
    "report",
    target,
    "--authorized",
    "--only",
    "markdown",
    "--output-dir",
    join(host.home, "..", "tmp", "rapporti"),
    "--json",
  ]);
  expect(result.exitCode, `${result.stdout}${result.stderr}`).toBe(0);
  const output = outputSchema.parse(JSON.parse(result.stdout));
  return {
    operation: output.report.operation,
    markdown: await readFile(output.files.markdown, "utf8"),
  };
};

/** A claim line as the Markdown renderer writes it, with its escapes. */
const claim = (kind: string, text: string) =>
  `- **${kind}** — ${text.replace(/[\\`*_[\]<>|~&]/gu, (character) => `\\${character}`)}`;

describe("InsideApp reports for macOS app bundles", () => {
  it.skipIf(process.platform !== "darwin" || !existsSync(COMPILER))(
    "reads structure, measured size, Info.plist, executable and signature (requires macOS and cc)",
    async () => {
      const host = await createIsolatedHost();
      const bundle = join(host.home, "..", "tmp", "Demo.app");
      await mkdir(join(bundle, "Contents", "MacOS"), { recursive: true });
      await mkdir(join(bundle, "Contents", "Resources"));
      const source = join(host.home, "..", "tmp", "demo.c");
      await writeFile(source, "int main(void) { return 0; }\n");
      await execute(COMPILER, [
        "-o",
        join(bundle, "Contents", "MacOS", "Demo"),
        source,
      ]);
      await writeFile(
        join(bundle, "Contents", "Info.plist"),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Demo</string>
<key>CFBundleIdentifier</key><string>app.pezzali.demo</string>
<key>CFBundleName</key><string>Demo</string>
<key>CFBundleShortVersionString</key><string>1.2</string>
<key>CFBundleVersion</key><string>42</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSCameraUsageDescription</key><string>Per le videochiamate</string>
<key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>demo</string></array></dict></array>
</dict></plist>
`,
      );
      await writeFile(
        join(bundle, "Contents", "Resources", "note.txt"),
        "risorsa\n",
      );
      const sizes = await Promise.all(
        [
          "Contents/Info.plist",
          "Contents/MacOS/Demo",
          "Contents/Resources/note.txt",
        ].map(async (path) => (await stat(join(bundle, path))).size),
      );
      const total = sizes.reduce((sum, size) => sum + size, 0);

      const { operation, markdown } = await report(host, bundle);
      expect(operation).toBe("inspect_desktop_application");
      expect(markdown).toMatch(
        /- \*\*Analisi aggiuntive:\*\* `inspect_plist` \(Evidence `ev_[a-f0-9]{64}`\), `inspect_macho` \(Evidence `ev_[a-f0-9]{64}`\), `inspect_signature` \(Evidence `ev_[a-f0-9]{64}`\)/u,
      );
      expect(markdown).toContain(
        claim(
          "Osservato",
          `Dimensione misurata dei file: ${String(total).replace(/\B(?=(\d{3})+(?!\d))/gu, ".")} byte.`,
        ),
      );
      expect(markdown).not.toMatch(/\b0 byte\b/u);
      for (const text of [
        "L'app si chiama «Demo», identificativo «app.pezzali.demo».",
        "Versione dichiarata: «1.2» (build «42»).",
        "Richiede macOS «13.0» o successivo.",
        "Eseguibile: «Contents/MacOS/Demo»",
        "Usa la libreria di sistema «/usr/lib/libSystem.B.dylib».",
      ])
        expect(markdown).toContain(`${claim("Osservato", text)}`);
      expect(markdown).toContain(
        claim(
          "Osservato",
          "Dichiara di poter chiedere l'accesso a fotocamera, con la motivazione «Per le videochiamate».",
        ),
      );
      expect(markdown).toContain(
        claim(
          "Osservato",
          "Registra lo schema URL «demo://»: altre app o pagine web possono aprirla con questi indirizzi.",
        ),
      );
      expect(markdown).toMatch(
        /- \*\*Osservato\*\* — L'eseguibile principale contiene codice per l'architettura «(?:arm64|x86\\_64)»\./u,
      );
      if (process.arch === "arm64")
        expect(markdown).toContain(
          claim(
            "Derivato",
            "La firma non riporta autorità di certificazione: è una firma ad hoc, non legata a uno sviluppatore identificato.",
          ),
        );
      expect(markdown).toContain(
        claim(
          "Sconosciuto",
          "La validità della firma e della catena di fiducia non è stata verificata: InsideApp non contatta i servizi di Apple.",
        ),
      );
      await expectNoHostSideEffects(host);
    },
    TIMEOUT_MS,
  );
});

describe("InsideApp reports for Windows executables", () => {
  it(
    "reads headers, imports, resources and signature and states potential behavior as hypotheses",
    async () => {
      const host = await createIsolatedHost();
      const image = peImportImage({
        dlls: [
          { name: "WS2_32.dll", functions: [{ name: "connect", hint: 1 }] },
          {
            name: "ADVAPI32.dll",
            functions: [{ name: "RegSetValueExW", hint: 2 }],
          },
          {
            name: "KERNEL32.dll",
            functions: [
              { name: "CreateProcessW", hint: 3 },
              { name: "LoadLibraryW", hint: 4 },
            ],
          },
        ],
      });
      const exe = join(host.home, "..", "tmp", "tool.exe");
      await writeFile(exe, image);
      const { operation, markdown } = await report(host, exe);
      expect(operation).toBe("inspect_artifact");
      for (const supplement of [
        "inspect_managed_artifact",
        "inspect_pe_imports",
        "inspect_pe_resources",
        "inspect_pe_certificates",
        "inspect_native_exports",
      ])
        expect(markdown).toMatch(
          new RegExp(
            `\`${supplement}\` \\(Evidence \`ev_[a-f0-9]{64}\`\\)`,
            "u",
          ),
        );
      expect(markdown).toContain(
        claim(
          "Osservato",
          "File PE a 64 bit (PE32+) per l'architettura «x86_64», con 1 sezione.",
        ),
      );
      expect(markdown).toContain(
        claim("Osservato", "È un programma eseguibile (non una DLL)."),
      );
      expect(markdown).toContain(
        claim("Osservato", "Non contiene metadati .NET: è codice nativo."),
      );
      expect(markdown).toContain(
        claim("Osservato", "Importa 2 funzioni da «KERNEL32.dll»."),
      );
      for (const [capability, basis] of [
        ["comunicare in rete", "WS2_32.dll"],
        ["modificare il registro di Windows", "RegSetValueExW da ADVAPI32.dll"],
        ["avviare altri programmi", "CreateProcessW da KERNEL32.dll"],
        [
          "caricare altro codice durante l'esecuzione",
          "LoadLibraryW da KERNEL32.dll",
        ],
      ])
        expect(markdown).toContain(
          claim(
            "Ipotesi",
            `Potrebbe ${capability}: importa «${basis}». Un'importazione non dimostra che la funzione venga usata.`,
          ),
        );
      expect(markdown).not.toMatch(/\*\*Osservato\*\* — Potrebbe/u);
      expect(markdown).toContain(
        claim(
          "Osservato",
          "Il file non contiene una firma Authenticode incorporata.",
        ),
      );
      // Settled by the .NET supplement: neither the guess nor the probe remains.
      expect(markdown).not.toContain("può contenere codice .NET");
      expect(markdown).not.toContain("inspect\\_managed\\_artifact»");
      expect(markdown).toContain(
        claim(
          "Sconosciuto",
          "La decompilazione e l'analisi delle funzioni del codice nativo richiedono un motore esterno gratuito come Ghidra, da installare a parte: non fanno parte di questo rapporto.",
        ),
      );
      expect(markdown).toContain(
        claim(
          "Sconosciuto",
          "Nomi, dimensioni e permessi delle singole sezioni non sono riportati da questa versione del motore.",
        ),
      );

      // IMAGE_FILE_DLL lives in the COFF characteristics (PE header + 22).
      const dll = Buffer.from(image);
      dll.writeUInt16LE(dll.readUInt16LE(128 + 22) | 0x2000, 128 + 22);
      const library = join(host.home, "..", "tmp", "library.dll");
      await writeFile(library, dll);
      expect((await report(host, library)).markdown).toContain(
        claim(
          "Osservato",
          "È una libreria (DLL): il codice viene caricato da altri programmi.",
        ),
      );
      await expectNoHostSideEffects(host);
    },
    TIMEOUT_MS,
  );
});

describe("InsideApp reports for SQLite databases", () => {
  it(
    "describes the schema without reading rows and refuses a damaged file",
    async () => {
      const host = await createIsolatedHost();
      const path = join(host.home, "..", "tmp", "clienti.sqlite");
      const database = new DatabaseSync(path);
      database.exec(`
        CREATE TABLE clienti (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, email TEXT);
        CREATE INDEX clienti_email ON clienti(email);
        CREATE VIEW nomi AS SELECT nome FROM clienti;
        INSERT INTO clienti (nome, email) VALUES ('Mario Rossi Fittizio', 'mario.fittizio@example.invalid');
      `);
      database.close();
      const before = await readFile(path);
      const { operation, markdown } = await report(host, path);
      expect(operation).toBe("inspect_sqlite_database");
      expect(markdown).toMatch(
        /- \*\*Osservato\*\* — Database «SQLite [\d.]+» di [\d.]+ byte, codifica «UTF-8»: 1 tabella, 1 indice, 1 vista, 0 trigger\./u,
      );
      expect(markdown).toContain(
        claim(
          "Osservato",
          "Tabella «clienti» con 3 colonne: «id» (INTEGER) chiave primaria, «nome» (TEXT), «email» (TEXT).",
        ),
      );
      expect(markdown).toContain(
        claim("Osservato", "Vista «nomi» (non eseguita)."),
      );
      expect(markdown).toContain(
        claim(
          "Sconosciuto",
          "Numero di righe e contenuto delle tabelle non sono stati letti, per non esporre dati personali.",
        ),
      );
      expect(markdown).not.toMatch(/Mario Rossi|mario\.fittizio/u);
      // The original database is never modified.
      expect((await readFile(path)).equals(before)).toBe(true);

      const damaged = join(host.home, "..", "tmp", "danneggiato.sqlite");
      await writeFile(
        damaged,
        Buffer.concat([
          Buffer.from("SQLite format 3\0", "latin1"),
          Buffer.alloc(4080),
        ]),
      );
      const refused = await runLauncher(host, [
        "report",
        damaged,
        "--authorized",
        "--json",
      ]);
      expect(refused.exitCode).toBe(1);
      expect(JSON.parse(refused.stdout)).toMatchObject({
        category: "invalid_input",
      });
      await expectNoHostSideEffects(host);
    },
    TIMEOUT_MS,
  );
});
