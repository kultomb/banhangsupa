import { describe, expect, it } from "vitest";
import { parseIncomingTransferAmount } from "./payment-incoming-amount";

describe("parseIncomingTransferAmount", () => {
  it("parses VN thousands with dots", () => {
    expect(parseIncomingTransferAmount("99.000")).toBe(99000);
    expect(parseIncomingTransferAmount("1.234.567")).toBe(1234567);
  });
  it("parses plain integers and numbers", () => {
    expect(parseIncomingTransferAmount("99000")).toBe(99000);
    expect(parseIncomingTransferAmount(99000)).toBe(99000);
    expect(parseIncomingTransferAmount(99000.4)).toBe(99000);
  });
  it("returns 0 for empty", () => {
    expect(parseIncomingTransferAmount("")).toBe(0);
    expect(parseIncomingTransferAmount(null)).toBe(0);
  });
});
