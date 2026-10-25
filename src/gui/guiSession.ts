import { createGuiSecret, guiSecretsEqual } from "./guiSecurity.js";

/** How long the launch token can be redeemed after the server starts. */
export const GUI_LAUNCH_TOKEN_LIFETIME_MS = 60_000;

export type GuiRedeemOutcome =
  | { readonly ok: true; readonly session: string }
  | { readonly ok: false; readonly reason: "invalid" | "expired" | "used" };

/**
 * One browser session per server start. The launch token is single-use and
 * short-lived; redeeming it yields the only session secret, carried by an
 * HttpOnly cookie that page scripts cannot read.
 */
export class GuiSession {
  readonly launchToken = createGuiSecret();
  readonly #issuedAt: number;
  #session: string | undefined;
  #redeemed = false;

  constructor(now: number) {
    this.#issuedAt = now;
  }

  redeem(candidate: string, now: number): GuiRedeemOutcome {
    if (this.#redeemed) return { ok: false, reason: "used" };
    if (now - this.#issuedAt > GUI_LAUNCH_TOKEN_LIFETIME_MS)
      return { ok: false, reason: "expired" };
    if (!guiSecretsEqual(candidate, this.launchToken))
      return { ok: false, reason: "invalid" };
    this.#redeemed = true;
    this.#session = createGuiSecret();
    return { ok: true, session: this.#session };
  }

  isActive(cookie: string | undefined): boolean {
    return (
      cookie !== undefined &&
      this.#session !== undefined &&
      guiSecretsEqual(cookie, this.#session)
    );
  }

  /** Invalidate the session; later requests are refused even with the cookie. */
  end(): void {
    this.#session = undefined;
    this.#redeemed = true;
  }
}
