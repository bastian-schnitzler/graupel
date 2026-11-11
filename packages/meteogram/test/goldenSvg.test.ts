// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// @vitest-environment jsdom
/**
 * The renderer draws the reference picture: for each fixture the SVG equals
 * the reference SVG (`fixtures/*.old.svg`),
 * apart from the two layer groups, the namespace declaration and the
 * intended changes of REQ-442 (apparent temperature and wind gusts in the
 * colour of temperature and wind speed, dashed finer than before) and
 * REQ-510 (the elevation label above the areas, with a halo), REQ-569 (the
 * terrain line above the areas as well), and the hooks on
 * the day labels (class and day, REQ-559). In the zoomed fixture
 * the wind arrows differ too: at most one per data point (REQ-571).
 * Dashed lines are drawn in pieces between anchor times, each with a whole
 * number of dash periods, and only where visible (REQ-572, REQ-579).
 * The axes of wind, precipitation and temperature take fixed steps since
 * REQ-590, REQ-591 and REQ-592; this comparison draws with
 * the reference axis rules (mocked below), `axisSteps.test.ts` covers the new ones.
 * Since REQ-594 the first area has a top border and the zero-degree
 * line its own colour; the comparison removes the border and recolours the line.
 * Since REQ-603 the zero-degree line has a label; the comparison
 * removes it (`axisLabels.test.ts` covers it), as well as the guide line at half the wind axis and its label of
 * REQ-653 (`midLine.test.ts`). Both fixtures draw with the default
 * `axisLabels`, so the label offsets of REQ-602 and REQ-622 (over the plot only) do not apply.
 * Since REQ-695 the run in a split model header has no month ("15 Z00" instead of "10/15Z00");
 * the comparison writes the reference runs in the new form (both runs of the fixture lie on one day).
 * Since REQ-747 a halo is its own element behind its label; the comparison folds it back into the text.
 */
import { describe, expect, it, vi } from "vitest";
import { LIGHT_THEME } from "../src/core/theme";
import { PAIRED_SERIES_DASH_ARRAY } from "../src/layouts/seriesPresets";
import { meteogramToSvgString } from "../src/render/meteogram";
import { createMeteogramScene } from "../src/render/scene";
import { FIXTURES } from "./fixtures/meteogramFixtures";
import normalOld from "./fixtures/normal.old.svg?raw";
import powerOld from "./fixtures/power.old.svg?raw";

vi.mock("../src/layouts/seriesPresets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/layouts/seriesPresets")>();
  type AxisPreset = import("../src/layouts/seriesPresets").AxisPreset;
  const oldMm = (value: number) => (value < 1 ? value.toFixed(2) : value.toFixed(1));
  const OLD_AXES: Record<string, Partial<AxisPreset>> = {
    temperature: {
      auto: (rawMin, rawMax) => {
        const low = rawMin ?? 0;
        const high = rawMax ?? 20;
        let min = Math.floor(low - 2);
        let max = Math.ceil(high + 2);
        if (low <= 15 && min > 0) min = 0;
        if (high >= -15 && max < 0) max = 0;
        return [min, max];
      },
    },
    wind: { zeroBasedMax: (max) => (max === null ? 50 : Math.max(30, Math.ceil(max * 1.15))) },
    precipitation: {
      zeroBasedMax: (max) => (max !== null && max > 0 ? max / 0.8 : 2.5),
      formatMax: oldMm,
    },
  };
  const group: Record<string, string> = {
    temperature: "temperature",
    apparent_temperature: "temperature",
    wind_speed: "wind",
    wind_gusts: "wind",
    precipitation: "precipitation",
    precipitation_rain_snow: "precipitation",
  };
  return {
    ...actual,
    getAxisPreset: (quantityId: string | null): AxisPreset => {
      const preset = actual.getAxisPreset(quantityId);
      const old = quantityId ? OLD_AXES[group[quantityId] ?? ""] : undefined;
      return old ? { ...preset, ...old } : preset;
    },
    // The built-in layouts name their axis rules since layout version 2 (REQ-663); the reference rules still win.
    axisPresetFor: (
      quantityId: string | null,
      axis: Parameters<typeof actual.axisPresetFor>[1],
    ): AxisPreset => {
      const preset = actual.axisPresetFor(quantityId, axis);
      const old = quantityId ? OLD_AXES[group[quantityId] ?? ""] : undefined;
      return old ? { ...preset, ...old } : preset;
    },
  };
});

