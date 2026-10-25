import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "playwright-core";
import { describe, expect, it, onTestFinished } from "vitest";

import { startGui } from "../../fixtures/insideappGuiClient.js";

const TIMEOUT_MS = 120_000;
/** The installed browser only; Playwright never downloads one here. */
const SYSTEM_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const NOTES = resolve("tests/fixtures/examples/notes-electron");

describe("InsideApp GUI in the installed Chrome", () => {
  it.skipIf(!existsSync(SYSTEM_CHROME))(
    "selects, analyzes, explains and exports an application (requires Chrome)",
    async () => {
      const { gui } = await startGui({
        picker: async () => ({ ok: true, path: NOTES }),
      });
      const browser = await chromium.launch({
        executablePath: SYSTEM_CHROME,
        headless: true,
        args: [
          "--disable-background-networking",
          "--disable-component-update",
          "--no-pings",
        ],
      });
      onTestFinished(() => browser.close());
      const context = await browser.newContext({ acceptDownloads: true });
      const page = await context.newPage();
      // Record what the page writes to the clipboard, instead of the system clipboard.
      await page.addInitScript(`
        const copied = [];
        Object.defineProperty(window, "__copied", { value: copied });
        if (navigator.clipboard) navigator.clipboard.writeText = async (text) => { copied.push(text); };
      `);
      const external: string[] = [];
      await context.route("**/*", (route) => {
        const url = route.request().url();
        if (
          url.startsWith(`${gui.origin}/`) ||
          url.startsWith("file://") ||
          url.startsWith("blob:")
        )
          return route.continue();
        external.push(url);
        return route.abort();
      });
      const problems: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning")
          problems.push(message.text());
      });
      page.on("pageerror", (error) => problems.push(error.message));
      const polls: number[] = [];
      page.on("request", (request) => {
        if (/\/api\/analyses\/[A-Za-z0-9_-]{22}$/u.test(request.url()))
          polls.push(Date.now());
      });

      await page.goto(`file://${gui.launcher.path}`);
      await page.waitForURL(`${gui.origin}/`);
      await expect
        .poll(() => page.locator("#engine-state").textContent(), {
          timeout: 15_000,
        })
        .toBe("Motore pronto, solo in locale.");
      expect(await page.locator("#claude-title").textContent()).toBe(
        "Modalità Claude Code (facoltativa)",
      );

      await page.locator("#pick-folder").click();
      await expect
        .poll(() => page.locator("#target").textContent(), { timeout: 15_000 })
        .toBe(
          "Scelto: notes-electron — applicazione JavaScript/Electron: analisi completa.",
        );
      expect(await page.locator("#start").isDisabled()).toBe(true);
      await page.locator("#authorized").check();
      await page.locator("#start").click();
      await expect
        .poll(() => page.locator("#phase").textContent(), { timeout: 60_000 })
        .toBe("Analisi completata.");
      // The report loads with a request after the completed status.
      await expect
        .poll(
          () => page.locator("#step-understand").getAttribute("aria-current"),
          { timeout: 15_000 },
        )
        .toBe("step");

      expect(await page.locator("#report-title").textContent()).toBe(
        "Rapporto InsideApp — notes-electron",
      );
      expect(
        await page.locator("#counts .count strong").allTextContents(),
      ).toEqual(["6", "4", "3", "16"]);
      expect(await page.locator("#sections h4").allTextContents()).toEqual([
        "In breve",
        "Componenti",
        "Comunicazioni",
        "Dati e file",
        "Sicurezza",
        "Limiti e sconosciuti",
      ]);
      const channel = page.locator("#sections li.claim", {
        hasText:
          "Il processo principale gestisce il canale IPC «notes:export» (handle).",
      });
      expect(await channel.locator(".badge").textContent()).toBe("Osservato");
      await channel.locator("summary").click();
      expect(await channel.locator("details li").first().textContent()).toBe(
        "file: main.js",
      );
      // Filters hide one class without touching the others.
      await page
        .locator("#filters label", { hasText: "Sconosciuto" })
        .locator("input")
        .uncheck();
      expect(
        await page.locator('#sections li[data-kind="unknown"]:visible').count(),
      ).toBe(0);
      expect(
        await page
          .locator('#sections li[data-kind="observed"]:visible')
          .count(),
      ).toBe(6);

      // Claude Code stays optional: copying needs an explicit acknowledgement.
      await page.locator("#claude-setup-copy").click();
      await page.locator("#claude-copy").click();
      expect(await page.locator("#claude-copy-confirm").isDisabled()).toBe(
        true,
      );
      await page.locator("#claude-consent-check").check();
      await page.locator("#claude-copy-confirm").click();
      await expect
        .poll(() => page.locator("#claude-copy-state").textContent())
        .toBe("Copiato negli appunti.");
      const copied = (await page.evaluate("window.__copied")) as string[];
      expect(copied[0]).toBe("claude");
      expect(copied[1]).toMatch(
        /^Ecco un rapporto di InsideApp su un'applicazione che sono autorizzato ad analizzare\./u,
      );
      expect(copied[1]).toContain("# Rapporto InsideApp — notes-electron");
      expect(copied[1]).not.toContain(NOTES);

      const download = page.waitForEvent("download");
      await page.locator("#export-md").click();
      const file = await download;
      expect(file.suggestedFilename()).toBe("notes-electron-0ee325d4eaf7.md");
      const markdown = await readFile((await file.path())!, "utf8");
      expect(markdown).toContain("# Rapporto InsideApp — notes-electron");
      expect(markdown).not.toContain(NOTES);
      await page.emulateMedia({ media: "print" });
      expect(await page.locator("#select-title").isVisible()).toBe(false);
      expect(await page.locator("#report-title").isVisible()).toBe(true);
      await page.emulateMedia({ media: "screen" });

      // While running the page polled every 2 seconds; afterwards it stopped.
      for (let index = 1; index < polls.length; index += 1)
        expect(polls[index]! - polls[index - 1]!).toBeGreaterThanOrEqual(1900);
      const settledPolls = polls.length;
      await new Promise((wait) => setTimeout(wait, 2500));
      expect(polls.length).toBe(settledPolls);
      expect(await page.content()).not.toContain(NOTES);
      expect(external).toEqual([]);
      expect(problems).toEqual([]);
    },
    TIMEOUT_MS,
  );
});
