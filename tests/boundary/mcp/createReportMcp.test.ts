import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";

import { renderReportMarkdown } from "../../../src/application/report/renderInsideAppReport.js";
import { insideAppReportSchema } from "../../../src/domain/report/insideAppReport.js";
import { peImportImage } from "../../fixtures/binaryDiagnostics/peImports.js";
import {
  createIsolatedHost,
  expectNoHostSideEffects,
  runLauncher,
} from "../../fixtures/insideappHost.js";

const TIMEOUT_MS = 180_000;
const NOTES = resolve("tests/fixtures/examples/notes-electron");

type Host = Awaited<ReturnType<typeof createIsolatedHost>>;

/** The project MCP server exactly as .mcp.json starts it. */
const connect = async (host: Host): Promise<Client> => {
  const client = new Client({ name: "insideapp-report-test", version: "1" });
  onTestFinished(async () => {
    await client.close();
  });
  await client.connect(
    new StdioClientTransport({
      command: resolve("scripts/insideapp.sh"),
      args: ["mcp"],
      cwd: resolve("."),
      env: host.environment,
      stderr: "pipe",
    }),
  );
  return client;
};

const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    category: z.string(),
    message: z.string(),
  }),
});

const call = async (client: Client, args: Record<string, unknown>) => {
  const result = await client.callTool({
    name: "create_report",
    arguments: args,
  });
  const text =
    (result.content as { type: string; text: string }[])[0]?.text ?? "";
  return { result, text };
};

const refusal = async (client: Client, args: Record<string, unknown>) => {
  const { result, text } = await call(client, args);
  expect(result.isError, text).toBe(true);
  return errorSchema.parse(JSON.parse(text)).error;
};

const reportOf = (result: { structuredContent?: unknown }) => {
  const evidence = z
    .object({
      operation: z.literal("create_report"),
      evidence_links: z.array(z.string()),
      normalized_result: insideAppReportSchema,
    })
    .parse(result.structuredContent);
  return evidence;
};

describe("InsideApp create_report MCP tool", () => {
  it(
    "is advertised and refuses missing authorization before reading anything",
    async () => {
      const host = await createIsolatedHost();
      const client = await connect(host);
      const tools = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(
          cursor === undefined ? {} : { cursor },
        );
        tools.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      const tool = tools.find(({ name }) => name === "create_report");
      expect(tool?.inputSchema).toMatchObject({
        required: expect.arrayContaining(["path", "authorized"]),
      });
      expect(tool?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
      });
      // A missing path proves the refusal happens before any read.
      expect(
        await refusal(client, { path: "/does/not/exist", authorized: false }),
      ).toMatchObject({
        code: "invalid_request",
        message: expect.stringContaining("authorized: true"),
      });
      for (const args of [
        { path: NOTES },
        { path: "relative/app", authorized: true },
        { path: NOTES, authorized: "yes" },
        { path: NOTES, authorized: true, extra: 1 },
      ])
        expect(
          (await refusal(client, args)).category,
          JSON.stringify(args),
        ).toBe("invalid_input");
      for (const path of ["/", "/Applications", host.home])
        expect(
          await refusal(client, { path, authorized: true }),
          path,
        ).toMatchObject({
          message: expect.stringContaining("troppo ampia"),
        });
      await expectNoHostSideEffects(host);
    },
    TIMEOUT_MS,
  );
});

describe("InsideApp create_report MCP reports", () => {
  it(
    "returns the same path-free report as the CLI for an Electron application",
    async () => {
      const host = await createIsolatedHost();
      const client = await connect(host);
      const { result, text } = await call(client, {
        path: NOTES,
        authorized: true,
      });
      expect(result.isError ?? false, text).toBe(false);
      const evidence = reportOf(result);
      const report = evidence.normalized_result;
      expect(report.subject).toMatchObject({
        name: "notes-electron",
        path: null,
      });
      expect(report.counts).toEqual({
        observed: 6,
        derived: 4,
        hypothesis: 3,
        unknown: 16,
      });
      expect(evidence.evidence_links).toEqual([report.analysis.evidence_id]);
      expect(text).not.toContain(NOTES);
      expect(text).not.toContain(resolve("."));

      const cli = await runLauncher(host, [
        "report",
        NOTES,
        "--authorized",
        "--only",
        "markdown",
        "--output-dir",
        join(host.home, "..", "tmp", "rapporti"),
        "--json",
      ]);
      expect(cli.exitCode, cli.stderr).toBe(0);
      const markdown = await readFile(
        z
          .object({ files: z.object({ markdown: z.string() }) })
          .parse(JSON.parse(cli.stdout)).files.markdown,
        "utf8",
      );
      // Same engine Evidence and claims: only the CLI's path and time differ.
      expect(
        renderReportMarkdown({
          ...report,
          subject: { ...report.subject, path: NOTES },
          generated_at: /- \*\*Generato:\*\* (\S+) con /u.exec(markdown)![1]!,
        }),
      ).toBe(markdown);
      await expectNoHostSideEffects(host);
    },
    TIMEOUT_MS,
  );

  it(
    "reports Windows executables and archives, and explains damaged databases",
    async () => {
      const host = await createIsolatedHost();
      const root = join(host.home, "..", "tmp");
      const exe = join(root, "tool.exe");
      await writeFile(
        exe,
        peImportImage({
          dlls: [
            { name: "WS2_32.dll", functions: [{ name: "connect", hint: 1 }] },
          ],
        }),
      );
      const archive = join(root, "bundle.zip");
      const writer = new ZipWriter(new Uint8ArrayWriter());
      await writer.add("main.js", new TextReader("console.log(1);\n"));
      await writeFile(archive, await writer.close());
      const damaged = join(root, "danneggiato.sqlite");
      await writeFile(
        damaged,
        Buffer.concat([
          Buffer.from("SQLite format 3\0", "latin1"),
          Buffer.alloc(4080),
        ]),
      );
      const client = await connect(host);

      const pe = reportOf(
        (await call(client, { path: exe, authorized: true })).result,
      ).normalized_result;
      expect(
        pe.analysis.supplements.map(
          ({ operation, status }) => `${operation}:${status}`,
        ),
      ).toEqual([
        "inspect_managed_artifact:completed",
        "inspect_pe_imports:completed",
        "inspect_pe_resources:completed",
        "inspect_pe_certificates:completed",
        "inspect_native_exports:completed",
      ]);
      const claims = pe.sections.flatMap(({ claims: rows }) => rows);
      expect(claims).toContainEqual(
        expect.objectContaining({
          kind: "hypothesis",
          statement:
            "Potrebbe comunicare in rete: importa «WS2_32.dll». Un'importazione non dimostra che la funzione venga usata.",
        }),
      );
      const zip = await call(client, { path: archive, authorized: true });
      expect(reportOf(zip.result).normalized_result.analysis.operation).toBe(
        "inspect_artifact",
      );
      expect(zip.text).not.toContain(root);
      expect(
        await refusal(client, { path: damaged, authorized: true }),
      ).toMatchObject({
        category: "invalid_input",
      });
      await expectNoHostSideEffects(host);
    },
    TIMEOUT_MS,
  );
});
