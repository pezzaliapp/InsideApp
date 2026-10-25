import { describe, expect, it } from "vitest";

import { quoted } from "./reportText.js";

// Built from code points so this source file contains no invisible controls.
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);
const LEFT_TO_RIGHT_ISOLATE = String.fromCodePoint(0x2066);

describe("report quoting", () => {
  it("makes control and bidirectional-override characters visible", () => {
    expect(
      quoted(`a\nb\u0000c${RIGHT_TO_LEFT_OVERRIDE}d${LEFT_TO_RIGHT_ISOLATE}e`),
    ).toBe("«a\\u000ab\\u0000c\\u202ed\\u2066e»");
  });

  it("bounds long names without splitting a surrogate pair", () => {
    const value = `${"x".repeat(159)}${String.fromCodePoint(0x1f600)}tail`;
    expect(quoted(value)).toBe(`«${"x".repeat(159)}…»`);
    expect(quoted("y".repeat(200))).toBe(`«${"y".repeat(160)}…»`);
  });
});
