// @vitest-environment jsdom
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Smoke test in a browser-like environment (jsdom): the same auto chain as in Node.
import { expect, it } from "vitest";
import { runSmoke } from "./smoke";

it("downloads an auto chain in jsdom", async () => {
  expect(typeof window).toBe("object");
  expect(typeof document.createElement).toBe("function");
  await runSmoke();
});
