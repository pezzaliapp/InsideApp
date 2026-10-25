import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it, onTestFinished } from "vitest";

import type { startGuiServer as startSourceGuiServer } from "../../../src/gui/guiServer.js";
import type { GuiPicker } from "../../../src/gui/guiTargets.js";
import {
  apiHeaders,
  jsonPost,
  launchToken,
  send,
  signedIn,
} from "../../fixtures/insideappGuiClient.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const TIMEOUT_MS = 120_000;

const queuedPicker = (...paths: string[]): GuiPicker => {
  const queue = [...paths];
  return async () => {
    const next = queue.shift();
    return next === undefined
      ? { ok: false, reason: "cancelled" }
      : { ok: true, path: next };
  };
};

type Session = Awaited<ReturnType<typeof signedIn>>;

const pick = async (session: Session) =>
  JSON.parse(
    (
      await jsonPost(
        session.gui,
        "/api/targets",
        { kind: "folder" },
        session.cookie,
      )
    ).body,
  ) as { outcome: string; target?: { id: string; route: string } };

const settled = async (session: Session, id: string) => {
  for (;;) {
    const response = await send(session.gui, {
      path: `/api/analyses/${id}`,
      headers: apiHeaders(session.gui, session.cookie),
    });
    const value = JSON.parse(response.body) as Record<string, unknown>;
    if (value.status !== "running") return value;
    await new Promise((wait) => setTimeout(wait, 100));
  }
};

describe("InsideApp GUI with G3 formats", () => {
  it("refuses folders that would sweep a whole disk or account", async () => {
    const home = await createTestTempDirectory("rea-insideapp-gui-home-");
    const project = join(home, "progetti", "app");
    await mkdir(project, { recursive: true });
    const session = await signedIn({
      homeDirectory: home,
      picker: queuedPicker(
        "/",
        "/Applications",
        home,
        join(home, ".."),
        project,
      ),
    });
    for (let index = 0; index < 4; index += 1)
      expect(await pick(session)).toEqual({ outcome: "too_broad" });
    expect(await pick(session)).toMatchObject({ outcome: "selected" });
  });

  it(
    "analyzes a SQLite database structure without exposing its rows",
    async () => {
      const root = await createTestTempDirectory("rea-insideapp-gui-sqlite-");
      const path = join(root, "rubrica.db");
      const database = new DatabaseSync(path);
      database.exec(`
        CREATE TABLE contatti (id INTEGER PRIMARY KEY, nome TEXT, telefono TEXT);
        INSERT INTO contatti (nome, telefono) VALUES ('Giulia Bianchi Fittizia', '+39 000 0000000');
      `);
      database.close();
      const damagedPath = join(root, "danneggiato.sqlite");
      await writeFile(
        damagedPath,
        Buffer.concat([
          Buffer.from("SQLite format 3\0", "latin1"),
          Buffer.alloc(4080),
        ]),
      );
      // The built server, as users run it: its SQLite worker exists only in dist.
      const { startGuiServer } = (await import(
        new URL("../../../dist/gui/guiServer.js", import.meta.url).href
      )) as { startGuiServer: typeof startSourceGuiServer };
      const gui = await startGuiServer({
        projectRoot: root,
        launcherDirectory: join(root, ".cache", "gui"),
        idleTimeoutMs: 60_000,
        environment: process.env,
        picker: queuedPicker(path, damagedPath),
      });
      onTestFinished(async () => {
        await gui.stop("shutdown");
      });
      const redeemed = await jsonPost(gui, "/api/session", {
        token: await launchToken(gui),
      });
      const session: Session = {
        gui,
        root,
        cookie: String(redeemed.headers["set-cookie"]).split(";", 1)[0]!,
      };
      const chosen = await pick(session);
      expect(chosen.target?.route).toBe("sqlite");
      const started = await jsonPost(
        session.gui,
        "/api/analyses",
        { target_id: chosen.target!.id, authorized: true },
        session.cookie,
      );
      const id = (JSON.parse(started.body) as { id: string }).id;
      const result = await settled(session, id);
      expect(result, JSON.stringify(result)).toMatchObject({
        status: "completed",
      });
      const bodies = await Promise.all(
        [
          `/api/reports/${id}`,
          `/api/reports/${id}/export.md`,
          `/api/reports/${id}/export.html`,
        ].map(
          async (reportPath) =>
            (
              await send(session.gui, {
                path: reportPath,
                headers: apiHeaders(session.gui, session.cookie),
              })
            ).body,
        ),
      );
      expect(bodies[1]).toContain("Tabella «contatti» con 3 colonne");
      for (const body of bodies) {
        expect(body).not.toMatch(/Giulia|Bianchi|\+39 000/u);
        expect(body).not.toContain(root);
      }
      // A damaged database is refused with a clear, path-free explanation.
      const damaged = await pick(session);
      const refused = await jsonPost(
        session.gui,
        "/api/analyses",
        { target_id: damaged.target!.id, authorized: true },
        session.cookie,
      );
      const failure = await settled(
        session,
        (JSON.parse(refused.body) as { id: string }).id,
      );
      expect(failure).toMatchObject({
        status: "failed",
        failure: {
          message: expect.stringContaining(
            "potrebbe essere danneggiato o di un altro tipo",
          ),
        },
      });
      expect(JSON.stringify(failure)).not.toContain(root);
    },
    TIMEOUT_MS,
  );
});
