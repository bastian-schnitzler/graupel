import { describe, expect, it } from "vitest";
import {
  buildLocationLabel,
  formatGeneratedAt,
  getLocationLabelPlace,
} from "./locationLabel.logic";
import { buildCustomLocation } from "../FullscreenMapPicker.logic";

const zugspitze = {
  name: "Zugspitze",
  latitude: 47.4211,
  longitude: 10.9853,
  elevation: 2962.4,
};

describe("locationLabel.logic", () => {
  it("formats the generation time as a short locale date and time in the given zone", () => {
    expect(formatGeneratedAt("2026-10-16T20:45:00Z", "Europe/Berlin", "de-DE")).toBe(
      "16.10.26, 22:45",
    );
    expect(formatGeneratedAt("2026-10-16T20:45:00Z", "UTC", "en-GB")).toBe(
      "16/10/26, 20:45",
    );
  });

  it("returns null for a missing or invalid generation time", () => {
    expect(formatGeneratedAt(undefined)).toBeNull();
    expect(formatGeneratedAt("not a date")).toBeNull();
  });

  it("falls back to the default zone for an unknown time zone", () => {
    expect(formatGeneratedAt("2026-10-16T20:45:00Z", "Mars/Olympus", "de-DE")).toMatch(
      /^16\.10\.26, \d\d:45$/,
    );
  });

  it("shows GPS coordinates instead of the name for map-picked or unnamed locations", () => {
    expect(getLocationLabelPlace(zugspitze)).toBe("Zugspitze");
    expect(getLocationLabelPlace(buildCustomLocation({ lat: 47.4211, lng: -10.9853 }))).toBe(
      "47.4211° N · 10.9853° W",
    );
    expect(getLocationLabelPlace({ ...zugspitze, name: "  " })).toBe(
      "47.4211° N · 10.9853° E",
    );
  });

  it("shows place, rounded elevation and the generation time in brackets", () => {
    expect(
      buildLocationLabel(zugspitze, "2026-10-16T20:45:00Z", "Europe/Berlin", "de-DE"),
    ).toBe("Zugspitze, 2962 m (16.10.26, 22:45)");
  });

  it("omits unknown generation time and elevation", () => {
    expect(buildLocationLabel({ ...zugspitze, elevation: undefined })).toBe("Zugspitze");
    expect(buildLocationLabel(null)).toBeNull();
  });
});
