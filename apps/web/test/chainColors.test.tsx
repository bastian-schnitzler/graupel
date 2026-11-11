// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/** Colours of the model chains (REQ-443, REQ-456): blue weather chain, slate cloud chain, fading left to right. */
import type { WeatherModel } from "@graupel/download";
import { contrastRatio } from "@graupel/meteogram";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../src/i18n/index.ts";
import { ModelChainRow } from "../src/regions/ModelChain/chain/ModelChainRow.tsx";
import {
  CARD_BACKGROUNDS,
  TEXT_DARK,
  TEXT_LIGHT,
  chainShades,
  chainShare,
  mixColors,
  modelHeaderColors,
  useChainShades,
  type ChainKind,
} from "../src/state/chainColors.ts";
import type { PageTheme } from "../src/state/pageTheme.ts";

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
});

const KINDS: ChainKind[] = ["main", "cloud"];
const THEMES: PageTheme[] = ["light", "dark"];

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Hue in degrees and lightness 0–1 of a hex colour. */
function hsl(hex: string): { h: number; l: number } {
  const [r, g, b] = rgb(hex).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, l };
  const d = max - min;
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, l };
}

const cssRgb = (hex: string) => `rgb(${rgb(hex).join(", ")})`;

/** REQ-456: colours of three models per chain and mode, over the reference backgrounds (white, #1D232B). */
const REQ_456: Record<ChainKind, Record<PageTheme, string[]>> = {
  main: {
    light: ["#5e97de", "#98bdea", "#c9dcf4"],
    dark: ["#1f5fae", "#1e508e", "#1e4472"],
  },
  cloud: {
    light: ["#85909f", "#b1b8c1", "#d6dadf"],
    dark: ["#495769", "#3e4a59", "#353f4d"],
  },
};

/** The same three shades over the page's real dark card colour (`--color-surface`, #1a2129). */
const PAGE_DARK: Record<ChainKind, string[]> = {
  main: ["#1e5fae", "#1d4f8d", "#1c4371"],
  cloud: ["#495768", "#3d4959", "#333e4b"],
};

