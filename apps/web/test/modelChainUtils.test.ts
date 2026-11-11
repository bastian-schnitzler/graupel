// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Chain helpers: metadata of chain models (REQ-435) and the boundary logic of the chain cards (REQ-481).
 */
import type { ModelAvailability, WeatherModel } from "@graupel/download";
import { describe, expect, it } from "vitest";
import {
  boundaryLimits,
  displayedChain,
  keyDeltaHours,
  mergeMovedChain,
  resetBoundary,
  pointerDeltaHours,
  sameBoundaries,
} from "../src/regions/ModelChain/chain/chainBoundaries.ts";
import {
  capabilityOf,
  getMetaForModel,
  getModelMetadataWithFallback,
  modelLabel,
} from "../src/regions/ModelChain/chain/chainUtils.ts";

const MODELS: Record<string, WeatherModel> = {
  icon_d2: { id: "icon_d2", name: "ICON-D2", max_forecast_horizon_hours: 48, description: "DWD high-res" },
  icon_eu: { id: "icon_eu", name: "ICON-EU", max_forecast_horizon_hours: 120, description: "DWD Europe" },
  gfs_seamless: { id: "gfs_seamless", name: "GFS Seamless", max_forecast_horizon_hours: 384, description: "NOAA GFS" },
};

describe("chain model metadata", () => {
  it("resolves metadata for canonical and legacy alias model names", () => {
    expect(getMetaForModel({ name: "ICON-D2", max_forecast_horizon_hours: 48 }, MODELS)?.id).toBe("icon_d2");
    expect(getMetaForModel({ name: "GFS", max_forecast_horizon_hours: 384 }, MODELS)?.id).toBe("gfs_seamless");
    expect(getMetaForModel({ name: "icon eu", max_forecast_horizon_hours: 1 }, MODELS)?.id).toBe("icon_eu");
    expect(getMetaForModel({ name: "ICON-D2", max_forecast_horizon_hours: 48 })).toBeUndefined();
    expect(getModelMetadataWithFallback({ name: "Unknown", max_forecast_horizon_hours: 24 }).name).toBe("Unknown");
  });

  it("takes the capability from the catalogue, else the model's own end", () => {
    expect(capabilityOf({ id: "icon_d2", name: "ICON-D2", max_forecast_horizon_hours: 30 }, MODELS)).toBe(48);
    expect(capabilityOf({ name: "Other", max_forecast_horizon_hours: 30 }, MODELS)).toBe(30);
  });

  it("labels a model with its short name, else its name", () => {
    expect(modelLabel({ name: "ECMWF IFS HRES 9km", short_name: "IFS HRES", max_forecast_horizon_hours: 1 })).toBe("IFS HRES");
    expect(modelLabel({ name: "ICON-D2", max_forecast_horizon_hours: 1 })).toBe("ICON-D2");
  });
});

