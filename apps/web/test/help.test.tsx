// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Help tab of the info popup (REQ-819): between Info and the imprint; five sections, each with a drawn picture and a
 * text in all 8 languages; the model chains only while one is shown (and only the shown ones drawn), the day slider only
 * while it is shown, the history only in the installed app with the archive's period from the settings, and the texts
 * of gestures and controls by device class.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG } from "../src/config/index.ts";
import { InfoDialog, INFO_TABS, type InfoTab } from "../src/dialogs/index.ts";
import {
  HELP_SECTIONS,
  HelpPanel,
  HelpSections,
  helpSections,
  helpText,
  type HelpContext,
} from "../src/dialogs/info/HelpPanel.tsx";
import { DRY_DAY } from "../src/dialogs/info/HelpPicture.tsx";
import {
  CLOUD_COLUMN_HOURS,
  CLOUD_LAYERS,
  CLOUD_TOP_KM,
  CLOUDS,
  DAY_HOURS,
  HELP_WEATHER,
  HOURS,
  valueAt,
  type HelpWeather,
} from "../src/dialogs/info/helpWeather.ts";
import { createTranslate, I18nProvider, LANGUAGES, MESSAGES, type Language, type MessageKey } from "../src/i18n/index.ts";
import en from "../src/i18n/en.json";
import { daySliderChoice, resetDisplaySettings, resetModelChainView, weatherChainChoice } from "../src/state/index.ts";

afterEach(() => {
  cleanup();
  resetDisplaySettings();
  resetModelChainView();
  localStorage.clear();
});

/** Everything shown: both chains, the day slider, the installed app. */
const FULL: HelpContext = {
  device: "desktop",
  installed: true,
  chains: { weather: true, cloud: true },
  daySlider: true,
  archiveDays: "unlimited",
};

function renderIn(language: Language, children: React.ReactNode) {
  return render(
    <ConfigProvider config={DEFAULT_CONFIG}>
      <I18nProvider languages={LANGUAGES} fallbackLanguage="en" browserLanguages={[language]}>
        {children}
      </I18nProvider>
    </ConfigProvider>,
  );
}

const sections = () => [...document.querySelectorAll<HTMLElement>("[data-help-section]")];
const sectionNames = () => sections().map((section) => section.dataset.helpSection);
const section = (name: string) => document.querySelector<HTMLElement>(`[data-help-section="${name}"]`)!;

/** Every key of the help (the tab's label and the texts), as English has them. */
const HELP_KEYS = (Object.keys(en) as MessageKey[]).filter((key) => key.startsWith("info.help.") || key === "info.tab.help");

