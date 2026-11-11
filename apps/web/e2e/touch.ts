// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/** Touch input of the end-to-end tests: one finger (or two) moved step by step, for pull to refresh (REQ-638, REQ-750). */
import type { CDPSession } from "@playwright/test";
import type { Page } from "./fixtures.ts";

/** One finger on the screen, moved by the test step by step (Chromium's touch input through CDP). */
export class Finger {
  private constructor(
    private readonly cdp: CDPSession,
    private x: number,
    private y: number,
  ) {}

  /** Puts a finger down at (`x`, `y`), or two fingers side by side with `two`. */
  static async down(page: Page, x: number, y: number, two = false) {
    const finger = new Finger(await page.context().newCDPSession(page), x, y);
    finger.two = two;
    await finger.send("touchStart");
    return finger;
  }

  private two = false;

  private points() {
    const point = { x: this.x, y: this.y, radiusX: 4, radiusY: 4, force: 1, id: 1 };
    return this.two ? [point, { ...point, x: this.x + 60, id: 2 }] : [point];
  }

  private send(type: "touchStart" | "touchMove") {
    return this.cdp.send("Input.dispatchTouchEvent", { type, touchPoints: this.points() });
  }

  /** Moves by (`dx`, `dy`) in `steps` even steps. */
  async move(dx: number, dy: number, steps = 10) {
    const [x, y] = [this.x, this.y];
    for (let step = 1; step <= steps; step++) {
      this.x = x + (dx * step) / steps;
      this.y = y + (dy * step) / steps;
      await this.send("touchMove");
    }
  }

  async up() {
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await this.cdp.detach();
  }
}