/** The reference runs "MM/DDZhh" in the form of REQ-695, "DD Zhh". */
const withRunsWithoutMonth = (markup: string) => markup.replace(/\b\d{2}\/(\d{2})Z(\d{2})\b/g, "$1 Z$2");

const OLD_SVG: Record<string, string> = {
  power: withRunsWithoutMonth(powerOld),
  normal: withRunsWithoutMonth(normalOld),
};

interface Canonical {
  tag: string;
  attrs: [string, string][];
  children: (Canonical | string)[];
}

function canonical(element: Element): Canonical {
  const children: (Canonical | string)[] = [];
  let text = "";
  const flushText = () => {
    if (text.trim() !== "") children.push(text);
    text = "";
  };
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === 3) {
      text += node.nodeValue ?? "";
      continue;
    }
    if (node.nodeType !== 1) continue;
    flushText();
    const child = node as Element;
    // The layer groups are new; their content must match the old chart.
    if (child.localName === "g" && child.hasAttribute("data-layer")) {
      children.push(...canonical(child).children);
      continue;
    }
    children.push(canonical(child));
  }
  flushText();
  return {
    tag: element.localName,
    attrs: Array.from(element.attributes)
      .filter((attr) => attr.name !== "xmlns")
      // New hooks on the day labels, so a page can style one day's label (REQ-559).
      .filter(
        (attr) =>
          !(element.getAttribute("class") === "day-label-text" && (attr.name === "class" || attr.name === "data-day")),
      )
      .map((attr): [string, string] => [attr.name, attr.value])
      .sort(([a], [b]) => a.localeCompare(b)),
    children,
  };
}

function parse(markup: string): Canonical {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  const error = doc.querySelector("parsererror");
  if (error) throw new Error(error.textContent ?? "parse error");
  return canonical(doc.documentElement);
}

/** Attribute changes of REQ-442 and REQ-524 per data-testid (null removes the attribute). */
const PAIRED_CHANGES: Record<string, Record<string, string | null>> = {
  "apparent-temperature-path": {
    stroke: LIGHT_THEME.series.temperature!,
    "stroke-dasharray": PAIRED_SERIES_DASH_ARRAY,
    "stroke-linecap": null,
  },
  "wind-gusts-path": {
    stroke: LIGHT_THEME.series.wind_speed!,
    "stroke-dasharray": PAIRED_SERIES_DASH_ARRAY,
  },
  "wind-gusts-stops-path": { stroke: LIGHT_THEME.series.wind_speed! },
  // REQ-524: model boundaries as thin solid lines.
  "model-boundary-line": {
    "stroke-width": "1",
    "stroke-dasharray": null,
    opacity: String(LIGHT_THEME.modelHeader.boundaryOpacity),
  },
  "cloud-model-boundary-line": { "stroke-dasharray": null },
  // REQ-594: zero-degree line in its own colour, fully opaque.
  "freezing-line": { stroke: LIGHT_THEME.grid.freezingLine, opacity: null },
};

/** The reference chart with the intended changes of REQ-442 applied. */
function withPairedChanges(node: Canonical): Canonical {
  const testId = node.attrs.find(([name]) => name === "data-testid")?.[1];
  const changes = testId ? PAIRED_CHANGES[testId] : undefined;
  let attrs = node.attrs;
  if (changes) {
    const merged = new Map(attrs);
    for (const [name, value] of Object.entries(changes)) {
      if (value === null) merged.delete(name);
      else merged.set(name, value);
    }
    attrs = [...merged].sort(([a], [b]) => a.localeCompare(b));
  }
  return {
    ...node,
    attrs,
    children: node.children.map((child) =>
      typeof child === "string" ? child : withPairedChanges(child),
    ),
  };
}

