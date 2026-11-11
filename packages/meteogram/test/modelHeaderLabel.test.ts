// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { describe, expect, it } from "vitest";
import {
  chooseModelHeaderLabel,
  estimateModelHeaderLabelWidth,
  getModelHeaderFontSize,
} from "../src";

describe("chooseModelHeaderLabel", () => {
  it("always shows the nickname, also when the full name would fit", () => {
    expect(chooseModelHeaderLabel("ICON Global", "ICON", 500)).toEqual({
      text: "ICON",
      fontSize: 10,
      shortened: true,
    });
  });

  it("shows the full name for models without a nickname", () => {
    expect(chooseModelHeaderLabel("ICON-EU", null, 500)).toEqual({
      text: "ICON-EU",
      fontSize: 10,
      shortened: false,
    });
  });

  it("keeps the run suffix of a split series", () => {
    expect(
      chooseModelHeaderLabel("ECMWF IFS 0.25° (06 Z06)", "IFS (06 Z06)", 60)
        .text,
    ).toBe("IFS (06 Z06)");
  });

  it("keeps the width-based font steps", () => {
    expect(getModelHeaderFontSize(30)).toBe(7);
    expect(getModelHeaderFontSize(60)).toBe(8.5);
    expect(getModelHeaderFontSize(70)).toBe(10);
  });
});

describe("chooseModelHeaderLabel for split series (REQ-515)", () => {
  const full = "ECMWF IFS HRES (29 Z06)";
  const short = "IFS HRES (29 Z06)";

  it("keeps name and run while they fit the part", () => {
    expect(chooseModelHeaderLabel(full, short, 300, { runLabel: "29 Z06" })).toEqual({
      text: short,
      fontSize: 10,
      shortened: true,
    });
  });

  it("shows only the run, without brackets, when name and run do not fit", () => {
    // "IFS HRES (29 Z06)" at 10 px needs about 105 units, "29 Z06" about 37 (REQ-695).
    expect(chooseModelHeaderLabel(full, short, 100, { runLabel: "29 Z06" })).toEqual({
      text: "29 Z06",
      fontSize: 10,
      shortened: true,
      runOnly: true,
    });
  });

  it("uses the full name with run for models without a nickname", () => {
    expect(chooseModelHeaderLabel("ICON-EU (29 Z06)", null, 130, { runLabel: "29 Z06" }).text).toBe(
      "ICON-EU (29 Z06)",
    );
    expect(chooseModelHeaderLabel("ICON-EU (29 Z06)", null, 100, { runLabel: "29 Z06" }).text).toBe(
      "29 Z06",
    );
  });

  it("counts the horizontal text scale of the view", () => {
    expect(chooseModelHeaderLabel(full, short, 200, { runLabel: "29 Z06" }).text).toBe(short);
    expect(chooseModelHeaderLabel(full, short, 200, { runLabel: "29 Z06", textScaleX: 2 }).text).toBe(
      "29 Z06",
    );
  });

  it("keeps the run when even the run does not fit (no further shortening)", () => {
    expect(chooseModelHeaderLabel(full, short, 20, { runLabel: "29 Z06" })).toMatchObject({
      text: "29 Z06",
      fontSize: 7,
      runOnly: true,
    });
  });

  it("never cuts an unsplit model down, however narrow", () => {
    expect(chooseModelHeaderLabel("ECMWF IFS HRES", "IFS HRES", 20)).toEqual({
      text: "IFS HRES",
      fontSize: 7,
      shortened: true,
    });
    expect(chooseModelHeaderLabel("ECMWF IFS HRES", "IFS HRES", 20, { runLabel: null }).text).toBe("IFS HRES");
  });

  it("estimates widths from characters, font size and text scale", () => {
    expect(estimateModelHeaderLabelWidth("29 Z06", 10)).toBeCloseTo(37.2);
    expect(estimateModelHeaderLabelWidth("29 Z06", 10, 2)).toBeCloseTo(74.4);
  });
});
