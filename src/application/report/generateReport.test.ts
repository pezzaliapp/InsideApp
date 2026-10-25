import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import type { InsideAppReport } from "../../domain/report/insideAppReport.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  generateReport,
  reportFileName,
  type ReportAnalysisPorts,
  type ReportRoute,
} from "./generateReport.js";

const options = {
  generatedAt: new Date("2026-01-01T00:00:00.000Z"),
  homeDirectory: undefined,
  signal: new AbortController().signal,
};

/** Ports that record which lane ran and return the given outcome. */
interface Failure {
  readonly failed: ReportRoute;
}

const recordingPorts = (
  outcome: (route: ReportRoute) => Result<unknown, Failure>,
) => {
  const calls: { route: ReportRoute; path: string; signal: AbortSignal }[] = [];
  const port =
    (route: ReportRoute) => async (path: string, signal: AbortSignal) => {
      calls.push({ route, path, signal });
      return outcome(route);
    };
  const ports: ReportAnalysisPorts<Failure> = {
    "javascript-application": port("javascript-application"),
    artifact: port("artifact"),
  };
  return { ports, calls };
};

describe("generateReport", () => {
  it("refuses without the authorization declaration before reading the target", async () => {
    const { ports, calls } = recordingPorts(() => ok({}));
    await expect(
      generateReport(
        { path: "/does/not/matter", authorized: false },
        ports,
        options,
      ),
    ).resolves.toEqual(err({ kind: "authorization-required" }));
    expect(calls).toEqual([]);
  });

  it("requires an absolute path", async () => {
    const { ports } = recordingPorts(() => ok({}));
    await expect(
      generateReport(
        { path: "relative/app", authorized: true },
        ports,
        options,
      ),
    ).rejects.toThrow("absolute path");
  });

  it("routes directories and .asar files like analyze and passes failures through", async () => {
    const root = await createTestTempDirectory("rea-generate-report-");
    const directory = join(root, "app");
    await mkdir(directory);
    await writeFile(join(root, "app.asar"), "not an archive");
    await writeFile(join(root, "tool.exe"), "MZ");
    const { ports, calls } = recordingPorts((route) => err({ failed: route }));
    const results = [];
    for (const path of [
      directory,
      join(root, "app.asar"),
      join(root, "tool.exe"),
      join(root, "missing"),
    ])
      results.push(
        await generateReport({ path, authorized: true }, ports, options),
      );
    expect(calls.map(({ route }) => route)).toEqual([
      "javascript-application",
      "javascript-application",
      "artifact",
      "artifact",
    ]);
    expect(calls.every(({ signal }) => signal === options.signal)).toBe(true);
    expect(results).toEqual([
      err({
        kind: "analysis-failed",
        failure: { failed: "javascript-application" },
      }),
      err({
        kind: "analysis-failed",
        failure: { failed: "javascript-application" },
      }),
      err({ kind: "analysis-failed", failure: { failed: "artifact" } }),
      err({ kind: "analysis-failed", failure: { failed: "artifact" } }),
    ]);
  });

  it("reports Evidence that fails authentication instead of projecting it", async () => {
    const root = await createTestTempDirectory("rea-generate-report-");
    const { ports } = recordingPorts(() => ok({ evidence_id: "ev_forged" }));
    const result = await generateReport(
      { path: root, authorized: true },
      ports,
      options,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "report-failed", error: { reason: "invalid-evidence" } },
    });
  });
});

describe("reportFileName", () => {
  const named = (name: string, sha256: string | null) =>
    ({ subject: { name, sha256 } }) as unknown as InsideAppReport;

  it("keeps portable names and appends a digest prefix", () => {
    expect(
      reportFileName(named("notes-electron", "0ee325d4eaf7f9"), "html"),
    ).toBe("notes-electron-0ee325d4eaf7.html");
    expect(reportFileName(named("../Mia App/é", null), "markdown")).toBe(
      "Mia-App-e.md",
    );
    expect(reportFileName(named("///", null), "html")).toBe(
      "applicazione.html",
    );
  });
});