const isHaloGroup = (child: Canonical | string): child is Canonical =>
  typeof child !== "string" &&
  child.tag === "g" &&
  child.attrs.some(([name, value]) => name === "class" && value === "label-halo");

/**
 * Undoes REQ-747: a label with its halo as its own element (group of the stroked copy and the filled text)
 * becomes one text again whose stroke lies behind its fill (`paint-order: stroke`), as the reference draws it.
 */
function withHaloInText(node: Canonical): Canonical {
  return {
    ...node,
    children: node.children.map((child) => {
      if (typeof child === "string") return child;
      if (!isHaloGroup(child)) return withHaloInText(child);
      const [halo, text] = child.children.filter((part): part is Canonical => typeof part !== "string");
      const stroke = halo!.attrs.filter(([name]) => ["stroke", "stroke-width", "stroke-linejoin"].includes(name));
      const attrs = [...text!.attrs, ...stroke, ["paint-order", "stroke"] as [string, string]].sort(([x], [y]) =>
        x.localeCompare(y),
      );
      return { ...text!, attrs };
    }),
  };
}

/** Attributes REQ-510 adds to the elevation label (its halo). */
const TERRAIN_LABEL_HALO = ["stroke", "stroke-width", "paint-order", "stroke-linejoin"];

/**
 * Undoes REQ-510 and REQ-569 on the new chart: the terrain line and the
 * elevation label go back from their own group after the areas into the
 * terrain mask group, the line without its test id, the label without its halo.
 */
function withTerrainLabelInMask(svg: Canonical): Canonical {
  const isLabelGroup = (child: Canonical | string): child is Canonical =>
    typeof child !== "string" &&
    child.attrs.some(([name, value]) => name === "class" && value === "terrain-mask-label-group");
  const group = svg.children.find(isLabelGroup);
  if (!group) return svg;
  const parts = group.children.filter((child): child is Canonical => typeof child !== "string");
  const line = parts.find((child) => child.tag === "line")!;
  const label = parts.find((child) => child.tag === "text")!;
  const plainLine = { ...line, attrs: line.attrs.filter(([name]) => name !== "data-testid") };
  const plainLabel = {
    ...label,
    attrs: label.attrs.filter(([name]) => !TERRAIN_LABEL_HALO.includes(name)),
  };
  const insert = (node: Canonical): Canonical => ({
    ...node,
    children: node.children
      .filter((child) => !isLabelGroup(child))
      .map((child) => {
        if (typeof child === "string") return child;
        const isMask = child.attrs.some(([name, value]) => name === "data-testid" && value === "terrain-mask");
        return isMask ? { ...child, children: [...child.children, plainLine, plainLabel] } : insert(child);
      }),
  });
  return insert(svg);
}

const isWindArrow = (child: Canonical | string) =>
  typeof child !== "string" &&
  child.attrs.some(([name, value]) => name === "data-testid" && value === "wind-arrow-group");

/** The chart without its wind arrows (REQ-571 changes them in the zoomed fixture). */
function withoutWindArrows(node: Canonical): Canonical {
  return {
    ...node,
    children: node.children
      .filter((child) => !isWindArrow(child))
      .map((child) => (typeof child === "string" ? child : withoutWindArrows(child))),
  };
}

const attrOf = (node: Canonical, name: string) => node.attrs.find(([key]) => key === name)?.[1];
const DASHED_TEST_IDS = ["apparent-temperature-path", "wind-gusts-path"];

/**
 * Undoes REQ-579: the pieces of a dashed line (paths with `pathLength`) joined
 * into one path again; a piece starting where the previous one ends continues
 * it, one after a gap starts a new subpath.
 */
