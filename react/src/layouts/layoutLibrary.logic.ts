/**
 * Meteogram configurations (layout library, system.md §4.3, #168).
 *
 * The backend (`Storage.*_layout`) owns the rules; the functions below mirror
 * them for the browser fallback without a bridge and choose the layout
 * Meteogram view draws.
 */
import type { AppMode, MeteogramConfig, StoredLayout } from "../types";
import { BUILTIN_LAYOUTS } from "./builtinLayouts.generated";
import {
  NORMAL_LAYOUT_ID,
  POWER_DEFAULT_LAYOUT_ID,
  validateChartLayout,
} from "./layoutResolution";
import type { ChartLayout } from "./types";

/**
 * Fixed first entry, the default layout (#203): normal mode, the Auto entry
 * and every configuration without its own `layout_id` draw it.
 */
export const DEFAULT_LAYOUT_ID = "default";
export const DEFAULT_LAYOUT_NAME = "Default";

function builtinCopy(builtinId: string): ChartLayout {
  const layout =
    BUILTIN_LAYOUTS.find((entry) => entry.id === builtinId) ??
    BUILTIN_LAYOUTS.find((entry) => entry.id === POWER_DEFAULT_LAYOUT_ID)!;
  return JSON.parse(JSON.stringify(layout)) as ChartLayout;
}

function entry(
  id: string,
  name: string,
  layout: ChartLayout,
  builtinId: string | null,
): StoredLayout {
  return {
    id,
    name,
    position: 0,
    builtin_id: builtinId,
    fixed: id === DEFAULT_LAYOUT_ID,
    layout: { ...layout, id, name },
    error: null,
  };
}

function numbered(layouts: StoredLayout[]): StoredLayout[] {
  return layouts.map((layout, position) => ({ ...layout, position }));
}

/** Library of a fresh installation: Default, Power default. */
export function seedLayoutLibrary(): StoredLayout[] {
  return numbered([
    entry(
      DEFAULT_LAYOUT_ID,
      DEFAULT_LAYOUT_NAME,
      builtinCopy(NORMAL_LAYOUT_ID),
      NORMAL_LAYOUT_ID,
    ),
    entry(
      POWER_DEFAULT_LAYOUT_ID,
      "Power default",
      builtinCopy(POWER_DEFAULT_LAYOUT_ID),
      POWER_DEFAULT_LAYOUT_ID,
    ),
  ]);
}

/** Whether a layout may be deleted: every entry but Default. */
export function canDeleteLayout(layouts: StoredLayout[], id: string): boolean {
  return id !== DEFAULT_LAYOUT_ID && layouts.some((layout) => layout.id === id);
}

/** First unused "New layout N" name. */
export function getNextLayoutName(layouts: StoredLayout[]): string {
  const used = new Set(layouts.map((layout) => layout.name.trim()));
  let n = 1;
  while (used.has(`New layout ${n}`)) n += 1;
  return `New layout ${n}`;
}

/** Insert `layout` at `position` (never before Default; default: end). */
export function insertLayout(
  layouts: StoredLayout[],
  layout: StoredLayout,
  position?: number,
): StoredLayout[] {
  const index =
    position === undefined
      ? layouts.length
      : Math.min(layouts.length, Math.max(1, position));
  const next = [...layouts];
  next.splice(index, 0, layout);
  return numbered(next);
}

export function createLibraryEntry(
  id: string,
  name: string,
  layout?: unknown,
): StoredLayout {
  const source =
    layout && typeof layout === "object"
      ? (JSON.parse(JSON.stringify(layout)) as ChartLayout)
      : builtinCopy(POWER_DEFAULT_LAYOUT_ID);
  return entry(id, name.trim(), source, null);
}

/** Copy of `source` (its built-in when the stored layout is invalid). */
export function duplicateLibraryEntry(
  id: string,
  source: StoredLayout,
): StoredLayout {
  const layout =
    source.error || !source.layout
      ? builtinCopy(source.builtin_id ?? POWER_DEFAULT_LAYOUT_ID)
      : source.layout;
  return createLibraryEntry(id, `${source.name} (copy)`, layout);
}

