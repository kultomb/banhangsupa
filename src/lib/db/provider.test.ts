import { afterEach, describe, expect, it, vi } from "vitest";

import { getDbProvider } from "./provider";

describe("getDbProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns supabase", () => {
    vi.stubEnv("NEXT_PUBLIC_DB_PROVIDER", "");
    expect(getDbProvider()).toBe("supabase");
  });

  it("returns supabase when env says supabase", () => {
    vi.stubEnv("NEXT_PUBLIC_DB_PROVIDER", "supabase");
    expect(getDbProvider()).toBe("supabase");
  });

  it("returns supabase for mixed case env", () => {
    vi.stubEnv("NEXT_PUBLIC_DB_PROVIDER", "SupaBase");
    expect(getDbProvider()).toBe("supabase");
  });
});