describe("Help tab (REQ-819)", () => {
  // REQ-819: Help stands between Info and the imprint.
  it("stands between Info and the imprint: Info, Help, Imprint, Privacy (REQ-819)", () => {
    expect(INFO_TABS).toEqual(["about", "help", "imprint", "privacy"]);
    let selected: InfoTab = "about";
    renderIn(
      "de",
      <InfoDialog tab={selected} onSelectTab={(tab) => (selected = tab)} onClose={() => {}} />,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Info",
      "Hilfe",
      "Impressum",
      "Datenschutzerklärung",
    ]);
    fireEvent.click(within(dialog).getByRole("tab", { name: "Hilfe" }));
    expect(selected).toBe("help");
  });

  it("shows the help in its tab panel (REQ-819)", () => {
    renderIn("de", <InfoDialog tab="help" onSelectTab={() => {}} onClose={() => {}} />);
    const panel = screen.getByRole("tabpanel", { name: "Hilfe" });
    expect(within(panel).getAllByRole("heading", { level: 3 }).length).toBeGreaterThanOrEqual(3);
    expect(panel.querySelector('[data-help-section="meteogram"]')).not.toBeNull();
  });

  // REQ-819: all texts in all 8 languages, none left to the English fallback.
  it.each(LANGUAGES)("has every text in %s (REQ-819)", (language) => {
    expect(HELP_KEYS.length).toBeGreaterThan(25);
    for (const key of HELP_KEYS) expect(MESSAGES[language][key]?.trim(), `${language} ${key}`).toBeTruthy();
    // The placeholders of the history's sentences are kept.
    for (const key of ["info.help.place.history.days", "info.help.place.history.unlimited"] as const) {
      expect(MESSAGES[language][key], `${language} ${key}`).toContain("{where}");
    }
    expect(MESSAGES[language]["info.help.place.history.days"]).toContain("{count}");
  });

  // REQ-819: five sections, each with a heading, a drawn picture and a text, in every language.
  it.each(LANGUAGES)("shows five sections with picture and text in %s (REQ-819)", (language) => {
    const t = createTranslate(language);
    renderIn(language, <HelpSections context={FULL} />);
    expect(sectionNames()).toEqual([...HELP_SECTIONS]);
    for (const element of sections()) {
      const name = element.dataset.helpSection as (typeof HELP_SECTIONS)[number];
      expect(within(element).getByRole("heading", { level: 3 }).textContent).toBe(
        t(`info.help.${name}.title` as MessageKey),
      );
      const picture = element.querySelector(`svg[data-help-picture="${name}"]`)!;
      expect(picture).not.toBeNull();
      // Decorative, drawn in the page's colours with the controls highlighted (as the install steps).
      expect(picture.getAttribute("aria-hidden")).toBe("true");
      expect(picture.querySelector(".ip-screen")).not.toBeNull();
      expect(picture.querySelectorAll("[data-hit], [data-badge]").length).toBeGreaterThan(0);
      const text = helpText(name, FULL, t);
      expect(text.paragraphs.length).toBeGreaterThan(0);
      for (const paragraph of [...text.paragraphs, ...(text.items ?? [])]) {
        expect(paragraph).not.toMatch(/\{\w+\}/);
        expect(element.textContent).toContain(paragraph);
      }
    }
  });

  // REQ-819: the meteogram's three areas, numbered in the picture as in the list, and the red dashed line of now.
  it("numbers the meteogram's three areas as its list (REQ-819)", () => {
    renderIn("de", <HelpSections context={FULL} />);
    const meteogram = section("meteogram");
    expect(within(meteogram).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      MESSAGES.de["info.help.meteogram.temperature"],
      MESSAGES.de["info.help.meteogram.precipitation"],
      MESSAGES.de["info.help.meteogram.wind"],
    ]);
    expect([...meteogram.querySelectorAll("[data-badge]")].map((badge) => badge.textContent)).toEqual(["1", "2", "3"]);
    expect(meteogram.querySelector("[data-now]")).not.toBeNull();
    // Full screen: the side bar and the line of now.
    const fullscreen = section("fullscreen");
    expect(fullscreen.querySelector("[data-side-bar]")).not.toBeNull();
    expect(fullscreen.querySelector("[data-now]")).not.toBeNull();
  });

  // REQ-819: the model chains only while one is shown, and only the shown ones drawn; the day slider only while shown.
  it("shows the model chains and the day slider only while the page shows them (REQ-819)", () => {
    const none = { ...FULL, chains: { weather: false, cloud: false } };
    expect(helpSections(none)).toEqual(["place", "days", "meteogram", "fullscreen"]);
    expect(helpSections({ ...none, daySlider: false })).toEqual(["place", "meteogram", "fullscreen"]);
    expect(helpSections({ ...FULL, daySlider: false })).toEqual(["place", "chains", "meteogram", "fullscreen"]);

    const t = createTranslate("de");
    for (const [chains, drawn, intro] of [
      [{ weather: true, cloud: false }, ["weather"], "info.help.chains.weather"],
      [{ weather: false, cloud: true }, ["cloud"], "info.help.chains.cloud"],
      [{ weather: true, cloud: true }, ["weather", "cloud"], "info.help.chains.both"],
    ] as const) {
      const context = { ...FULL, chains };
      const { unmount } = renderIn("de", <HelpSections context={context} />);
      const element = section("chains");
      expect([...element.querySelectorAll<SVGElement>("[data-chain]")].map((row) => row.dataset.chain)).toEqual(drawn);
      expect(element.textContent).toContain(t(intro));
      unmount();
    }
  });

  it("follows the page's settings: chains and day slider as chosen (REQ-819)", () => {
    // Defaults: no chain shown, the day slider on.
    let view = renderIn("de", <HelpPanel context={{ installed: false }} />);
    expect(sectionNames()).toEqual(["place", "days", "meteogram", "fullscreen"]);
    view.unmount();

    weatherChainChoice.set(true);
    daySliderChoice.set(false);
    view = renderIn("de", <HelpPanel context={{ installed: false }} />);
    expect(sectionNames()).toEqual(["place", "chains", "meteogram", "fullscreen"]);
    expect([...section("chains").querySelectorAll<SVGElement>("[data-chain]")].map((row) => row.dataset.chain)).toEqual([
      "weather",
    ]);
    view.unmount();
  });

  // REQ-819: the history's sentence only in the installed app, with the period of its archive from the settings.
  it("names the history only in the installed app, with the archive's period (REQ-819)", () => {
    const t = createTranslate("de");
    const where = "Einstellungen › Archiv";
    const website = helpText("place", { ...FULL, installed: false }, t).paragraphs.join(" ");
    expect(website).not.toContain(t("info.help.place.history.button"));
    expect(website).not.toContain(t("info.help.place.history.menu"));

    const unlimited = helpText("place", FULL, t).paragraphs.join(" ");
    expect(unlimited).toContain(t("info.help.place.history.button"));
    expect(unlimited).toContain(t("info.help.place.history.unlimited", { where }));
    expect(unlimited).toContain("ohne zeitliche Begrenzung");

    const days = helpText("place", { ...FULL, archiveDays: 14 }, t).paragraphs.join(" ");
    expect(days).toContain("14 Tage lang aufbewahrt (einstellbar unter Einstellungen › Archiv)");

    // The phone has the history in its menu.
    const phone = helpText("place", { ...FULL, device: "phone" }, t).paragraphs.join(" ");
    expect(phone).toContain(t("info.help.place.history.menu"));
    expect(phone).not.toContain(t("info.help.place.history.button"));

    // The picture: the clock only in the installed app (on a phone the menu, highlighted).
    const clock = (context: HelpContext) => {
      const { unmount } = renderIn("de", <HelpSections context={context} />);
      const hits = section("place").querySelectorAll("[data-hit]").length;
      unmount();
      return hits;
    };
    expect(clock(FULL)).toBe(clock({ ...FULL, installed: false }) + 1);
    expect(clock({ ...FULL, device: "phone" })).toBe(clock({ ...FULL, device: "phone", installed: false }) + 1);
  });

  // REQ-819: the texts name the gestures and controls of the device: grips and clicks on the desktop, the slider and taps
  // on phones and tablets; full screen by its button (desktop, tablet) or by turning the phone; values by holding the
  // mouse button or pressing with a finger.
  it("names the gestures and controls of each device class (REQ-819)", () => {
    const t = createTranslate("de");
    const all = (device: HelpContext["device"]) =>
      HELP_SECTIONS.map((name) => {
        const text = helpText(name, { ...FULL, device }, t);
        return [...text.paragraphs, ...(text.items ?? [])].join(" ");
      }).join(" ");

    const desktop = all("desktop");
    expect(desktop).toContain(t("info.help.days.desktop"));
    expect(desktop).toContain("Doppelklick auf einen der Griffe");
    expect(desktop).toContain(t("info.help.chains.reset.click"));
    expect(desktop).toContain(t("info.help.fullscreen.desktop"));
    expect(desktop).toContain(t("info.help.fullscreen.mouse"));
    expect(desktop).not.toContain(t("info.help.days.touch"));
    expect(desktop).not.toContain(t("info.help.fullscreen.finger"));

    const tablet = all("tablet");
    expect(tablet).toContain(t("info.help.days.touch"));
    expect(tablet).toContain("Zweimal Tippen auf den Slider");
    expect(tablet).toContain(t("info.help.chains.reset.tap"));
    expect(tablet).toContain(t("info.help.fullscreen.tablet"));
    expect(tablet).toContain(t("info.help.fullscreen.finger"));
    expect(tablet).not.toContain(t("info.help.fullscreen.phone"));

    const phone = all("phone");
    expect(phone).toContain(t("info.help.days.touch"));
    expect(phone).toContain(t("info.help.fullscreen.phone"));
    expect(phone).toContain("Querformat");
    expect(phone).toContain(t("info.help.fullscreen.finger"));
    expect(phone).not.toContain(t("info.help.fullscreen.tablet"));
    expect(phone).not.toContain(t("info.help.fullscreen.mouse"));

    // The day slider's picture: grips beside the period on the desktop, below the strip on touch screens.
    const grips = (device: HelpContext["device"]) => {
      const { unmount } = renderIn("de", <HelpSections context={{ ...FULL, device }} />);
      const strip = section("days").querySelector(".hp-strip") !== null;
      unmount();
      return strip;
    };
    expect(grips("desktop")).toBe(false);
    expect(grips("phone")).toBe(true);
    expect(grips("tablet")).toBe(true);
  });
});

