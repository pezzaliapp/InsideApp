import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createIsolatedHost,
  expectNoHostSideEffects,
  runLauncher,
} from "../../fixtures/insideappHost.js";

const TIMEOUT_MS = 180_000;
const NOTES_EXAMPLE = "tests/fixtures/examples/notes-electron";
const LABELS = {
  observed: "Osservato",
  derived: "Derivato",
  hypothesis: "Ipotesi",
  unknown: "Sconosciuto",
} as const;

const reportOutputSchema = z.strictObject({
  report: z.strictObject({
    title: z.string(),
    operation: z.enum(["analyze_javascript_application", "inspect_artifact"]),
    evidence_id: z.string().regex(/^ev_[a-f0-9]{64}$/u),
    counts: z.strictObject({
      observed: z.int(),
      derived: z.int(),
      hypothesis: z.int(),
      unknown: z.int(),
    }),
  }),
  files: z.strictObject({
    html: z.string().optional(),
    markdown: z.string().optional(),
  }),
});

const section = (markdown: string, title: string): string => {
  const start = markdown.indexOf(`\n## ${title}\n`);
  expect(start, title).toBeGreaterThan(0);
  const end = markdown.indexOf("\n## ", start + 1);
  return markdown.slice(start, end === -1 ? undefined : end);
};

/** Every claim is one list item; its proof, when present, is the next line. */
const claimLines = (markdown: string): string[] =>
  markdown
    .split("\n")
    .filter((line) =>
      /^- \*\*(?:Osservato|Derivato|Ipotesi|Sconosciuto)\*\* — /u.test(line),
    );

const expectSelfContainedHtml = (html: string): void => {
  expect(html).toMatch(/^<!doctype html>\n<html lang="it">/u);
  expect(html).toContain(
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`,
  );
  // Target text may mention URLs; only markup that loads resources is refused.
  expect(html).not.toMatch(
    /<(?:script|img|link|iframe|object|embed|base)\b|\shref=|<[a-z]+\s[^>]*\ssrc=/iu,
  );
};

describe("InsideApp report command", () => {
  it(
    "refuses to analyze without the authorization declaration",
    async () => {
      const host = await createIsolatedHost();
      const output = join(host.home, "..", "tmp", "rapporti");
      const result = await runLauncher(host, [
        "report",
        NOTES_EXAMPLE,
        "--output-dir",
        output,
        "--json",
      ]);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        code: "invalid_request",
        message: expect.stringContaining("--authorized"),
        details: {
          operation: "report",
          issues: [{ path: ["authorized"], reason: "missing_argument" }],
        },
      });
      await expect(readdir(output)).rejects.toMatchObject({ code: "ENOENT" });
      await expectNoHostSideEffects(host);
    },
    TIMEOUT_MS,
  );

  it(
    "refuses folders that would sweep the disk or the account, like the GUI and MCP",
    async () => {
      const host = await createIsolatedHost();
      const output = join(host.home, "..", "tmp", "rapporti");
      for (const path of ["/", "/Applications", host.home]) {
        const result = await runLauncher(host, [
          "report",
          path,
          "--authorized",
          "--output-dir",
          output,
          "--json",
        ]);
        expect(result.exitCode, path).toBe(1);
        expect(JSON.parse(result.stdout), path).toMatchObject({
          code: "invalid_request",
          message: expect.stringContaining("troppo ampia"),
          details: { issues: [{ path: ["path"], reason: "invalid_value" }] },
        });
      }
      await expect(readdir(output)).rejects.toMatchObject({ code: "ENOENT" });
      await expectNoHostSideEffects(host);
    },
    TIMEOUT_MS,
  );

  it(
    "reports the Electron example with classified claims and verifiable evidence",
    async () => {
      const host = await createIsolatedHost();
      const output = join(host.home, "..", "tmp", "rapporti");
      const result = await runLauncher(host, [
        "report",
        NOTES_EXAMPLE,
        "--authorized",
        "--output-dir",
        output,
        "--json",
      ]);
      expect(result.exitCode, result.stderr).toBe(0);
      const summary = reportOutputSchema.parse(JSON.parse(result.stdout));
      expect(summary.report.operation).toBe("analyze_javascript_application");
      expect(Object.keys(summary.files).sort()).toEqual(["html", "markdown"]);
      expect((await readdir(output)).sort()).toEqual([
        "notes-electron-0ee325d4eaf7.html",
        "notes-electron-0ee325d4eaf7.md",
      ]);
      const markdown = await readFile(summary.files.markdown!, "utf8");
      const html = await readFile(summary.files.html!, "utf8");

      for (const title of [
        "In breve",
        "Componenti",
        "Comunicazioni",
        "Dati e file",
        "Sicurezza",
        "Limiti e sconosciuti",
      ])
        section(markdown, title);
      expect(markdown).toContain(
        `- **Evidence:** \`${summary.report.evidence_id}\``,
      );
      expect(section(markdown, "In breve")).toContain(
        "- **Derivato** — È un'applicazione Electron: il processo principale parte da «main.js».",
      );
      expect(section(markdown, "Comunicazioni")).toContain(
        [
          "- **Osservato** — Il processo principale gestisce il canale IPC «notes:export» (handle).",
          "  - Prova: file `main.js` · riga 8, colonna 1 · SHA-256 `cc5b00911bfe428754d94ca40e8c0f354cfaae86f716873423aa5a62b9e0379a`",
        ].join("\n"),
      );
      expect(section(markdown, "Comunicazioni")).toContain(
        "- **Derivato** — La funzione «notes.exportCsv», esposta all'interfaccia, invia richieste al processo principale sul canale IPC «notes:export».",
      );
      expect(section(markdown, "Componenti")).toContain(
        "- **Ipotesi** — Usa il modulo di sistema di Node.js «node:fs».",
      );
      expect(section(markdown, "Sicurezza")).toContain(
        "- **Sconosciuto** — In «main.js» la finestra non imposta esplicitamente «webPreferences.contextIsolation»",
      );

      const claims = claimLines(markdown);
      for (const [kind, label] of Object.entries(LABELS)) {
        const count = summary.report.counts[kind as keyof typeof LABELS];
        expect(count, kind).toBeGreaterThan(0);
        expect(
          claims.filter((line) => line.startsWith(`- **${label}**`)),
        ).toHaveLength(count);
        expect(
          html.match(new RegExp(`<li class="claim ${kind}">`, "gu")),
        ).toHaveLength(count);
      }
      const lines = markdown.split("\n");
      for (const claim of claims)
        expect(lines[lines.indexOf(claim) + 1], claim).toMatch(
          /^ {2}- Prova: .*Evidence `ev_[a-f0-9]{64}`/u,
        );
      expect(html.match(/<summary>Mostra prova<\/summary>/gu)).toHaveLength(
        claims.length,
      );
      expectSelfContainedHtml(html);
      await expectNoHostSideEffects(host);
    },
    TIMEOUT_MS,
  );
});

