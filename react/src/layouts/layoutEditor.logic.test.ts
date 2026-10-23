import { describe, expect, it } from "vitest";
import type { StoredLayout } from "../types";
import {
  addArea,
  addSeries,
  getLayoutError,
  getNextAreaId,
  getSeriesQuantities,
  moveArea,
  moveSeries,
  removeArea,
  removeSeries,
  setCloudProfile,
  toEditableLayout,
  updateAxis,
  updateSeries,
} from "./layoutEditor.logic";
import { getBuiltinLayout, POWER_DEFAULT_LAYOUT_ID } from "./layoutResolution";

const power = () => getBuiltinLayout(POWER_DEFAULT_LAYOUT_ID);
const ids = (layout: { areas: { id: string }[] }) =>
  layout.areas.map((area) => area.id);

const entry = (overrides: Partial<StoredLayout>): StoredLayout => ({
  id: "mine",
  name: "Mine",
  position: 2,
  builtin_id: null,
  fixed: false,
  layout: power(),
  error: null,
  ...overrides,
});

describe("layoutEditor.logic (#142)", () => {
  it("edits a copy carrying the entry's id and name", () => {
    const layout = toEditableLayout(entry({}));
    expect(layout.id).toBe("mine");
    expect(layout.name).toBe("Mine");
    layout.areas[0].heightWeight = 9;
    expect(power().areas[0].heightWeight).toBe(1.15);
  });

  it("starts an invalid stored entry from its built-in layout", () => {
    const fixed = toEditableLayout(
      entry({ fixed: true, layout: { areas: [] }, error: "broken" }),
    );
    expect(fixed.showModelHeaders).toBe(false);
    expect(ids(fixed)).toEqual(["temp", "precip", "wind"]);
    const user = toEditableLayout(entry({ layout: { areas: "x" } }));
    expect(ids(user)).toEqual(["temp", "precip", "wind", "convective"]);
  });

  it("adds areas with unique ids and moves and removes them", () => {
    let layout = addArea(power());
    expect(getNextAreaId(layout)).toBe("area-2");
    layout = addArea(layout);
    expect(ids(layout).slice(-2)).toEqual(["area-1", "area-2"]);
    layout = moveArea(layout, 4, -4);
    expect(ids(layout)[0]).toBe("area-1");
    expect(moveArea(layout, 0, -1)).toEqual(layout);
    layout = removeArea(layout, 0);
    expect(ids(layout)).not.toContain("area-1");
    expect(getLayoutError(layout)).toBeNull();
  });

  it("keeps a legal style and fixes an illegal one on quantity change", () => {
    let layout = updateSeries(power(), 0, 0, { color: "#000000" });
    layout = updateSeries(layout, 0, 0, { quantity: "wind_speed" });
    expect(layout.areas[0].series?.[0]).toMatchObject({
      quantity: "wind_speed",
      style: "line",
    });
    expect(layout.areas[0].series?.[0].color).toBeUndefined();
    layout = updateSeries(layout, 0, 0, { quantity: "cape" });
    expect(layout.areas[0].series?.[0].style).toBe("area");
    expect(getLayoutError(layout)).toBeNull();
  });

  it("adds, moves and removes series", () => {
    let layout = addSeries(power(), 2, "precipitation");
    const series = () => layout.areas[2].series ?? [];
    expect(series().at(-1)).toEqual({
      quantity: "precipitation",
      style: "bars",
    });
    layout = moveSeries(layout, 2, series().length - 1, -1);
    expect(series().at(-2)?.quantity).toBe("precipitation");
    layout = removeSeries(layout, 2, series().length - 2);
    expect(series().map((s) => s.quantity)).not.toContain("precipitation");
  });

  it("adds, edits and removes axes; a fixed range gets bounds", () => {
    let layout = updateAxis(power(), 2, "right", {});
    expect(layout.areas[2].axes?.right).toEqual({ range: "auto" });
    layout = updateAxis(layout, 2, "right", { range: "fixed" });
    expect(layout.areas[2].axes?.right).toMatchObject({ min: 0, max: 100 });
    expect(getLayoutError(layout)).toBeNull();
    layout = updateAxis(layout, 2, "right", { min: 200 });
    expect(getLayoutError(layout)).toContain("min < max");
    layout = updateAxis(layout, 2, "right", null);
    expect(layout.areas[2].axes?.right).toBeNull();
    expect(layout.areas[2].axes?.left?.quantity).toBe("wind_speed");
  });

  it("switches the cloud profile background", () => {
    let layout = setCloudProfile(power(), 0, true);
    expect(layout.areas[0].background).toMatchObject({
      kind: "vertical_cloud_profile",
      enabled: true,
    });
    layout = setCloudProfile(layout, 1, false);
    expect(layout.areas[1].background?.enabled).toBe(false);
    expect(getLayoutError(layout)).toBeNull();
  });

  it("reports invalid heights", () => {
    const layout = {
      ...power(),
      areas: [{ ...power().areas[0], heightWeight: 0 }],
    };
    expect(getLayoutError(layout)).toContain("heightWeight");
  });

  it("offers only quantities with a series style", () => {
    const offered = getSeriesQuantities().map((q) => q.id);
    expect(offered).toContain("temperature");
    expect(offered).toContain("weather_code");
    expect(offered).not.toContain("vertical_cloud_profile");
    expect(offered).not.toContain("cloud_cover_pressure_level");
  });
});
