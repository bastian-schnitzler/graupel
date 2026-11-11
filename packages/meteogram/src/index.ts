// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * @graupel/meteogram: framework-free core of the Graupel meteogram.
 *
 * This entry point exports the calculation layer (geometry, paths, time
 * axis, wind, extremes, sun times, convection, tooltip data), the layout
 * schema with the built-in layouts, the quantity registry and the SVG
 * renderer (virtual tree, `toSvgString`, `mount`/`patch`).
 */

// Data types
export * from "./core/types";
export * from "./core/drawingTypes";

// Time axis and zoom
export * from "./core/timeline";
export * from "./core/zoom";
export * from "./core/timelineUtils";

// Geometry and paths
export * from "./core/chartGeometry";
export * from "./core/viewLayout";
export * from "./core/paths";
export * from "./core/chartData";
export * from "./core/cloudProfile";
export * from "./core/modelHeaderLabel";

// Quantity calculations
export * from "./core/calculations";
export * from "./core/convective";
export * from "./core/extremes";
export * from "./core/sunTimes";
export * from "./core/wind";
export * from "./core/thunderstormIcons";
export * from "./core/details";
export * from "./core/tooltip";
export * from "./core/models";
export * from "./core/locationLabel";
export * from "./core/input";
export * from "./core/spread";
export * from "./core/relativeHumidity";

// Design configuration (theme tokens, locale and texts)
export * from "./core/theme";
export * from "./core/texts";
export { contrastRatio, readableTextColor } from "./core/color";

// Layouts
export * from "./layouts/types";
export * from "./layouts/builtin";
export * from "./layouts/resolution";
export * from "./layouts/quantities";
export * from "./layouts/seriesPresets";
export * from "./layouts/toggles";
export * from "./layouts/tooltip";

// Quantities
export * from "./quantities/types";
export * from "./quantities/registry";
export * from "./quantities/builtin";
export * from "./quantities/derived";

// Renderer (virtual SVG tree, string output, DOM mount/patch)
export * from "./render/index";

// Controller: mount, hover, tooltip, zoom, resize, keyboard (PNG export: "@graupel/meteogram/png")
export * from "./interaction/index";