function withJoinedDashPieces(node: Canonical): Canonical {
  const children: (Canonical | string)[] = [];
  let previousPiece: Canonical | null = null;
  for (const child of node.children) {
    if (typeof child === "string") {
      children.push(child);
      previousPiece = null;
      continue;
    }
    const joined = withJoinedDashPieces(child);
    if (joined.tag !== "path" || attrOf(joined, "pathLength") === undefined) {
      children.push(joined);
      previousPiece = null;
      continue;
    }
    const piece = { ...joined, attrs: joined.attrs.filter(([name]) => name !== "pathLength") };
    if (previousPiece && attrOf(previousPiece, "data-testid") === attrOf(piece, "data-testid")) {
      const previousD = attrOf(previousPiece, "d")!;
      const d = attrOf(piece, "d")!;
      const start = /^M (\S+ \S+)/.exec(d)![1]!;
      const rest = previousD.endsWith(` ${start}`) ? d.slice(`M ${start}`.length) : d;
      previousPiece.attrs = previousPiece.attrs.map(([name, value]): [string, string] =>
        name === "d" ? [name, previousD + rest] : [name, value],
      );
      continue;
    }
    children.push(piece);
    previousPiece = piece;
  }
  return { ...node, children };
}

/**
 * Leaves out the parts of the reference's dashed lines that the new chart does
 * not draw, outside the visible window (REQ-579): its path becomes the new
 * one when that is a contiguous run of its vertices.
 */
function withDashedPathsAsDrawn(expected: Canonical, actual: Canonical): Canonical {
  const testId = attrOf(expected, "data-testid");
  let attrs = expected.attrs;
  if (expected.tag === "path" && testId && DASHED_TEST_IDS.includes(testId) && attrOf(actual, "data-testid") === testId) {
    const drawn = attrOf(actual, "d")!;
    // Commands with their points ("M 50.0 372.5", "L 62.5 368.6", …); the first drawn one may continue old's line.
    const commands = (d: string) => d.replace(/M/g, " M").trim().split(/ (?=[ML] )/);
    const old = commands(attrOf(expected, "d")!);
    const [first, ...rest] = commands(drawn);
    const from = old.findIndex((command) => command.slice(2) === first!.slice(2));
    if (from >= 0 && JSON.stringify(old.slice(from + 1, from + 1 + rest.length)) === JSON.stringify(rest)) {
      attrs = attrs.map(([name, value]): [string, string] => (name === "d" ? [name, drawn] : [name, value]));
    }
  }
  return {
    ...expected,
    attrs,
    children: expected.children.map((child, index) => {
      const other = actual.children[index];
      return typeof child === "string" || other === undefined || typeof other === "string"
        ? child
        : withDashedPathsAsDrawn(child, other);
    }),
  };
}

const isFirstAreaTopBorder = (child: Canonical | string) =>
  typeof child !== "string" &&
  child.attrs.some(([name, value]) => name === "data-testid" && value === "chart-area-horizontal-border") &&
  child.attrs.some(([name, value]) => name === "data-edge" && value === "temperature-top");

/** Undoes REQ-594: the chart without the top border of its first area. */
function withoutFirstAreaTopBorder(node: Canonical): Canonical {
  return {
    ...node,
    children: node.children
      .filter((child) => !isFirstAreaTopBorder(child))
      .map((child) => (typeof child === "string" ? child : withoutFirstAreaTopBorder(child))),
  };
}

const isZeroLabel = (child: Canonical | string) =>
  typeof child !== "string" &&
  child.tag === "text" &&
  child.attrs.some(([name, value]) => name === "data-testid" && value === "axis-zero");

/**
 * Undoes REQ-603: the chart without the label of its zero-degree line. Only that one label goes; the
 * maximum and minimum it may replace stay in the comparison, so a label wrongly left out still fails it.
 */
function withoutZeroLabel(node: Canonical): Canonical {
  return {
    ...node,
    children: node.children
      .filter((child) => !isZeroLabel(child))
      .map((child) => (typeof child === "string" ? child : withoutZeroLabel(child))),
  };
}

const isMidLine = (child: Canonical | string) =>
  typeof child !== "string" &&
  child.attrs.some(
    ([name, value]) => name === "data-testid" && (value === "wind-mid-line" || value === "axis-mid"),
  );

/** Undoes REQ-653: the chart without the guide line at half the wind axis and its label. */
function withoutMidLine(node: Canonical): Canonical {
  return {
    ...node,
    children: node.children
      .filter((child) => !isMidLine(child))
      .map((child) => (typeof child === "string" ? child : withoutMidLine(child))),
  };
}

