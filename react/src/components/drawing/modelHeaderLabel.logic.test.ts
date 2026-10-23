import { describe, expect, it } from "vitest";
import {
  chooseModelHeaderLabel,
  getModelHeaderFontSize,
} from "./modelHeaderLabel.logic";

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
      chooseModelHeaderLabel("ECMWF IFS 0.25° (10/06Z06)", "IFS (10/06Z06)", 60)
        .text,
    ).toBe("IFS (10/06Z06)");
  });

  it("keeps the width-based font steps", () => {
    expect(getModelHeaderFontSize(30)).toBe(7);
    expect(getModelHeaderFontSize(60)).toBe(8.5);
    expect(getModelHeaderFontSize(70)).toBe(10);
  });
});
