// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The close button of the tablet's full-screen view without a column of its own (REQ-750): in the right corner of the
 * last (rightmost) model header, else before the place name in the row below the chart with a small gap. The header's
 * info button keeps clear of it. Where the corner would overlap the header's heading (the model's name, its info
 * button), the button stands 1 px from the screen's right edge instead (REQ-754).
 */
import { describe, expect, it } from "vitest";
import {
  footerClosePlacement,
  footerCloseSize,
  headerClosePlacement,
  headerCloseReserve,
  headerCloseSize,
  headerHeading,
  lastHeader,
} from "../src/regions/MeteogramPanel/FullscreenClose.tsx";
import { placeInfoButtons, type MeasuredSegment } from "../src/regions/MeteogramPanel/ModelHeaderInfo.tsx";

const box = (left: number, right: number, top = 4, bottom = 37) => ({ left, right, top, bottom });
const ORIGIN = { left: 0, top: 0 };

describe("lastHeader (REQ-750)", () => {
  it("is the rightmost header box, whatever their order", () => {
    const last = box(465, 1194);
    expect(lastHeader([box(0, 245), last, box(245, 465)])).toBe(last);
  });

  it("takes the narrower box when two end together, and none without boxes or of empty ones", () => {
    const narrow = box(1000, 1194);
    expect(lastHeader([box(465, 1194), narrow])).toBe(narrow);
    expect(lastHeader([])).toBeNull();
    expect(lastHeader([box(10, 10), box(0, 100, 20, 20)])).toBeNull();
  });
});

describe("headerClosePlacement (REQ-750)", () => {
  it("stands inside the header in its right corner, as far from its right edge as from its top and bottom", () => {
    const header = box(465, 1194, 3.7, 37.2);
    const placement = headerClosePlacement(header, ORIGIN, "#0f172a");
    expect(placement.where).toBe("header");
    expect(placement.size).toBe(headerCloseSize(33.5));
    expect(placement.size).toBe(23);
    const right = placement.left + placement.size;
    const bottom = placement.top + placement.size;
    expect(placement.left).toBeGreaterThan(header.left);
    expect(right).toBeLessThan(header.right);
    expect(placement.top).toBeGreaterThan(header.top);
    expect(bottom).toBeLessThan(header.bottom);
    expect(header.right - right).toBeCloseTo(placement.top - header.top, 0);
    expect(header.bottom - bottom).toBeCloseTo(placement.top - header.top, 0);
    expect(placement.color).toBe("#0f172a");
  });

  it("is placed relative to the container, and closer to the edge in a narrow header", () => {
    const placement = headerClosePlacement(box(1170, 1194, 10, 44), { left: 100, top: 10 });
    // 34 px high: 24 px icon; 24 px wide: no room at the side.
    expect(placement).toMatchObject({ left: 1070, top: 5, size: 24 });
  });

  it("keeps its size between 12 and 24 px", () => {
    expect(headerCloseSize(10)).toBe(12);
    expect(headerCloseSize(80)).toBe(24);
  });

  it("reserves the button and its margin at the right end of the last header", () => {
    expect(headerCloseReserve(33.5)).toBeCloseTo(23 + 5.25, 6);
  });
});

describe("headerClosePlacement beside the heading (REQ-754)", () => {
  // Tablet upright: 834 px wide, headers 48 px high, "IFS HRES" 118 px wide, centred in the last header.
  const EDGE = 834;
  const header = (left: number) => box(left, EDGE, 5.4, 53.5);
  const label = (shape: { left: number; right: number }) => {
    const centre = (shape.left + shape.right) / 2;
    return box(centre - 59, centre + 59, 12.5, 44.5);
  };
  const xBox = (placement: { left: number; top: number; size: number }) =>
    box(placement.left, placement.left + placement.size, placement.top, placement.top + placement.size);
  const apart = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
    a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;

  it("stays in the corner of a wide header, clear of its heading", () => {
    const wide = header(324.7);
    const placement = headerClosePlacement(wide, ORIGIN, null, { heading: label(wide), edge: EDGE });
    expect(placement).toEqual(headerClosePlacement(wide, ORIGIN));
    expect(placement.atEdge).toBeUndefined();
  });

  it("stands 1 px from the screen's right edge where the corner would overlap the heading", () => {
    const short = header(660);
    const heading = label(short);
    const corner = headerClosePlacement(short, ORIGIN);
    expect(apart(xBox(corner), heading)).toBe(false);
    const placement = headerClosePlacement(short, ORIGIN, null, { heading, edge: EDGE });
    expect(placement).toMatchObject({ where: "header", atEdge: true, top: corner.top, size: 24 });
    expect(EDGE - (placement.left + placement.size)).toBe(1);
    expect(apart(xBox(placement), heading)).toBe(true);
  });

  it("is placed relative to the container at the edge too", () => {
    const short = header(660);
    const placement = headerClosePlacement(short, { left: 34, top: 5 }, null, { heading: label(short), edge: EDGE });
    expect(placement.left).toBe(EDGE - 1 - 24 - 34);
  });

  it("also moves when it would come closer to the heading than 2 px", () => {
    const shape = header(624);
    const corner = headerClosePlacement(shape, ORIGIN);
    const heading = box(600, corner.left - 1, 12.5, 44.5);
    expect(headerClosePlacement(shape, ORIGIN, null, { heading, edge: EDGE }).atEdge).toBe(true);
    const far = box(600, corner.left - 2.5, 12.5, 44.5);
    expect(headerClosePlacement(shape, ORIGIN, null, { heading: far, edge: EDGE }).atEdge).toBeUndefined();
  });

  it("gets smaller at the edge where the room beside the heading is narrower, vertically centred", () => {
    const short = header(680);
    const heading = label(short);
    // The name ends at 816: 15 px are left before the edge's 1 px with 2 px to the name.
    const placement = headerClosePlacement(short, ORIGIN, null, { heading, edge: EDGE });
    expect(placement).toMatchObject({ atEdge: true, size: 15, left: 818 });
    expect(placement.top).toBeCloseTo(5.4 + (48.1 - 15) / 2, 1);
    expect(apart(xBox(placement), heading)).toBe(true);
  });

  it("overlaps the name's end at 12 px where not even that fits, in a header hardly wider than its name", () => {
    const narrow = header(700);
    const heading = label(narrow);
    const placement = headerClosePlacement(narrow, ORIGIN, null, { heading, edge: EDGE });
    expect(placement).toMatchObject({ atEdge: true, size: 12 });
    expect(EDGE - (placement.left + placement.size)).toBe(1);
    expect(apart(xBox(placement), heading)).toBe(false);
  });

  it("keeps the corner without a heading, and never moves left of it", () => {
    const short = header(660);
    expect(headerClosePlacement(short, ORIGIN, null, { heading: null, edge: EDGE })).toEqual(
      headerClosePlacement(short, ORIGIN),
    );
    const corner = headerClosePlacement(short, ORIGIN);
    const placement = headerClosePlacement(short, ORIGIN, null, { heading: label(short), edge: corner.left + 10 });
    expect(placement).toEqual(corner);
  });
});