/** The points of an SVG path of only M and L commands. */
function pathPoints(d: string): { x: number; y: number }[] {
  return [...d.matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
}

const number = (element: Element, attribute: string) => Number(element.getAttribute(attribute));

describe("Help pictures, refined (REQ-848, REQ-857, REQ-858)", () => {
  // Fixed clock: Thursday, 12 November 2026, 09:00 UTC.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 10, 12, 9));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // REQ-848: the meteogram also shows a day without precipitation bars, its probability low and (almost) no clouds behind.
  it.each(["meteogram", "fullscreen"] as const)("the %s picture has a dry day (REQ-848)", (name) => {
    renderIn("de", <HelpSections context={FULL} />);
    const svg = section(name).querySelector("svg")!;
    const days = [...svg.querySelectorAll("rect[data-day].ip-chart")];
    expect(days).toHaveLength(4);
    const rainDays = new Set([...svg.querySelectorAll<SVGElement>(".hp-rain")].map((bar) => Number(bar.dataset.day)));
    const dry = [0, 1, 2, 3].filter((day) => !rainDays.has(day));
    expect(dry).toEqual([DRY_DAY]);
    // The other days have rain.
    expect(rainDays.size).toBe(3);
    // Its clouds: at most one faint field, while every other day has several.
    const clouds = (day: number) => [...svg.querySelectorAll<SVGElement>(`.hp-cloud[data-day="${day}"]`)];
    expect(clouds(DRY_DAY).length).toBeLessThanOrEqual(1);
    for (const cloud of clouds(DRY_DAY)) expect(Number(cloud.style.fillOpacity)).toBeLessThanOrEqual(0.2);
    for (const day of [0, 1, 2]) expect(clouds(day).length).toBeGreaterThanOrEqual(3);
    // The probability is low on that day: at most 15 % of the area's height.
    const dayRect = days[DRY_DAY]!;
    const from = number(dayRect, "x") - 0.5;
    const to = from + number(dayRect, "width") + 1;
    const area = svg.querySelector('[data-area="precipitation"]')!;
    const bottom = number(area, "y") + number(area, "height");
    const points = pathPoints(svg.querySelector(".hp-probability")!.getAttribute("d")!).filter(
      (point) => point.x >= from && point.x <= to,
    );
    expect(points.length).toBeGreaterThanOrEqual(2);
    for (const point of points) expect((bottom - point.y) / number(area, "height")).toBeLessThanOrEqual(0.15);
    // Elsewhere it is higher.
    const all = pathPoints(svg.querySelector(".hp-probability")!.getAttribute("d")!);
    expect(Math.max(...all.map((point) => (bottom - point.y) / number(area, "height")))).toBeGreaterThan(0.5);
  });

  // REQ-857: the whole favourites' button (star and arrow) highlighted with a rounded rectangle like the map, no circle
  // around the star; its arrow no larger than the other glyphs.
  it.each(["desktop", "tablet", "phone"] as const)(
    "highlights the whole favourites' button, its arrow small (REQ-857, %s)",
    (device) => {
      for (const installed of [false, true]) {
        const { unmount } = renderIn("de", <HelpSections context={{ ...FULL, device, installed }} />);
        const svg = section("place").querySelector("svg")!;
        const button = svg.querySelector("[data-favourites]")!;
        const x = number(button, "x");
        const y = number(button, "y");
        const width = number(button, "width");
        const height = number(button, "height");
        // No highlight circle on the button.
        for (const circle of svg.querySelectorAll("circle[data-hit]")) {
          const cx = number(circle, "cx");
          const cy = number(circle, "cy");
          expect(cx >= x && cx <= x + width && cy >= y && cy <= y + height, `circle at ${cx},${cy}`).toBe(false);
        }
        // A rounded rectangle around the whole button, as around the map.
        const around = [...svg.querySelectorAll("rect[data-hit]")].filter(
          (rect) =>
            number(rect, "x") <= x &&
            number(rect, "y") <= y &&
            number(rect, "x") + number(rect, "width") >= x + width &&
            number(rect, "y") + number(rect, "height") >= y + height &&
            number(rect, "width") <= width + 6,
        );
        expect(around).toHaveLength(1);
        expect(number(around[0]!, "rx")).toBeGreaterThan(0);
        // It does not touch the map's highlight.
        const map = svg.querySelector('[data-glyph="map"]')!.parentElement!.querySelector("rect[data-hit]")!;
        expect(number(map, "x") + number(map, "width")).toBeLessThan(number(around[0]!, "x") - 1);
        // Nor the clock's (or the phone menu's) in the installed app.
        if (installed) {
          const glyph = svg.querySelector(`[data-glyph="${device === "phone" ? "menu" : "clock"}"]`)!;
          const clock = glyph.parentElement!.querySelector("rect[data-hit]")!;
          expect(number(around[0]!, "x") + number(around[0]!, "width")).toBeLessThan(number(clock, "x") - 1);
        }
        // The arrow: drawn like the other glyphs and smaller than them.
        const extent = (glyph: string) => {
          const xs = pathPoints(svg.querySelector(`[data-glyph="${glyph}"]`)!.getAttribute("d")!).map((point) => point.x);
          return Math.max(...xs) - Math.min(...xs);
        };
        expect(svg.querySelector('[data-glyph="chevron"]')!.getAttribute("class")).toBe("ip-glyph");
        expect(extent("chevron")).toBeLessThan(extent("close"));
        expect(extent("chevron")).toBeLessThanOrEqual(5);
        unmount();
      }
    },
  );

  // REQ-858, DEC-178: in full screen the red dashed line runs through the yellow circle of the time pressed; there is no
  // other line (the grey one and the red one at now are gone).
  it("draws the red dashed line through the yellow circle in full screen (REQ-858, DEC-178)", () => {
    renderIn("de", <HelpSections context={FULL} />);
    const svg = section("fullscreen").querySelector("svg")!;
    const lines = svg.querySelectorAll(".hp-now");
    expect(lines).toHaveLength(1);
    expect(svg.querySelectorAll("[data-now]")).toHaveLength(1);
    expect(svg.querySelector(".hp-cursor")).toBeNull();
    const line = lines[0]!;
    expect(number(line, "x1")).toBe(number(line, "x2"));
    const circle = svg.querySelector("circle[data-hit]")!;
    expect(number(line, "x1")).toBe(number(circle, "cx"));
    expect(number(line, "y1")).toBeLessThan(number(circle, "cy"));
    expect(number(line, "y2")).toBeGreaterThan(number(circle, "cy"));
  });
});

describe("Help picture's weather, like a forecast (REQ-864)", () => {
  // Fixed clock: Thursday, 12 November 2026, 09:00 UTC.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 10, 12, 9));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const SERIES = ["temperature", "felt", "wind", "gusts"] as const satisfies readonly (keyof HelpWeather)[];
  const DAYS = HOURS / DAY_HOURS;
  /** The hours 0–23 of `day` of an hourly series. */
  const dayOf = (series: readonly number[], day: number) => series.slice(day * DAY_HOURS, (day + 1) * DAY_HOURS);
  const range = (values: readonly number[]) => Math.max(...values) - Math.min(...values);
  const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

  // REQ-864: four days of hourly values, finite and plausible for the season.
  it("has a value for every hour of the four days (REQ-864)", () => {
    expect(DAYS).toBe(4);
    for (const name of SERIES) {
      expect(HELP_WEATHER[name], name).toHaveLength(HOURS + 1);
      for (const value of HELP_WEATHER[name]) expect(Number.isFinite(value), name).toBe(true);
    }
    for (const value of [...HELP_WEATHER.temperature, ...HELP_WEATHER.felt]) expect(value).toBeGreaterThan(-6);
    for (const value of HELP_WEATHER.temperature) expect(value).toBeLessThan(15);
    for (const value of HELP_WEATHER.gusts) expect(value).toBeLessThan(60);
    for (const value of HELP_WEATHER.wind) expect(value).toBeGreaterThan(0);
  });

  // REQ-864: not periodic: every day has its own range (pairwise at least 1 °C or 1 km/h apart) and its own shape, no day
  // repeats the one before.
  it.each(SERIES)("%s: each day has its own amplitude and shape, none repeats another (REQ-864)", (name) => {
    const series = HELP_WEATHER[name];
    const days = Array.from({ length: DAYS }, (_, day) => dayOf(series, day));
    const amplitudes = days.map(range);
    for (let a = 0; a < DAYS; a++) {
      for (let b = a + 1; b < DAYS; b++) {
        expect(Math.abs(amplitudes[a]! - amplitudes[b]!), `${name}: days ${a} and ${b}, ${amplitudes}`).toBeGreaterThanOrEqual(1);
        // The shapes (each day around its own mean) differ clearly somewhere.
        const meanA = mean(days[a]!);
        const meanB = mean(days[b]!);
        const difference = Math.max(...days[a]!.map((value, hour) => Math.abs(value - meanA - (days[b]![hour]! - meanB))));
        expect(difference, `${name}: days ${a} and ${b}`).toBeGreaterThan(1.5);
      }
    }
    // The largest day swings at least twice as far as the smallest.
    expect(Math.max(...amplitudes)).toBeGreaterThanOrEqual(2 * Math.min(...amplitudes));
  });

  // REQ-864: the temperature's daily course peaks at a different hour every day, and the front leaves it colder.
  it("peaks at a different hour every day and cools after the front (REQ-864)", () => {
    const peaks = Array.from({ length: DAYS }, (_, day) => {
      const afternoon = dayOf(HELP_WEATHER.temperature, day).slice(10, 21);
      return 10 + afternoon.indexOf(Math.max(...afternoon));
    });
    expect(new Set(peaks).size, `${peaks}`).toBe(DAYS);
    // The day after the front (day 2) is clearly colder than today (day 1), the dry day's night the coldest.
    const means = Array.from({ length: DAYS }, (_, day) => mean(dayOf(HELP_WEATHER.temperature, day)));
    expect(means[2]!).toBeLessThan(means[1]! - 3);
    const coldest = HELP_WEATHER.temperature.indexOf(Math.min(...HELP_WEATHER.temperature));
    expect(Math.floor(coldest / DAY_HOURS)).toBe(DRY_DAY);
    expect(coldest % DAY_HOURS).toBeLessThan(10);
  });

  // REQ-864: no series is a sine: the best daily sine (with the mean) explains less than half of the variance (a sine
  // would explain all of it), for the temperatures because of the trend and the changing amplitude, for the wind
  // because of its irregular course.
  it.each(SERIES)("%s is far from a daily sine (REQ-864)", (name) => {
    const values = HELP_WEATHER[name].slice(0, HOURS);
    const angle = (hour: number) => (2 * Math.PI * hour) / DAY_HOURS;
    // Whole periods sampled evenly: the least-squares sine's coefficients are the Fourier coefficients.
    const average = mean(values);
    const sine = (2 / HOURS) * values.reduce((sum, value, hour) => sum + value * Math.sin(angle(hour)), 0);
    const cosine = (2 / HOURS) * values.reduce((sum, value, hour) => sum + value * Math.cos(angle(hour)), 0);
    const rest = mean(
      values.map((value, hour) => (value - average - sine * Math.sin(angle(hour)) - cosine * Math.cos(angle(hour))) ** 2),
    );
    const variance = mean(values.map((value) => (value - average) ** 2));
    expect(1 - rest / variance, name).toBeLessThan(0.5);
  });

  // REQ-864: the wind and above all the gusts wobble irregularly from hour to hour.
  it("lets the wind and the gusts wobble from hour to hour (REQ-864)", () => {
    const turns = (series: readonly number[]) => {
      const steps = series.slice(1).map((value, hour) => value - series[hour]!);
      return steps.slice(1).filter((step, index) => Math.sign(step) * Math.sign(steps[index]!) < 0).length;
    };
    expect(turns(HELP_WEATHER.wind)).toBeGreaterThan(8);
    expect(turns(HELP_WEATHER.gusts)).toBeGreaterThan(15);
  });

  // REQ-864: the felt temperature follows the wind: furthest below the temperature in the front's strong wind.
  it("feels coldest against the temperature in the front's wind (REQ-864)", () => {
    const below = HELP_WEATHER.temperature.map((value, hour) => value - HELP_WEATHER.felt[hour]!);
    const widest = below.indexOf(Math.max(...below));
    expect(Math.floor(widest / DAY_HOURS)).toBe(1);
    expect(Math.max(...below) - Math.min(...below)).toBeGreaterThan(3);
  });

  // REQ-864: the gusts always above the mean wind, unevenly far; the strongest gusts at the front, calm nights.
  it("keeps the gusts above the wind, unevenly far, strongest at the front (REQ-864)", () => {
    const gaps = HELP_WEATHER.gusts.map((gust, hour) => gust - HELP_WEATHER.wind[hour]!);
    for (const [hour, gap] of gaps.entries()) expect(gap, `hour ${hour}`).toBeGreaterThan(1);
    expect(Math.min(...gaps)).toBeLessThan(0.2 * Math.max(...gaps));
    expect(new Set(gaps.map((gap) => Math.round(gap))).size).toBeGreaterThan(15);
    const factors = HELP_WEATHER.gusts.map((gust, hour) => gust / HELP_WEATHER.wind[hour]!);
    expect(Math.max(...factors) - Math.min(...factors)).toBeGreaterThan(0.6);
    // The strongest gust in the evening of day 1, when the front passes with the heaviest rain.
    const strongest = HELP_WEATHER.gusts.indexOf(Math.max(...HELP_WEATHER.gusts));
    expect(strongest).toBeGreaterThanOrEqual(40);
    expect(strongest).toBeLessThanOrEqual(50);
    // Calmer at night than in the afternoon on the days without the front.
    for (const day of [0, DRY_DAY]) {
      const values = dayOf(HELP_WEATHER.wind, day);
      expect(mean(values.slice(0, 7)), `day ${day}`).toBeLessThan(mean(values.slice(12, 18)));
    }
  });

  // REQ-864: fixed values, no chance at run time: loading the module again gives the same values without Math.random.
  it("is the same on every load, without Math.random (REQ-864)", async () => {
    const random = vi.spyOn(Math, "random");
    vi.resetModules();
    const again = await import("../src/dialogs/info/helpWeather.ts");
    expect(again.HELP_WEATHER).not.toBe(HELP_WEATHER);
    expect(again.HELP_WEATHER).toEqual(HELP_WEATHER);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  /** The points of the path `selector` in the picture `svg`. */
  const curve = (svg: Element, selector: string) => pathPoints(svg.querySelector(selector)!.getAttribute("d")!);

  // REQ-864: both pictures (the meteogram and full screen) draw these values: a point per hour, each day with its own
  // height, the gusts above the wind.
  it.each(["meteogram", "fullscreen"] as const)("the %s picture draws the forecast's curves (REQ-864)", (name) => {
    renderIn("de", <HelpSections context={FULL} />);
    const svg = section(name).querySelector("svg")!;
    const temperature = curve(svg, ".hp-temperature:not(.hp-temperature--felt)");
    const felt = curve(svg, ".hp-temperature--felt");
    const wind = curve(svg, ".hp-wind:not(.hp-wind--gust)");
    const gusts = curve(svg, ".hp-wind--gust");
    for (const points of [temperature, felt, wind, gusts]) expect(points).toHaveLength(HOURS + 1);
    // Each day's drawn swing differs from the others' (as the values').
    const heights = Array.from({ length: DAYS }, (_, day) => range(dayOf(temperature.map((point) => point.y), day)));
    expect(new Set(heights.map((height) => height.toFixed(1))).size).toBe(DAYS);
    // Higher values higher up: the warmest hour is the highest point.
    const warmest = HELP_WEATHER.temperature.indexOf(Math.max(...HELP_WEATHER.temperature));
    expect(temperature[warmest]!.y).toBe(Math.min(...temperature.map((point) => point.y)));
    // The gusts above the wind at every hour, unevenly far.
    const gaps = wind.map((point, hour) => point.y - gusts[hour]!.y);
    for (const gap of gaps) expect(gap).toBeGreaterThan(0);
    expect(Math.min(...gaps)).toBeLessThan(0.25 * Math.max(...gaps));
    // The zero line at 0 °C between the curves' highest and lowest points.
    const zero = number(svg.querySelector(".hp-zero")!, "y1");
    const ys = [...temperature, ...felt].map((point) => point.y);
    expect(zero).toBeGreaterThan(Math.min(...ys));
    expect(zero).toBeLessThan(Math.max(...ys));
    // The curves stay inside their areas.
    for (const [area, points] of [
      ["temperature", [...temperature, ...felt]],
      ["wind", [...wind, ...gusts]],
    ] as const) {
      const rect = svg.querySelector(`[data-area="${area}"]`)!;
      for (const point of points) {
        expect(point.y).toBeGreaterThanOrEqual(number(rect, "y"));
        expect(point.y).toBeLessThanOrEqual(number(rect, "y") + number(rect, "height"));
      }
    }
  });

  // REQ-864: the clouds behind the precipitation in at least eight height steps (here twelve, one per kilometre up to
  // 12 km), in columns of the forecast's steps, in both pictures.
  it.each(["meteogram", "fullscreen"] as const)("the %s picture draws the clouds in at least eight height steps (REQ-864)", (name) => {
    expect(CLOUD_LAYERS).toBeGreaterThanOrEqual(8);
    expect(CLOUDS).toHaveLength(HOURS / CLOUD_COLUMN_HOURS);
    for (const column of CLOUDS) expect(column).toHaveLength(CLOUD_LAYERS);
    renderIn("de", <HelpSections context={FULL} />);
    const svg = section(name).querySelector("svg")!;
    const cells = [...svg.querySelectorAll<SVGElement>(".hp-cloud")];
    const area = svg.querySelector('[data-area="precipitation"]')!;
    const heights = new Set(cells.map((cell) => number(cell, "y").toFixed(2)));
    expect(heights.size).toBeGreaterThanOrEqual(8);
    expect(new Set(cells.map((cell) => cell.dataset.layer)).size).toBeGreaterThanOrEqual(8);
    for (const cell of cells) {
      expect(number(cell, "height")).toBeCloseTo(number(area, "height") / CLOUD_LAYERS, 5);
      expect(number(cell, "y")).toBeGreaterThanOrEqual(number(area, "y") - 0.01);
      expect(number(cell, "y") + number(cell, "height")).toBeLessThanOrEqual(number(area, "y") + number(area, "height") + 0.01);
      // The denser, the darker.
      const cover = CLOUDS[Math.round(((number(cell, "x") - number(area, "x")) / number(area, "width")) * CLOUDS.length)]![
        Number(cell.dataset.layer)
      ]!;
      expect(Number(cell.style.fillOpacity)).toBeCloseTo(0.05 + 0.45 * cover, 2);
    }
  });

  // REQ-864: the clouds fit the weather: ahead of the cold front high clouds first, their base lowering to the deep
  // frontal cloud of the heaviest rain; shower clouds of different heights behind it; (almost) none on the dry day.
  it("lets the clouds come down ahead of the front, showers behind it, none on the dry day (REQ-864, REQ-848)", () => {
    const km = (layer: number) => ((layer + 0.5) * CLOUD_TOP_KM) / CLOUD_LAYERS;
    const at = (hour: number) => CLOUDS[Math.floor(hour / CLOUD_COLUMN_HOURS)]!;
    const cloudy = (column: readonly number[]) => column.flatMap((cover, layer) => (cover >= 0.15 ? [layer] : []));
    const base = (hour: number) => km(Math.min(...cloudy(at(hour))));
    // Only high clouds (cirrus) at first, then lower and lower.
    expect(base(25)).toBeGreaterThanOrEqual(8);
    expect(base(31)).toBeLessThan(base(25));
    expect(base(38)).toBeLessThan(base(31));
    expect(base(46)).toBeLessThanOrEqual(2);
    // The front: deep and dense from low to high.
    const front = cloudy(at(46));
    expect(front.length).toBeGreaterThanOrEqual(7);
    expect(Math.max(...at(46))).toBeGreaterThanOrEqual(0.9);
    // Shower clouds behind it: of different heights and densities from column to column.
    const showers = Array.from({ length: 8 }, (_, index) => at(53 + index * 2));
    expect(new Set(showers.map((column) => Math.max(...cloudy(column)))).size).toBeGreaterThan(1);
    expect(new Set(showers.map((column) => column.join())).size).toBe(showers.length);
    // The dry day: at most one faint cell.
    const dry = CLOUDS.slice((DRY_DAY * DAY_HOURS) / CLOUD_COLUMN_HOURS).flat().filter((cover) => cover >= 0.15);
    expect(dry.length).toBeLessThanOrEqual(1);
    for (const cover of dry) expect(cover).toBeLessThan(0.3);
  });

  // REQ-864: the side bar of the full screen picture shows the curves' values at the red dashed line.
  it("shows the curves' values at the line in the full screen picture's side bar (REQ-864)", () => {
    renderIn("de", <HelpSections context={FULL} />);
    const svg = section("fullscreen").querySelector("svg")!;
    const area = svg.querySelector('[data-area="temperature"]')!;
    const hour = ((number(svg.querySelector("[data-now]")!, "x1") - number(area, "x")) / number(area, "width")) * HOURS;
    const values = [...svg.querySelectorAll(".hp-value")].map((value) => value.textContent);
    const at = (series: readonly number[]) => Math.round(valueAt(series, hour));
    expect(values).toHaveLength(6);
    expect(values[0]).toBe(`${at(HELP_WEATHER.temperature)}°C`);
    expect(values[1]).toBe(`${at(HELP_WEATHER.felt)}°C`);
    expect(values[4]).toBe(`${at(HELP_WEATHER.wind)} km/h`);
    expect(values[5]).toBe(`${at(HELP_WEATHER.gusts)} km/h`);
    // The precipitation where a bar stands, its probability not low.
    expect(Number.parseFloat(values[2]!)).toBeGreaterThan(0);
    expect(Number.parseFloat(values[3]!)).toBeGreaterThanOrEqual(30);
    // The felt temperature below the temperature, the gusts above the wind.
    expect(Number.parseFloat(values[1]!)).toBeLessThan(Number.parseFloat(values[0]!));
    expect(Number.parseFloat(values[5]!)).toBeGreaterThan(Number.parseFloat(values[4]!));
  });
});