describe("boundaries of the chain cards (REQ-481)", () => {
  const chain: WeatherModel[] = [
    { id: "icon_d2", name: "ICON-D2", max_forecast_horizon_hours: 48 },
    { id: "icon_eu", name: "ICON-EU", max_forecast_horizon_hours: 120 },
    { id: "gfs_seamless", name: "GFS Seamless", max_forecast_horizon_hours: 384 },
  ];
  const availability = (hours: Record<string, number | null>): Record<string, ModelAvailability> =>
    Object.fromEntries(
      Object.entries(hours).map(([model, available_hours]) => [model, { model, chain: "main", available_hours }]),
    );

  it("shows each boundary where the model's latest run ends", () => {
    expect(displayedChain(chain)).toEqual(chain);
    expect(displayedChain(chain)).not.toBe(chain);
    const shown = displayedChain(chain, availability({ "ICON-D2": 30, "ICON-EU": null, "GFS Seamless": 400 }));
    expect(shown.map((m) => m.max_forecast_horizon_hours)).toEqual([30, 120, 384]);
    // Boundaries never decrease.
    const odd = displayedChain(chain, availability({ "ICON-EU": 20 }));
    expect(odd.map((m) => m.max_forecast_horizon_hours)).toEqual([48, 48, 384]);
  });

  it("limits a boundary to the hours the run delivers", () => {
    expect(boundaryLimits(MODELS, chain)).toBe(MODELS);
    const limits = boundaryLimits(MODELS, chain, availability({ "ICON-D2": 30, "ICON-EU": 200, "GFS Seamless": null }));
    expect(limits.icon_d2).toMatchObject({ name: "ICON-D2", max_forecast_horizon_hours: 30, max_forecast_hours: 30 });
    // Never beyond the catalogue horizon; without availability the catalogue entry stays.
    expect(limits.icon_eu!.max_forecast_horizon_hours).toBe(120);
    expect(limits.gfs_seamless).toBe(MODELS.gfs_seamless);
    expect(capabilityOf(chain[0]!, limits)).toBe(30);
    expect(MODELS.icon_d2!.max_forecast_horizon_hours).toBe(48);
  });

  it("applies a moved boundary to the requested chain, keeping the boundaries the user did not move", () => {
    const shown = displayedChain(chain, availability({ "ICON-D2": 30 }));
    const moved = shown.map((m, i) => (i === 1 ? { ...m, max_forecast_horizon_hours: 100 } : m));
    expect(mergeMovedChain(chain, shown, moved).map((m) => m.max_forecast_horizon_hours)).toEqual([48, 100, 384]);
    // A boundary moved on the capped chain counts as moved.
    const first = shown.map((m, i) => (i === 0 ? { ...m, max_forecast_horizon_hours: 20 } : m));
    expect(mergeMovedChain(chain, shown, first).map((m) => m.max_forecast_horizon_hours)).toEqual([20, 120, 384]);
    // Chains of another length: the moved chain as it is.
    expect(mergeMovedChain(chain.slice(1), shown, moved)).toEqual(moved);
  });

  it("compares boundaries", () => {
    expect(sameBoundaries(chain, chain.map((m) => ({ ...m })))).toBe(true);
    expect(sameBoundaries(chain, chain.slice(1))).toBe(false);
    expect(sameBoundaries(chain, chain.map((m, i) => (i ? m : { ...m, max_forecast_horizon_hours: 47 })))).toBe(false);
  });

  it("turns a pointer distance into hours over the row width", () => {
    expect(pointerDeltaHours(31, 1000, 384)).toBe(12);
    expect(pointerDeltaHours(-100, 1000, 384)).toBe(-38);
    expect(pointerDeltaHours(50, 500, 100)).toBe(10);
    // Without a measured width as if 1000 px wide; no movement is no change.
    expect(pointerDeltaHours(100, 0, 100)).toBe(10);
    expect(pointerDeltaHours(-1, 1000, 100)).toBe(0);
  });

  it("moves by one hour with the arrows, by 12 with Shift and Page Up/Down", () => {
    expect(keyDeltaHours("ArrowLeft", false)).toBe(-1);
    expect(keyDeltaHours("ArrowDown", false)).toBe(-1);
    expect(keyDeltaHours("ArrowRight", false)).toBe(1);
    expect(keyDeltaHours("ArrowUp", true)).toBe(12);
    expect(keyDeltaHours("ArrowLeft", true)).toBe(-12);
    expect(keyDeltaHours("PageUp", false)).toBe(12);
    expect(keyDeltaHours("PageDown", false)).toBe(-12);
    expect(keyDeltaHours("Home", false)).toBeNull();
    expect(keyDeltaHours("a", false)).toBeNull();
  });

  it("resets one boundary to the auto chain and leaves the other moved boundaries (REQ-498)", () => {
    const moved = chain.map((m, i) => ({ ...m, max_forecast_horizon_hours: [30, 90, 384][i]! }));
    const reset = resetBoundary(moved, chain, 0);
    expect(reset.map((m) => m.max_forecast_horizon_hours)).toEqual([48, 90, 384]);
    expect(moved[0]!.max_forecast_horizon_hours).toBe(30);
    expect(resetBoundary(reset, chain, 1).map((m) => m.max_forecast_horizon_hours)).toEqual([48, 120, 384]);
    expect(sameBoundaries(resetBoundary(reset, chain, 1), chain)).toBe(true);
    // No boundary after the last model, another model at that place in the auto chain: unchanged.
    expect(resetBoundary(moved, chain, 2)).toEqual(moved);
    expect(resetBoundary(moved, chain.slice(1), 0)).toEqual(moved);
  });
});
