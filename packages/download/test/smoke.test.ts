// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Smoke test in Node: a whole auto chain with the default client options (only fetch injected).
import { expect, it } from "vitest";
import { runSmoke } from "./smoke";

it("downloads an auto chain in Node", async () => {
  expect(typeof window).toBe("undefined");
  await runSmoke();
});

it("has no runtime dependencies", async () => {
  const { readFileSync } = await import("node:fs");
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as Record<string, unknown>;
  expect(manifest.dependencies ?? {}).toEqual({});
  expect(manifest.peerDependencies ?? {}).toEqual({});
});
