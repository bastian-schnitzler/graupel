import { describe, expect, it } from "vitest";
import type { MeteogramConfig, StoredLayout } from "../types";
import {
  DEFAULT_LAYOUT_ID,
  canDeleteLayout,
  chooseChartLayout,
  createLibraryEntry,
  deleteLibraryEntry,
  duplicateLibraryEntry,
  getNextLayoutName,
  insertLayout,
  moveLayoutIds,
  reorderLibrary,
  resetLibraryEntry,
  seedLayoutLibrary,
  updateLibraryEntry,
} from "./layoutLibrary.logic";
import { NORMAL_LAYOUT_ID, POWER_DEFAULT_LAYOUT_ID } from "./layoutResolution";
import type { ChartLayout } from "./types";

const ids = (layouts: StoredLayout[]) => layouts.map((layout) => layout.id);

function withOwn(): StoredLayout[] {
  return insertLayout(seedLayoutLibrary(), createLibraryEntry("own", "Own"));
}

const config = (layout_id?: string | null): MeteogramConfig => ({
  id: "cfg",
  name: "Alpen",
  location: { name: "Innsbruck", latitude: 47.26, longitude: 11.39 },
  model_chain: [],
  layout_id,
});

describe("layout library (spec §4.3)", () => {
  it("seeds Default first and Power default", () => {
    const library = seedLayoutLibrary();
    expect(ids(library)).toEqual([DEFAULT_LAYOUT_ID, "power-default"]);
    expect(library[0]).toMatchObject({
      name: "Default",
      fixed: true,
      builtin_id: NORMAL_LAYOUT_ID,
      position: 0,
    });
    expect((library[0].layout as ChartLayout).showModelHeaders).toBe(false);
  });

  it("deletes every entry but Default (#203)", () => {
    const seeded = seedLayoutLibrary();
    expect(canDeleteLayout(seeded, DEFAULT_LAYOUT_ID)).toBe(false);
    expect(canDeleteLayout(seeded, "power-default")).toBe(true);
    expect(canDeleteLayout(seeded, "gone")).toBe(false);
    expect(() => deleteLibraryEntry(seeded, [], DEFAULT_LAYOUT_ID)).toThrow(
      /Default entry cannot be deleted/,
    );
    expect(ids(deleteLibraryEntry(seeded, [], "power-default").layouts)).toEqual(
      [DEFAULT_LAYOUT_ID],
    );
  });

  it("resets configurations using a deleted layout to the default", () => {
    const result = deleteLibraryEntry(
      withOwn(),
      [config("own"), { ...config("power-default"), id: "other" }],
      "own",
    );
    expect(ids(result.layouts)).toEqual([
      DEFAULT_LAYOUT_ID,
      "power-default",
    ]);
    expect(result.configs.map((c) => c.layout_id)).toEqual([
      null,
      "power-default",
    ]);
  });

  it("keeps Default first when inserting and reordering", () => {
    const inserted = insertLayout(
      seedLayoutLibrary(),
      createLibraryEntry("x", "X"),
      0,
    );
    expect(ids(inserted)).toEqual([
      DEFAULT_LAYOUT_ID,
      "x",
      "power-default",
    ]);
    const reordered = reorderLibrary(inserted, [
      "power-default",
      DEFAULT_LAYOUT_ID,
    ]);
    expect(ids(reordered)).toEqual([
      DEFAULT_LAYOUT_ID,
      "power-default",
      "x",
    ]);
    expect(reordered.map((layout) => layout.position)).toEqual([0, 1, 2]);
    expect(moveLayoutIds(reordered, 2, 1)).toEqual([
      DEFAULT_LAYOUT_ID,
      "x",
      "power-default",
    ]);
    expect(moveLayoutIds(reordered, 1, 0)).toBeNull();
    expect(moveLayoutIds(reordered, 0, 2)).toBeNull();
  });

  it("renames, refuses renaming Default and resets built-ins", () => {
    const library = withOwn();
    const renamed = updateLibraryEntry(library, "own", { name: " Mine " });
    expect(renamed[2].name).toBe("Mine");
    expect((renamed[2].layout as ChartLayout).name).toBe("Mine");
    expect(() =>
      updateLibraryEntry(library, DEFAULT_LAYOUT_ID, { name: "X" }),
    ).toThrow(/cannot be renamed/);

    const edited = updateLibraryEntry(library, DEFAULT_LAYOUT_ID, {
      layout: { id: "x", name: "x", areas: [{ id: "temp" }] },
    });
    expect((edited[0].layout as ChartLayout).areas).toHaveLength(1);
    const reset = resetLibraryEntry(edited, DEFAULT_LAYOUT_ID);
    expect((reset[0].layout as ChartLayout).areas).toHaveLength(3);
    expect(() => resetLibraryEntry(library, "own")).toThrow(/built-in/);
  });

  it("duplicates an invalid entry from its built-in", () => {
    const broken: StoredLayout = {
      ...seedLayoutLibrary()[0],
      layout: null,
      error: "invalid",
    };
    const copy = duplicateLibraryEntry("copy", broken);
    expect(copy.name).toBe("Default (copy)");
    expect(copy.fixed).toBe(false);
    expect((copy.layout as ChartLayout).showModelHeaders).toBe(false);
  });

  it("names new layouts with the first free number", () => {
    const library = insertLayout(
      seedLayoutLibrary(),
      createLibraryEntry("a", "New layout 1"),
    );
    expect(getNextLayoutName(library)).toBe("New layout 2");
  });
});

describe("chooseChartLayout (#203)", () => {
  it("draws the Default entry in normal mode, whatever the configuration", () => {
    const library = withOwn();
    const choice = chooseChartLayout(library, "normal", config("own"));
    expect(choice.layoutId).toBe(DEFAULT_LAYOUT_ID);
    expect(choice.fallbackLayoutId).toBe(NORMAL_LAYOUT_ID);
    expect(choice.chartLayout).toBe(library[0].layout);
  });

  it("draws the configuration's layout in power mode, else Default", () => {
    const library = withOwn();
    expect(chooseChartLayout(library, "power", config("own"))).toMatchObject({
      layoutId: "own",
      fallbackLayoutId: POWER_DEFAULT_LAYOUT_ID,
    });
    // No own layout, an unknown one, or the Auto entry (null): Default.
    for (const cfg of [config(null), config("gone"), null]) {
      expect(chooseChartLayout(library, "power", cfg)).toMatchObject({
        layoutId: DEFAULT_LAYOUT_ID,
        fallbackLayoutId: NORMAL_LAYOUT_ID,
      });
    }
  });

  it("draws the normal built-in without a library", () => {
    for (const mode of ["normal", "power"] as const) {
      expect(chooseChartLayout([], mode, config("own"))).toEqual({
        chartLayout: null,
        fallbackLayoutId: NORMAL_LAYOUT_ID,
        layoutId: null,
      });
    }
  });
});