describe("InsideApp report output safety and formats", () => {
  it(
    "escapes target-controlled names and hides the home directory",
    async () => {
      const host = await createIsolatedHost();
      const application = join(host.home, "apps", "hostile");
      await mkdir(application, { recursive: true });
      await writeFile(
        join(application, "package.json"),
        JSON.stringify({
          name: "<img src=x onerror=alert(1)>[x](https://example.invalid)",
          version: "1.0.0",
          main: "main.js",
        }),
      );
      await writeFile(
        join(application, "main.js"),
        'const { ipcMain } = require("electron");\nipcMain.handle("</li><script>alert(1)</script>", () => 1);\n',
      );
      const output = join(host.home, "..", "tmp", "rapporti");
      const result = await runLauncher(host, [
        "report",
        application,
        "--authorized",
        "--output-dir",
        output,
        "--json",
      ]);
      expect(result.exitCode, result.stderr).toBe(0);
      const summary = reportOutputSchema.parse(JSON.parse(result.stdout));
      const markdown = await readFile(summary.files.markdown!, "utf8");
      const html = await readFile(summary.files.html!, "utf8");

      expect(html).toContain(
        "&lt;/li&gt;&lt;script&gt;alert(1)&lt;/script&gt;",
      );
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expectSelfContainedHtml(html);
      expect(markdown).toContain(
        "«\\</li\\>\\<script\\>alert(1)\\</script\\>»",
      );
      expect(markdown).toContain(
        "«\\<img src=x onerror=alert(1)\\>\\[x\\](https://example.invalid)»",
      );
      expect(markdown).not.toMatch(/(?<!\\)<(?:script|img)|(?<!\\)\[x/u);

      expect(markdown).toContain("- **Percorso:** `~/apps/hostile`");
      expect(markdown).not.toContain(host.home);
      expect(html).not.toContain(host.home);
      expect([...(await host.homeEntries())].sort()).toEqual([
        "apps",
        "apps/hostile",
        "apps/hostile/main.js",
        "apps/hostile/package.json",
      ]);
      expect(await host.activity()).toEqual([]);
      expect(await host.runnerCalls()).toBe("");
    },
    TIMEOUT_MS,
  );

  it(
    "reports other artifacts through provider-neutral inspection in the selected format",
    async () => {
      const host = await createIsolatedHost();
      const root = join(host.home, "..", "tmp");
      const archive = join(root, "bundle.zip");
      const writer = new ZipWriter(new Uint8ArrayWriter());
      await writer.add("main.js", new TextReader("console.log(1);\n"));
      await writeFile(archive, await writer.close());
      const output = join(root, "rapporti");
      const result = await runLauncher(host, [
        "report",
        archive,
        "--authorized",
        "--only",
        "markdown",
        "--output-dir",
        output,
        "--json",
      ]);
      expect(result.exitCode, result.stderr).toBe(0);
      const summary = reportOutputSchema.parse(JSON.parse(result.stdout));
      expect(summary.report.operation).toBe("inspect_artifact");
      expect(Object.keys(summary.files)).toEqual(["markdown"]);
      expect(await readdir(output)).toEqual([
        expect.stringMatching(/^bundle\.zip-[a-f0-9]{12}\.md$/u),
      ]);
      const markdown = await readFile(summary.files.markdown!, "utf8");
      expect(section(markdown, "In breve")).toMatch(
        /- \*\*Osservato\*\* — Formato riconosciuto: «zip», dimensione [\d.]+ byte\.\n {2}- Prova: SHA-256 `[a-f0-9]{64}` · Evidence `ev_[a-f0-9]{64}` · metodo `inventory_artifact`/u,
      );
      expect(claimLines(markdown)).toHaveLength(
        Object.values(summary.report.counts).reduce(
          (total, count) => total + count,
          0,
        ),
      );
      await expectNoHostSideEffects(host);
    },
    TIMEOUT_MS,
  );
});