/** Path and description of the first difference, or null. */
function firstDifference(
  actual: Canonical | string,
  expected: Canonical | string,
  path = "svg",
): string | null {
  if (typeof actual === "string" || typeof expected === "string") {
    return actual === expected
      ? null
      : `${path}: ${JSON.stringify(actual).slice(0, 200)} != ${JSON.stringify(expected).slice(0, 200)}`;
  }
  if (actual.tag !== expected.tag) return `${path}: <${actual.tag}> != <${expected.tag}>`;
  const actualAttrs = JSON.stringify(actual.attrs);
  const expectedAttrs = JSON.stringify(expected.attrs);
  if (actualAttrs !== expectedAttrs) {
    return `${path}: attributes\n  new ${actualAttrs}\n  old ${expectedAttrs}`;
  }
  const count = Math.max(actual.children.length, expected.children.length);
  for (let index = 0; index < count; index++) {
    const a = actual.children[index];
    const b = expected.children[index];
    const childPath = `${path}/${typeof b === "object" ? b.tag : typeof a === "object" ? a.tag : "#text"}[${index}]`;
    if (a === undefined || b === undefined) {
      return `${childPath}: ${a === undefined ? "missing in new" : "extra in new"}`;
    }
    const difference = firstDifference(a, b, childPath);
    if (difference) return difference;
  }
  return null;
}

