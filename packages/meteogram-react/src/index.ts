// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * @graupel/meteogram-react: React shell of the meteogram library. The
 * component wraps the controller of `@graupel/meteogram`; the core's types
 * used in its props are re-exported for convenience.
 */
export { Meteogram, sameValue, type MeteogramComponentOptions, type MeteogramProps } from "./Meteogram";
export type {
  DayRangeChoice,
  MeteogramController,
  MeteogramHoverInfo,
  MeteogramInput,
  MeteogramOptions,
  TimeRange,
} from "@graupel/meteogram";
