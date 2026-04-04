import { describe, expect, it } from "vitest";

import { supabaseNotImplemented } from "./stubError";

describe("supabaseNotImplemented", () => {
  it("includes feature name in message", () => {
    const e = supabaseNotImplemented("test.feature");
    expect(e.message).toContain("test.feature");
    expect(e.message).toContain("supabase");
  });
});