describe("SVG equals the reference chart", () => {
  for (const [name, { input, options }] of Object.entries(FIXTURES)) {
    it(`fixture ${name}`, () => {
      const expected = withPairedChanges(parse(OLD_SVG[name]!));
      // The reference always draws the cloud-chain boundaries; since REQ-524 only on request. Its axes spanned all data
      // also when zoomed; since REQ-655 the precipitation and wind axes follow the visible range unless switched off.
      const markup = meteogramToSvgString(input, { ...options, showCloudBoundaries: true, scaleToVisibleRange: false });
      const actual = withoutMidLine(
        withoutZeroLabel(withoutFirstAreaTopBorder(withJoinedDashPieces(withTerrainLabelInMask(withHaloInText(parse(markup)))))),
      );
      const compare = name === "normal" ? withoutWindArrows : (node: Canonical) => node;
      expect(firstDifference(compare(actual), compare(withDashedPathsAsDrawn(expected, actual)))).toBeNull();
    });
  }

  /** Pieces of the dashed lines (REQ-579): path data and dash length per piece. */
  const dashPieces = (markup: string, testId: string) => {
    const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
    return [...doc.querySelectorAll(`[data-testid="${testId}"]`)].map((path) => ({
      d: path.getAttribute("d")!,
      pathLength: Number(path.getAttribute("pathLength")),
    }));
  };

  it("dashed lines are drawn in pieces between anchors, each with whole dash periods (REQ-579)", () => {
    const { input, options } = FIXTURES.power;
    const markup = meteogramToSvgString(input, options);
    const scene = createMeteogramScene(input, options);
    // Three days over the plot: an hour is 12.5 units, anchors every 2 hours.
    const hourOf = (x: number) => Math.round(scene.timeline.xToTimestamp(x) / 3_600_000);
    for (const testId of DASHED_TEST_IDS) {
      const pieces = dashPieces(markup, testId);
      expect(pieces.length).toBeGreaterThan(10);
      for (const { d, pathLength } of pieces) {
        expect(d.match(/M/g)).toHaveLength(1);
        expect(Number.isInteger(pathLength / 4) && pathLength >= 16).toBe(true);
      }
      const starts = pieces.slice(1).map(({ d }) => hourOf(Number(/^M (\S+)/.exec(d)![1])));
      expect(starts.filter((hour) => hour % 2 !== 0)).toEqual(
        // The gusts resume after their gap at 23 h (the start of a subpath, not an anchor).
        testId === "wind-gusts-path" ? [Math.round(Date.UTC(2026, 9, 15, 23) / 3_600_000)] : [],
      );
    }
  });

  it("a moved model boundary moves only the dashes of the pieces whose data change (REQ-572)", () => {
    const { input, options } = FIXTURES.power;
    const boundary = Date.UTC(2026, 9, 16, 12);
    // From 30 h on (instead of 36 h) the values of a warmer model.
    const moved = {
      ...input,
      series: input.series.map((point) =>
        point.variable === "apparent_temperature" &&
        Date.parse(point.timestamp) >= boundary - 6 * 3_600_000 &&
        Date.parse(point.timestamp) < boundary
          ? { ...point, value: point.value! + 1.5 }
          : point,
      ),
    };
    const key = ({ d, pathLength }: { d: string; pathLength: number }) => `${pathLength}|${d}`;
    const before = dashPieces(meteogramToSvgString(input, options), "apparent-temperature-path").map(key);
    const after = dashPieces(meteogramToSvgString(moved, options), "apparent-temperature-path").map(key);
    expect(after).toHaveLength(before.length);
    // Hours 30 to 35 change, so the line from 29 h to 36 h: the pieces 28-30, 30-32, 32-34 and 34-36 h.
    const changed = after.filter((piece) => !before.includes(piece));
    expect(changed).toHaveLength(4);
    expect(after.filter((piece) => before.includes(piece))).toHaveLength(before.length - 4);
  });

  it("the zoomed fixture has at most one wind arrow per hourly data point (REQ-571)", () => {
    const { input, options } = FIXTURES.normal;
    const markup = meteogramToSvgString(input, options);
    const arrows = [...markup.matchAll(/data-testid="wind-arrow-group" data-timestamp="([^"]+)"/g)];
    const hours = (options.visibleRange!.end - options.visibleRange!.start) / 3_600_000;
    expect(arrows.length).toBeLessThanOrEqual(hours);
    // The reference draws more arrows than data points here.
    expect([...OLD_SVG.normal!.matchAll(/data-testid="wind-arrow-group"/g)].length).toBeGreaterThan(hours);
  });

  it("applies exactly the paired changes to the reference chart", () => {
    const old = parse(OLD_SVG.power!);
    const changed = withPairedChanges(old);
    const differences: string[] = [];
    const walk = (a: Canonical, b: Canonical) => {
      if (JSON.stringify(a.attrs) !== JSON.stringify(b.attrs)) {
        differences.push(b.attrs.find(([name]) => name === "data-testid")?.[1] ?? "?");
      }
      a.children.forEach((child, index) => {
        const other = b.children[index]!;
        if (typeof child !== "string" && typeof other !== "string") walk(child, other);
      });
    };
    walk(old, changed);
    expect(new Set(differences)).toEqual(
      new Set([
        "apparent-temperature-path",
        "wind-gusts-path",
        "wind-gusts-stops-path",
        "model-boundary-line",
        "cloud-model-boundary-line",
        "freezing-line",
      ]),
    );
  });

  it("the comparison leaves out exactly the label of the zero-degree line (REQ-603)", () => {
    const { input, options } = FIXTURES.power;
    const svg = parse(meteogramToSvgString(input, { ...options, showCloudBoundaries: true }));
    const count = (node: Canonical, match: (child: Canonical) => boolean): number =>
      (match(node) ? 1 : 0) +
      node.children.reduce((sum, child) => sum + (typeof child === "string" ? 0 : count(child, match)), 0);
    const isText = (node: Canonical) => node.tag === "text";
    expect(count(svg, isZeroLabel)).toBe(1);
    expect(count(withoutZeroLabel(svg), isZeroLabel)).toBe(0);
    expect(count(withoutZeroLabel(svg), isText)).toBe(count(svg, isText) - 1);
  });

  it("the comparison notices a changed colour, a missing node and a changed text", () => {
    const { input, options } = FIXTURES.power;
    const markup = meteogramToSvgString(input, options);
    const original = parse(markup);
    expect(
      firstDifference(parse(markup.replace('fill="#f59e0b"', 'fill="#f59e0c"')), original),
    ).toContain("attributes");
    expect(
      firstDifference(parse(markup.replace(/<rect [^>]*data-testid="precip-bar"[^>]*\/>/, "")), original),
    ).not.toBeNull();
    expect(
      firstDifference(parse(markup.replace(">D2 (15 Z00)<", ">D2<")), original),
    ).toContain("D2");
  });
});
