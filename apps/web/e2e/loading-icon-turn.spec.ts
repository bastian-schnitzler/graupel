// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The loading symbol turns on the spot (REQ-860): the refresh symbol before "Loading forecast…" in the day slider's box
 * (REQ-737) and the one in the place field while another place loads (REQ-751) turn about their own centre, the centre
 * of the circle, without wandering. On the iPhone the picture lay between pixels and Safari turned it about another
 * point than it drew it at; now the group inside the picture turns, about the view box's centre, and the picture itself
 * stands still. The test stops the animation at several phases (Web Animations API) and measures there.
 */
import { expect, onlyIn, test, type Locator } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Wednesday, 28 October 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 9, 28, 11);
/** How far the centre may wander, in CSS px. */
const TOLERANCE = 0.5;
/** Phases of a turn at which the animation stops: every eighth. */
const PHASES = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];

test.use({ timezoneId: "UTC" });

let errors: string[] = [];
/** While set, forecast answers wait for it. */
let hold: Promise<void> | null = null;
let release: () => void = () => {};

/** Lets Open-Meteo's answers wait until `release()`. */
function holdAnswers() {
  hold = new Promise((resolve) => (release = resolve));
}

test.beforeEach(async ({ page }) => {
  errors = [];
  hold = null;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", async (route) => {
    if (hold) await hold;
    return fakeForecast(route, { now: FIXED_NOW });
  });
});

test.afterEach(() => {
  release();
  expect(errors).toEqual([]);
});

interface Phase {
  phase: number;
  /** The picture's box (the `svg`). */
  picture: { x: number; y: number; width: number; height: number };
  /** Middle of the box of the turning group's shape (circle and arrowhead). */
  shape: { x: number; y: number };
  /** Where the circle's centre (12, 12 in the view box) and the arrowhead's tip (20, 4) are drawn. */
  centre: { x: number; y: number };
  tip: { x: number; y: number };
  animation: string;
}

/** Stops the symbol's turn at each of `PHASES` and measures it there. */
function measure(icon: Locator) {
  return icon.evaluate((svg, phases) => {
    const turn = svg.querySelector(".icon__turn") as SVGGElement;
    const [animation] = turn.getAnimations();
    if (!animation) throw new Error("the symbol does not turn");
    animation.pause();
    const duration = Number(animation.effect!.getComputedTiming().duration);
    const point = (x: number, y: number) => {
      const drawn = new DOMPoint(x, y).matrixTransform(turn.getScreenCTM()!);
      return { x: drawn.x, y: drawn.y };
    };
    const result = phases.map((phase) => {
      animation.currentTime = duration * phase;
      const picture = svg.getBoundingClientRect();
      const shape = turn.getBoundingClientRect();
      return {
        phase,
        picture: { x: picture.x, y: picture.y, width: picture.width, height: picture.height },
        shape: { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 },
        centre: point(12, 12),
        tip: point(20, 4),
        animation: (animation as CSSAnimation).animationName,
      };
    });
    animation.play();
    return result;
  }, PHASES) as Promise<Phase[]>;
}

/** The symbol turns about its own middle: in every phase the circle's centre stays, the picture stands still. */
function expectTurnOnTheSpot(phases: Phase[], name: string) {
  const first = phases[0]!;
  const middle = { x: first.picture.x + first.picture.width / 2, y: first.picture.y + first.picture.height / 2 };
  const scale = first.picture.width / 24;
  for (const phase of phases) {
    expect(phase.animation, `phase ${phase.phase}`).toBe(name);
    // The picture itself neither moves nor turns: the same box in every phase.
    expect(phase.picture, `phase ${phase.phase}`).toEqual(first.picture);
    // The circle's centre is the picture's middle, in every phase.
    expect(Math.abs(phase.centre.x - middle.x), `centre x, phase ${phase.phase}`).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(phase.centre.y - middle.y), `centre y, phase ${phase.phase}`).toBeLessThanOrEqual(TOLERANCE);
    // The arrowhead goes round that middle, by the phase's angle: it turns, about that point.
    const angle = phase.phase * 2 * Math.PI;
    const [dx, dy] = [8 * scale, -8 * scale];
    const tip = {
      x: middle.x + dx * Math.cos(angle) - dy * Math.sin(angle),
      y: middle.y + dx * Math.sin(angle) + dy * Math.cos(angle),
    };
    expect(Math.abs(phase.tip.x - tip.x), `tip x, phase ${phase.phase}`).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(phase.tip.y - tip.y), `tip y, phase ${phase.phase}`).toBeLessThanOrEqual(TOLERANCE);
  }
  // A quarter turn lays the shape (circle with the arrowhead in a corner of its square) onto itself again: there the
  // middle of its box is the same in every phase.
  for (const phase of phases.filter((each) => (each.phase * 4) % 1 === 0)) {
    expect(Math.abs(phase.shape.x - middle.x), `box x, phase ${phase.phase}`).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(phase.shape.y - middle.y), `box y, phase ${phase.phase}`).toBeLessThanOrEqual(TOLERANCE);
  }
}

test.describe("day slider (REQ-860)", () => {
  test("the symbol before \"Loading forecast…\" turns on the spot; size and place stay", async ({ page }) => {
    holdAnswers();
    await page.goto(APP);
    const message = page.getByTestId("forecast-loading");
    await expect(message).toHaveText("Loading forecast…");
    const icon = message.locator(".day-slider__loading-icon");
    await expect(icon).toBeVisible();
    const before = (await icon.boundingBox())!;
    // 1.125 rem, right before the text and in the middle of its line.
    expect(before.width).toBeCloseTo(18, 1);
    expect(before.height).toBeCloseTo(18, 1);
    const text = await message.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element.lastChild!);
      const box = range.getBoundingClientRect();
      return { x: box.x, y: box.y, height: box.height };
    });
    expect(before.x + before.width).toBeLessThanOrEqual(text.x);
    expect(Math.abs(before.y + before.height / 2 - (text.y + text.height / 2))).toBeLessThan(2);

    const phases = await measure(icon);
    expectTurnOnTheSpot(phases, "day-slider-loading-turn");
    expect(phases[0]!.picture).toEqual({ x: before.x, y: before.y, width: before.width, height: before.height });
    // Still turning after the measurement, in the same place.
    await page.waitForTimeout(300);
    expect(await icon.boundingBox()).toEqual(before);
    release();
    await expect(message).toHaveCount(0);
  });
});

test.describe("place field (REQ-860)", () => {
  onlyIn(["phone", "tablet"], "the turning symbol in the place field belongs to the phone's design (REQ-751, REQ-728)");

  test("the field's turning symbol turns on the spot; size and place stay", async ({ page }) => {
    const location = page.locator('[data-region="location"]');
    const icon = location.locator(".location__gps svg");
    await page.goto(APP);
    await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
    await expect(icon).toHaveAttribute("data-icon", "gps");
    const gps = (await icon.boundingBox())!;

    holdAnswers();
    await location.getByRole("button", { name: "Show favourites" }).click();
    await location.getByRole("menu", { name: "Favourites" }).getByRole("menuitem", { name: "Matterhorn" }).click();
    await expect(icon).toHaveAttribute("data-icon", "refresh");
    await expect(icon).toBeVisible();
    // In the GPS symbol's place, as large.
    expect(await icon.boundingBox()).toEqual(gps);

    expectTurnOnTheSpot(await measure(icon), "location-loading-turn");
    release();
    await expect(icon).toHaveAttribute("data-icon", "gps");
  });
});
