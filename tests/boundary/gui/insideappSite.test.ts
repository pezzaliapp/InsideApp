import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, resolve } from "node:path";

import { chromium } from "playwright-core";
import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";

const TIMEOUT_MS = 120_000;
/** The installed browser only; Playwright never downloads one here. */
const SYSTEM_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SITE = resolve("site");
const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

/** Measured in the page; kept as text because tests compile without DOM types. */
const PAGE_FACTS = `(() => {
  const ids = new Set([...document.querySelectorAll("[id]")].map(({ id }) => id));
  const links = [...document.querySelectorAll("a")];
  const root = document.documentElement;
  return {
    lang: root.lang,
    title: document.title,
    overflow: root.scrollWidth - root.clientWidth,
    styled: getComputedStyle(document.querySelector(".logo")).display,
    landmarks: ["header", "nav", "main", "footer"].filter((tag) => document.querySelector(tag) !== null),
    h1: document.querySelectorAll("h1").length,
    headings: [...document.querySelectorAll("h1, h2, h3")].map(({ tagName }) => Number(tagName.slice(1))),
    brokenAnchors: links
      .map((link) => link.getAttribute("href") ?? "")
      .filter((href) => href.startsWith("#") && href !== "#" && !ids.has(href.slice(1))),
    unnamedLinks: links.filter((link) => link.textContent.trim() === "" && !link.hasAttribute("aria-label")).length,
    tables: [...document.querySelectorAll("table")].every((table) => table.querySelector("caption, th[scope]") !== null),
  };
})()`;

const factsSchema = z.object({
  lang: z.string(),
  title: z.string(),
  overflow: z.number(),
  styled: z.string(),
  landmarks: z.array(z.string()),
  h1: z.number(),
  headings: z.array(z.number()),
  brokenAnchors: z.array(z.string()),
  unnamedLinks: z.number(),
  tables: z.boolean(),
});

/** Serve the site like a static host, applying the `_headers` rules. */
const serveSite = async (): Promise<string> => {
  const headers = (await readFile(resolve(SITE, "_headers"), "utf8"))
    .split("\n")
    .filter((line) => line.startsWith("  "))
    .map((line) => {
      const at = line.indexOf(":");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()] as const;
    });
  const server = createServer((request, response) => {
    const name = (request.url ?? "/").split("?")[0]!.slice(1) || "index.html";
    const type = TYPES[extname(name)];
    if (type === undefined || name.includes("/") || name.startsWith("_")) {
      response.writeHead(404).end();
      return;
    }
    readFile(resolve(SITE, name)).then(
      (body) => {
        response.writeHead(200, [["Content-Type", type], ...headers].flat());
        response.end(body);
      },
      () => response.writeHead(404).end(),
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  onTestFinished(() => new Promise<void>((done) => server.close(() => done())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

describe("InsideApp public site sources", () => {
  it("is static, self-contained and served with strict security headers", async () => {
    expect((await readdir(SITE)).sort()).toEqual([
      "README.md",
      "_headers",
      "favicon.svg",
      "index.html",
      "robots.txt",
      "styles.css",
    ]);
    const html = await readFile(resolve(SITE, "index.html"), "utf8");
    // No scripts, forms, frames or third-party resources: only links leave the page.
    expect(html).not.toMatch(/<(script|form|iframe|object|embed|input)\b/iu);
    expect(html).not.toMatch(/\son[a-z]+=/iu);
    expect(html).not.toMatch(/\ssrc=/u);
    for (const [, url] of html.matchAll(/<link[^>]+href="([^"]+)"/gu))
      expect(url, url).toMatch(/^[a-z]+\.(?:css|svg)$/u);
    for (const [, url] of html.matchAll(/<a[^>]+href="([^"]+)"/gu))
      expect(url, url).toMatch(/^(?:#|https:\/\/)/u);
    const css = await readFile(resolve(SITE, "styles.css"), "utf8");
    expect(css).not.toMatch(/url\(|@import/u);

    const headers = await readFile(resolve(SITE, "_headers"), "utf8");
    expect(headers).toContain(
      "Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    for (const header of [
      "X-Content-Type-Options: nosniff",
      "Referrer-Policy: no-referrer",
      "Permissions-Policy:",
    ])
      expect(headers).toContain(header);
  });

  it("states only verified platforms and keeps the attributions", async () => {
    const html = await readFile(resolve(SITE, "index.html"), "utf8");
    expect(html).toContain("Non esiste ancora un programma d'installazione");
    expect(html).toContain(
      '<span class="tag ok">Verificato</span> Mac con Apple Silicon',
    );
    expect(html).toContain(
      '<span class="tag no">Non supportato</span> Windows',
    );
    expect(html).toContain("Linux (previsto dal codice originale, non provato");
    expect(html).toContain("https://github.com/morluto/rea");
    expect(html).toContain("non è affiliato");
    // The install commands mirror the README exactly.
    const readme = await readFile(resolve("README.md"), "utf8");
    for (const command of [
      "npm ci --ignore-scripts --no-audit --no-fund --no-update-notifier",
      "npm run build:cached",
      "./scripts/insideapp.sh gui",
      "node-v24.22.1-darwin-arm64",
    ]) {
      expect(html, command).toContain(command);
      expect(readme, command).toContain(command);
    }
  });
});

describe("InsideApp public site in the installed Chrome", () => {
  it.skipIf(!existsSync(SYSTEM_CHROME))(
    "renders on desktop and phone without external requests (requires Chrome)",
    async () => {
      const origin = await serveSite();
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
      for (const viewport of [
        { width: 1280, height: 900 },
        { width: 375, height: 740 },
      ]) {
        const context = await browser.newContext({ viewport });
        const external: string[] = [];
        await context.route("**/*", (route) => {
          const url = route.request().url();
          if (url.startsWith(`${origin}/`)) return route.continue();
          external.push(url);
          return route.abort();
        });
        const page = await context.newPage();
        const problems: string[] = [];
        page.on("console", (message) => {
          if (message.type() === "error" || message.type() === "warning")
            problems.push(message.text());
        });
        page.on("pageerror", (error) => problems.push(error.message));
        await page.goto(`${origin}/`, { waitUntil: "load" });

        const facts = factsSchema.parse(await page.evaluate(PAGE_FACTS));
        expect(facts, JSON.stringify(viewport)).toMatchObject({
          lang: "it",
          title: "InsideApp — Guarda dentro il software",
          overflow: 0,
          landmarks: ["header", "nav", "main", "footer"],
          h1: 1,
          brokenAnchors: [],
          unnamedLinks: 0,
          tables: true,
          styled: "grid",
        });
        // Heading levels never skip one going down.
        facts.headings.forEach((level, index) => {
          expect(level - (facts.headings[index - 1] ?? 0)).toBeLessThanOrEqual(
            1,
          );
        });
        // The skip link is the first focus stop and reveals itself.
        await page.keyboard.press("Tab");
        expect(await page.evaluate("document.activeElement?.textContent")).toBe(
          "Vai al contenuto",
        );
        // FAQ answers open without scripts.
        await page.locator("summary").first().click();
        expect(await page.locator("details").first().getAttribute("open")).toBe(
          "",
        );
        expect(external).toEqual([]);
        expect(problems).toEqual([]);
        await context.close();
      }
    },
    TIMEOUT_MS,
  );
});