/** Apply a rename and/or a new layout; the Default entry keeps its name. */
export function updateLibraryEntry(
  layouts: StoredLayout[],
  id: string,
  changes: { name?: string; layout?: unknown },
): StoredLayout[] {
  return layouts.map((layout) => {
    if (layout.id !== id) return layout;
    const name = changes.name?.trim();
    if (name !== undefined && !name) {
      throw new Error("layout name must not be empty");
    }
    if (layout.fixed && name !== undefined && name !== layout.name) {
      throw new Error("the Default entry cannot be renamed");
    }
    const newName = name ?? layout.name;
    const body =
      changes.layout !== undefined
        ? (changes.layout as ChartLayout)
        : (layout.layout as ChartLayout);
    if (changes.layout !== undefined) {
      // Same rule as the backend: an invalid layout is never stored.
      const [problem] = validateChartLayout({ ...body, id, name: newName });
      if (problem) throw new Error(`invalid layout: ${problem}`);
    }
    return {
      ...layout,
      name: newName,
      layout: body ? { ...body, id, name: newName } : body,
      error: changes.layout !== undefined ? null : layout.error,
    };
  });
}

export function resetLibraryEntry(
  layouts: StoredLayout[],
  id: string,
): StoredLayout[] {
  const target = layouts.find((layout) => layout.id === id);
  if (!target?.builtin_id) {
    throw new Error("only built-in entries can be reset");
  }
  return updateLibraryEntry(layouts, id, {
    layout: builtinCopy(target.builtin_id),
  });
}

/** Default first, then `orderedIds`, then entries left out. */
export function reorderLibrary(
  layouts: StoredLayout[],
  orderedIds: string[],
): StoredLayout[] {
  const byId = new Map(layouts.map((layout) => [layout.id, layout]));
  const order = [DEFAULT_LAYOUT_ID, ...orderedIds].filter(
    (id, index, all) => byId.has(id) && all.indexOf(id) === index,
  );
  for (const layout of layouts) {
    if (!order.includes(layout.id)) order.push(layout.id);
  }
  return numbered(order.map((id) => byId.get(id)!));
}

export interface LayoutDeletion {
  layouts: StoredLayout[];
  /** Configurations whose `layout_id` was reset to the default (null). */
  configs: MeteogramConfig[];
}

export function deleteLibraryEntry(
  layouts: StoredLayout[],
  configs: MeteogramConfig[],
  id: string,
): LayoutDeletion {
  if (!canDeleteLayout(layouts, id)) {
    throw new Error(
      id === DEFAULT_LAYOUT_ID
        ? "the Default entry cannot be deleted"
        : `unknown layout ${id}`,
    );
  }
  return {
    layouts: numbered(layouts.filter((layout) => layout.id !== id)),
    configs: configs.map((config) =>
      config.layout_id === id ? { ...config, layout_id: null } : config,
    ),
  };
}

export interface LayoutChoice {
  /** Layout to draw; null draws the fallback built-in. */
  chartLayout: unknown;
  /** Built-in drawn without or instead of an invalid `chartLayout`. */
  fallbackLayoutId: string;
  /** Library entry the layout comes from (null: none stored). */
  layoutId: string | null;
}

/**
 * Layout Meteogram view draws (#203): power mode the configuration's
 * `layout_id`; everything else (normal mode, Auto entry, no or an unknown
 * `layout_id`) the Default entry. Missing entries draw their built-in.
 */
export function chooseChartLayout(
  layouts: StoredLayout[],
  mode: AppMode,
  config: Pick<MeteogramConfig, "layout_id"> | null,
): LayoutChoice {
  const byId = (id: string | null | undefined) =>
    id ? layouts.find((layout) => layout.id === id) : undefined;
  const chosen =
    (mode === "power" ? byId(config?.layout_id) : undefined) ??
    byId(DEFAULT_LAYOUT_ID);
  if (!chosen) {
    return {
      chartLayout: null,
      fallbackLayoutId: NORMAL_LAYOUT_ID,
      layoutId: null,
    };
  }
  return {
    chartLayout: chosen.layout,
    fallbackLayoutId: chosen.builtin_id ?? POWER_DEFAULT_LAYOUT_ID,
    layoutId: chosen.id,
  };
}

/**
 * Id order after dragging entry `sourceIndex` onto `targetIndex`; null when
 * the move is a no-op or touches the fixed first entry.
 */
export function moveLayoutIds(
  layouts: StoredLayout[],
  sourceIndex: number,
  targetIndex: number,
): string[] | null {
  if (
    !Number.isInteger(sourceIndex) ||
    sourceIndex === targetIndex ||
    sourceIndex < 1 ||
    targetIndex < 1 ||
    sourceIndex >= layouts.length ||
    targetIndex >= layouts.length
  ) {
    return null;
  }
  const ids = layouts.map((layout) => layout.id);
  const [moved] = ids.splice(sourceIndex, 1);
  ids.splice(targetIndex, 0, moved);
  return ids;
}