describe("mixColors", () => {
  it("lays a colour over a background with the given share", () => {
    expect(mixColors("#ff0000", "#ffffff", 1)).toBe("#ff0000");
    expect(mixColors("#ff0000", "#ffffff", 0)).toBe("#ffffff");
    expect(mixColors("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});

describe("chainShare", () => {
  it("runs through 72 %, 46 % and 24 %", () => {
    expect(chainShare(0)).toBeCloseTo(0.72);
    expect(chainShare(0.5)).toBeCloseTo(0.46);
    expect(chainShare(1)).toBeCloseTo(0.24);
    expect(chainShare(0.25)).toBeCloseTo(0.59);
  });
});

describe("chainShades", () => {
  it("has one shade per model", () => {
    for (const count of [0, 1, 2, 3, 7]) expect(chainShades(count, "main", "light")).toHaveLength(count);
  });

  it("gives three models exactly the colours of REQ-456 in light and dark mode", () => {
    for (const kind of KINDS) {
      expect(chainShades(3, kind, "light").map((shade) => shade.color)).toEqual(REQ_456[kind].light);
      expect(chainShades(3, kind, "dark", "#1d232b").map((shade) => shade.color)).toEqual(REQ_456[kind].dark);
    }
  });

  it("grades the dark shades over the page's real card colour", () => {
    expect(CARD_BACKGROUNDS.dark).toBe("#1a2129");
    for (const kind of KINDS) {
      expect(chainShades(3, kind, "dark").map((shade) => shade.color)).toEqual(PAGE_DARK[kind]);
    }
  });

  it("mixes over the card colours of styles/tokens.css", () => {
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/styles/tokens.css"), "utf8");
    const surfaces = [...css.matchAll(/--color-surface:\s*(#[0-9a-f]{6})/gi)].map((match) => match[1]!.toLowerCase());
    expect(surfaces).toEqual([CARD_BACKGROUNDS.light, CARD_BACKGROUNDS.dark, CARD_BACKGROUNDS.dark]);
  });

  it("uses dark text in light mode and white text in dark mode", () => {
    for (const kind of KINDS) {
      for (const shade of chainShades(3, kind, "light")) expect(shade.text).toBe(TEXT_DARK);
      for (const shade of chainShades(3, kind, "dark")) expect(shade.text).toBe(TEXT_LIGHT);
    }
  });

  it("starts with the first share and ends with the last for any chain length", () => {
    for (const kind of KINDS) {
      for (const theme of THEMES) {
        const [first, , last] = chainShades(3, kind, theme).map((shade) => shade.color);
        expect(chainShades(1, kind, theme)[0]!.color).toBe(first);
        for (const count of [2, 3, 5]) {
          const shades = chainShades(count, kind, theme);
          expect(shades[0]!.color).toBe(first);
          expect(shades[count - 1]!.color).toBe(last);
        }
      }
    }
  });

  it("derives the shades from the number of models", () => {
    const three = chainShades(3, "main", "light").map((shade) => shade.color);
    const five = chainShades(5, "main", "light").map((shade) => shade.color);
    expect(three[1]).not.toBe(five[1]);
    expect(three[1]).toBe(five[2]);
    expect(new Set(five).size).toBe(5);
  });

  it("fades from left to right: lighter towards white in light mode, darker towards the card in dark mode", () => {
    for (const kind of KINDS) {
      const light = chainShades(5, kind, "light").map((shade) => hsl(shade.color).l);
      const dark = chainShades(5, kind, "dark").map((shade) => hsl(shade.color).l);
      for (let i = 1; i < 5; i++) {
        expect(light[i]!).toBeGreaterThan(light[i - 1]!);
        expect(dark[i]!).toBeLessThan(dark[i - 1]!);
      }
    }
  });

  it("uses blue for the weather chain and slate for the cloud chain", () => {
    for (const theme of THEMES) {
      for (const count of [1, 2, 4, 8]) {
        for (const shade of chainShades(count, "main", theme)) {
          expect(hsl(shade.color).h).toBeGreaterThanOrEqual(205);
          expect(hsl(shade.color).h).toBeLessThanOrEqual(220);
        }
        for (const shade of chainShades(count, "cloud", theme)) {
          expect(hsl(shade.color).h).toBeGreaterThanOrEqual(205);
          expect(hsl(shade.color).h).toBeLessThanOrEqual(220);
          const [r, g, b] = rgb(shade.color);
          expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(40);
        }
      }
    }
  });

  it("differs between light and dark mode", () => {
    for (const kind of KINDS) {
      expect(chainShades(3, kind, "light").map((s) => s.color)).not.toEqual(
        chainShades(3, kind, "dark").map((s) => s.color),
      );
    }
  });

  it("keeps the text on every shade readable (WCAG AA) in both modes", () => {
    for (const kind of KINDS) {
      for (const theme of THEMES) {
        for (let count = 1; count <= 8; count++) {
          for (const shade of chainShades(count, kind, theme)) {
            expect([TEXT_DARK, TEXT_LIGHT]).toContain(shade.text);
            expect(contrastRatio(shade.color, shade.text)!).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });
});

describe("modelHeaderColors", () => {
  it("maps each weather-chain model (id, else name) to its shade", () => {
    const models: WeatherModel[] = [
      { id: "icon_d2", name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "ICON-EU", max_forecast_horizon_hours: 120 },
      { id: "ecmwf_ifs", name: "ECMWF IFS", max_forecast_horizon_hours: 360 },
    ];
    for (const theme of THEMES) {
      const shades = chainShades(3, "main", theme);
      expect(modelHeaderColors(models, theme)).toEqual({
        icon_d2: shades[0]!.color,
        "ICON-EU": shades[1]!.color,
        ecmwf_ifs: shades[2]!.color,
      });
    }
    expect(modelHeaderColors([], "light")).toEqual({});
  });
});

describe("useChainShades", () => {
  it("follows the page's colour mode", async () => {
    const { result } = renderHook(() => useChainShades(2, "cloud"));
    expect(result.current).toEqual(chainShades(2, "cloud", "light"));
    await act(async () => {
      document.documentElement.dataset.theme = "dark";
    });
    expect(result.current).toEqual(chainShades(2, "cloud", "dark"));
  });
});

describe("chain cards", () => {
  const chain: WeatherModel[] = [
    { id: "icon_d2", name: "ICON-D2", max_forecast_horizon_hours: 48 },
    { id: "icon_eu", name: "ICON-EU", max_forecast_horizon_hours: 120 },
    { id: "ecmwf_ifs", name: "ECMWF IFS", max_forecast_horizon_hours: 360 },
  ];
  const available = Object.fromEntries(chain.map((model) => [model.id!, model]));

  for (const kind of KINDS) {
    for (const theme of THEMES) {
      it(`colour the ${kind} chain in ${theme} mode`, () => {
        document.documentElement.dataset.theme = theme;
        const prefix = kind === "cloud" ? "cloud-" : "";
        render(
          <I18nProvider browserLanguages={["en"]}>
            <ModelChainRow
              modelChain={chain}
              availableModels={available}
              testIdPrefix={prefix}
              {...(kind === "cloud" ? { kind } : {})}
            />
          </I18nProvider>,
        );
        const shades = chainShades(3, kind, theme);
        chain.forEach((model, index) => {
          const card = screen.getByTestId(`${prefix}model-card-${model.id}`);
          expect(card.dataset.chainColor).toBe(shades[index]!.color);
          expect(card.style.borderTopColor).toBe(cssRgb(shades[index]!.color));
          const range = screen.getByTestId(`${prefix}model-range-${model.id}`);
          expect(range.style.backgroundColor).toBe(cssRgb(shades[index]!.color));
          expect(range.style.color).toBe(cssRgb(shades[index]!.text));
        });
      });
    }
  }
});