describe("headerHeading (REQ-754)", () => {
  const shape = box(500, 834, 5, 53);

  it("is the name's box with the info buttons standing in the header", () => {
    const name = box(600, 718, 12, 44);
    const info = box(722, 738, 21, 37);
    expect(headerHeading(name, [info, box(100, 116, 21, 37)], shape)).toEqual(box(600, 738, 12, 44));
  });

  it("takes boxes whose fields are getters, as a DOMRect's are", () => {
    class Rect {
      constructor(private readonly box: { left: number; top: number; right: number; bottom: number }) {}
      get left() {
        return this.box.left;
      }
      get top() {
        return this.box.top;
      }
      get right() {
        return this.box.right;
      }
      get bottom() {
        return this.box.bottom;
      }
    }
    expect(headerHeading(new Rect(box(600, 718, 12, 44)), [], shape)).toEqual(box(600, 718, 12, 44));
    expect(headerHeading(null, [new Rect(box(722, 738, 21, 37))], shape)).toEqual(box(722, 738, 21, 37));
  });

  it("is the name alone, a button alone, or none", () => {
    const name = box(600, 718, 12, 44);
    expect(headerHeading(name, [], shape)).toEqual(name);
    expect(headerHeading(null, [box(722, 738, 21, 37)], shape)).toEqual(box(722, 738, 21, 37));
    expect(headerHeading(null, [], shape)).toBeNull();
    expect(headerHeading(box(600, 600, 12, 44), [], shape)).toBeNull();
  });
});

describe("footerClosePlacement (REQ-750)", () => {
  it("stands left of the place name with a small gap, centred on its line", () => {
    const location = box(30, 360, 799, 823);
    const { size, gap } = footerCloseSize(24);
    expect(size).toBe(24);
    expect(gap).toBe(6);
    const placement = footerClosePlacement(location, ORIGIN, "rgb(71, 85, 105)");
    expect(placement).toEqual({ where: "footer", left: 0, top: 799, size: 24, color: "rgb(71, 85, 105)" });
    expect(location.left - (placement.left + placement.size)).toBe(gap);
  });

  it("gets smaller with a smaller line, down to 12 px", () => {
    expect(footerCloseSize(14)).toEqual({ size: 14, gap: 4 });
    expect(footerCloseSize(8)).toEqual({ size: 12, gap: 3 });
    expect(footerCloseSize(40)).toEqual({ size: 24, gap: 6 });
  });
});

describe("info buttons beside the close button (REQ-643, REQ-750)", () => {
  const segment = (model: string, left: number, right: number, labelRight: number): MeasuredSegment => ({
    model,
    startX: left,
    endX: right,
    shape: box(left, right, 10, 30),
    label: box(labelRight - 40, labelRight, 13, 27),
    color: "#000000",
  });

  it("leave out the last header's button where the close button needs its room, the others stay", () => {
    const segments = [segment("ICON-D2", 0, 200, 120), segment("ICON-EU", 200, 300, 260)];
    expect(placeInfoButtons(segments, ORIGIN).map((placement) => placement.model)).toEqual(["ICON-D2", "ICON-EU"]);
    const reserved = placeInfoButtons(segments, ORIGIN, headerCloseReserve);
    expect(reserved.map((placement) => placement.model)).toEqual(["ICON-D2"]);
  });

  it("keep the last header's button where there is room for both", () => {
    const segments = [segment("ICON-D2", 0, 200, 120), segment("ICON-EU", 200, 600, 420)];
    expect(placeInfoButtons(segments, ORIGIN, headerCloseReserve)).toHaveLength(2);
  });
});
