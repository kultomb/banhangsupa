import { afterEach, describe, expect, it, vi } from "vitest";

import { getDbProvider } from "./provider";

describe("getDbProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to firebase", () => {
    vi.stubEnv("NEXT_PUBLIC_DB_PROVIDER", "");
    expect(getDbProvider()).toBe("firebase");
  });

  it("returns supabase when set", () => {
    vi.stubEnv("NEXT_PUBLIC_DB_PROVIDER", "supabase");
    expect(getDbProvider()).toBe("supabase");
  });

  it("is case-insensitive", () => {
    vi.stubEnv("NEXT_PUBLIC_DB_PROVIDER", "SupaBase");
    expect(getDbProvider()).toBe("supabase");
  });
});
