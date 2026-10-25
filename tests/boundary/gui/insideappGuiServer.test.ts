import { readFile, readdir, stat } from "node:fs/promises";
import { dirname } from "node:path";

import { describe, expect, it } from "vitest";

import { GUI_CONTENT_SECURITY_POLICY } from "../../../src/gui/guiSecurity.js";
import {
  GUI_MAX_BODY_BYTES,
  startGuiServer,
} from "../../../src/gui/guiServer.js";
import {
  apiHeaders,
  jsonPost,
  launchToken,
  refusesConnections,
  send,
  signedIn,
  startGui,
} from "../../fixtures/insideappGuiClient.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

describe("InsideApp GUI listener and launch token", () => {
  it("listens only on 127.0.0.1 with an assigned port and an owner-only launch file", async () => {
    const { gui, root } = await startGui();
    expect(gui.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
    expect(Number(new URL(gui.origin).port)).toBeGreaterThan(0);
    expect(gui.launcher.path.startsWith(`${root}/.cache/gui/`)).toBe(true);
    expect((await stat(gui.launcher.path)).mode & 0o777).toBe(0o600);
    expect((await stat(dirname(gui.launcher.path))).mode & 0o777).toBe(0o700);
    expect((await stat(`${root}/.cache/gui`)).mode & 0o777).toBe(0o700);
    // The token appears only in the URL fragment, which browsers never send.
    expect(await readFile(gui.launcher.path, "utf8")).toMatch(
      /<meta http-equiv="refresh" content="0;url=http:\/\/127\.0\.0\.1:\d+\/avvio#[A-Za-z0-9_-]{43}">/u,
    );
  });

  it("redeems the launch token once and removes the launch file", async () => {
    const { gui } = await startGui();
    const token = await launchToken(gui);
    expect(
      (await jsonPost(gui, "/api/session", { token: `${token}x` })).status,
    ).toBe(403);
    const first = await jsonPost(gui, "/api/session", { token });
    expect(first.status).toBe(204);
    expect(first.headers["set-cookie"]).toEqual([
      expect.stringMatching(
        /^insideapp_session=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/$/u,
      ),
    ]);
    await expect(readdir(dirname(gui.launcher.path))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const again = await jsonPost(gui, "/api/session", { token });
    expect(again).toMatchObject({
      status: 403,
      body: '{"error":"launch_used"}',
    });
  });

  it("refuses an expired launch token", async () => {
    let clock = 1_000_000;
    const { gui } = await startGui({ now: () => clock });
    const token = await launchToken(gui);
    clock += 60_001;
    expect(await jsonPost(gui, "/api/session", { token })).toMatchObject({
      status: 403,
      body: '{"error":"launch_expired"}',
    });
  });
});

describe("InsideApp GUI request admission", () => {
  it("refuses foreign Host headers on every route (DNS rebinding)", async () => {
    const { gui, cookie } = await signedIn();
    const port = new URL(gui.origin).port;
    for (const host of [
      `localhost:${port}`,
      `evil.example:${port}`,
      "127.0.0.1",
      `127.0.0.1:${Number(port) + 1}`,
    ])
      for (const path of ["/", "/api/status", "/assets/app.js", "/missing"]) {
        const response = await send(gui, {
          path,
          headers: { ...apiHeaders(gui, cookie), Host: host },
        });
        expect(response, `${host} ${path}`).toMatchObject({
          status: 403,
          body: '{"error":"refused_host"}',
        });
      }
  });

  it("refuses cross-origin, same-site and header-less API requests (CSRF)", async () => {
    const { gui, cookie } = await signedIn();
    const sameSitePeer = `http://127.0.0.1:${Number(new URL(gui.origin).port) + 1}`;
    const cases: [Record<string, string>, string][] = [
      [
        { ...apiHeaders(gui, cookie), Origin: "https://evil.example" },
        "refused_origin",
      ],
      [{ ...apiHeaders(gui, cookie), Origin: sameSitePeer }, "refused_origin"],
      [
        { ...apiHeaders(gui, cookie), "Sec-Fetch-Site": "same-site" },
        "refused_fetch-site",
      ],
      [
        { ...apiHeaders(gui, cookie), "Sec-Fetch-Site": "cross-site" },
        "refused_fetch-site",
      ],
      [{ Origin: gui.origin, Cookie: cookie }, "refused_request-header"],
    ];
    for (const [headers, error] of cases)
      expect(
        await send(gui, { path: "/api/status", headers }),
        error,
      ).toMatchObject({
        status: 403,
        body: JSON.stringify({ error }),
      });
    // A POST without Origin is refused even with the session cookie.
    const { Origin: _origin, ...withoutOrigin } = apiHeaders(gui, cookie);
    expect(
      await send(gui, {
        method: "POST",
        path: "/api/shutdown",
        headers: {
          ...withoutOrigin,
          "Content-Type": "application/json",
          "Content-Length": "2",
        },
        body: "{}",
      }),
    ).toMatchObject({ status: 403, body: '{"error":"refused_origin"}' });
    // Pages refuse other local sites, whose requests would carry the cookie.
    expect(
      await send(gui, {
        headers: { Cookie: cookie, "Sec-Fetch-Site": "same-site" },
      }),
    ).toMatchObject({ status: 403 });
    expect(await refusesConnections(gui)).toBe(false);
  });

  it("requires the session for the app page and every API except the launch exchange", async () => {
    const { gui, cookie } = await signedIn();
    expect((await send(gui)).status).toBe(401);
    expect((await send(gui)).body).toContain("Sessione non attiva");
    expect(
      (await send(gui, { headers: { Cookie: "insideapp_session=forged" } }))
        .status,
    ).toBe(401);
    expect(
      (await send(gui, { path: "/api/status", headers: apiHeaders(gui) }))
        .status,
    ).toBe(401);
    expect(
      (
        await send(gui, {
          path: "/api/status",
          headers: apiHeaders(gui, `${cookie}; ${cookie}`),
        })
      ).status,
    ).toBe(401);
    const page = await send(gui, { headers: { Cookie: cookie } });
    expect(page.status).toBe(200);
    expect(page.body).toContain("Stato del motore");
    expect(page.body).not.toMatch(/<script>|\son[a-z]+=|style="/u);
    const status = await send(gui, {
      path: "/api/status",
      headers: apiHeaders(gui, cookie),
    });
    expect(status.status).toBe(200);
    expect(JSON.parse(status.body)).toMatchObject({
      engine: {
        product: "InsideApp — PezzaliAPP",
        analysis: {
          local_only: true,
          executes_targets: false,
          gui_analysis_available: false,
        },
        claude: {
          project_mcp_server: "missing",
          mcp_tools: expect.any(Number),
        },
      },
      session: { idle_timeout_seconds: 60 },
    });
  });
});

describe("InsideApp GUI input limits and headers", () => {
  it("refuses malformed, oversized and unexpected requests", async () => {
    const { gui, cookie } = await signedIn();
    const post = (headers: Record<string, string>, body?: string) =>
      send(gui, {
        method: "POST",
        path: "/api/session",
        headers: { ...apiHeaders(gui, cookie), ...headers },
        body,
      });
    expect(
      (
        await post(
          { "Content-Type": "text/plain", "Content-Length": "2" },
          "{}",
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await post(
          { "Content-Type": "application/json", "Content-Length": "3" },
          "{x}",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          { "Content-Type": "application/json", "Content-Length": "2" },
          "[]",
        )
      ).status,
    ).toBe(400);
    const large = JSON.stringify({ token: "a".repeat(GUI_MAX_BODY_BYTES) });
    expect(
      (
        await post(
          {
            "Content-Type": "application/json",
            "Content-Length": String(large.length),
          },
          large,
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await post(
          {
            "Content-Type": "application/json",
            "Transfer-Encoding": "chunked",
          },
          "{}",
        )
      ).status,
    ).toBe(411);
    expect(
      (
        await send(gui, {
          path: "/api/session",
          headers: apiHeaders(gui, cookie),
        })
      ).status,
    ).toBe(405);
    expect(
      (
        await send(gui, {
          method: "PUT",
          path: "/",
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(405);
    for (const path of [
      "/assets/../package.json",
      "/assets/app.js/../../.mcp.json",
      "/package.json",
      "/.cache/gui",
      "//etc/passwd",
      "/assets/%2e%2e/package.json",
    ])
      expect(
        (await send(gui, { path, headers: { Cookie: cookie } })).status,
        path,
      ).toBe(404);
    expect(
      (
        await send(gui, {
          path: "/",
          headers: { Cookie: cookie, "X-Large": "a".repeat(10_000) },
        })
      ).status,
    ).toBe(431);
  });

  it("sends the security headers on pages, assets and refusals", async () => {
    const { gui, cookie } = await signedIn();
    for (const response of [
      await send(gui, { headers: { Cookie: cookie } }),
      await send(gui, { path: "/assets/app.js" }),
      await send(gui, { path: "/avvio" }),
      await send(gui, { path: "/api/status", headers: apiHeaders(gui) }),
      await send(gui, { path: "/missing" }),
    ]) {
      expect(response.headers["content-security-policy"]).toBe(
        GUI_CONTENT_SECURITY_POLICY,
      );
      expect(response.headers).toMatchObject({
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "referrer-policy": "no-referrer",
        "cache-control": "no-store",
        "cross-origin-opener-policy": "same-origin",
      });
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    }
    expect(GUI_CONTENT_SECURITY_POLICY).not.toMatch(/unsafe|\*|https?:/u);
  });
});

describe("InsideApp GUI shutdown", () => {
  it("stops from the page, expires the cookie and releases the port", async () => {
    const { gui, cookie } = await signedIn();
    const closing = await jsonPost(gui, "/api/shutdown", {}, cookie);
    expect(closing.status).toBe(202);
    expect(String(closing.headers["set-cookie"])).toContain("Max-Age=0");
    await expect(gui.stopped).resolves.toBe("shutdown");
    expect(await refusesConnections(gui)).toBe(true);
  });

  it("stops after the idle timeout and removes an unused launch file", async () => {
    const { gui } = await startGui({ idleTimeoutMs: 150 });
    await expect(gui.stopped).resolves.toBe("idle");
    expect(await refusesConnections(gui)).toBe(true);
    await expect(readdir(dirname(gui.launcher.path))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("stops on cancellation and ends the session", async () => {
    const controller = new AbortController();
    const root = await createTestTempDirectory("rea-insideapp-gui-");
    const gui = await startGuiServer({
      projectRoot: root,
      launcherDirectory: `${root}/.cache/gui`,
      idleTimeoutMs: 60_000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(gui.stopped).resolves.toBe("interrupted");
    await expect(gui.stop("shutdown")).resolves.toBe("interrupted");
    expect(await refusesConnections(gui)).toBe(true);
  });
});
