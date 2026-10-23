import { describe, it, expect } from "vitest";
import {
  formatConfigOptionLabel,
  getLocationDisplayName,
  normalizeLocationNameOverride,
} from "./configLocation";
import type { MeteogramConfig } from "../types";

const config = (override?: string | null): MeteogramConfig => ({
  id: "alpen",
  name: "Alpen",
  location: { name: "Innsbruck", latitude: 47.26, longitude: 11.39 },
  model_chain: [],
  location_name_override: override,
});

describe("configuration location display name", () => {
  it("prefers the override and falls back to the place name", () => {
    expect(getLocationDisplayName(config("INSB"))).toBe("INSB");
    expect(getLocationDisplayName(config(null))).toBe("Innsbruck");
    expect(getLocationDisplayName(config("  "))).toBe("Innsbruck");
  });

  it("labels dropdown entries with the display name in brackets", () => {
    expect(formatConfigOptionLabel(config("INSB"))).toBe("Alpen (INSB)");
    expect(formatConfigOptionLabel(config())).toBe("Alpen (Innsbruck)");
  });

  it("stores a blank override as none", () => {
    expect(normalizeLocationNameOverride(" INSB ")).toBe("INSB");
    expect(normalizeLocationNameOverride("   ")).toBeNull();
    expect(normalizeLocationNameOverride(undefined)).toBeNull();
  });
});
