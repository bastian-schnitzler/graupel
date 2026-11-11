// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import type { AreaGeometry } from "../core/chartGeometry";
import {
  calculateCloudCellGeometry,
  getCloudAltitudeY,
} from "../core/cloudProfile";
import { canonicalTimestamp } from "../core/timeline";
import type { VerticalCloudLevel } from "../core/types";
import { getTextTransform } from "../core/viewLayout";
import type { ResolvedBackground } from "../layouts/types";
import { AXIS_LABEL_LINE_HEIGHT, axisLabelHalo, axisLabelLines, insideRightLabelX } from "./axisLabels";
import { withHalo } from "./halo";
import type { ChartAreaContext } from "./chartArea";
import { drawingArea } from "./drawingArea";
import { h, type VInput } from "./vnode";

export interface CloudTransitionX {
  x: number;
  timestampMs: number;
  to_model: string;
}

const ALTITUDE_STEPS_KM = [12, 9, 6, 3, 0];

export interface CloudProfileBackgroundProps {
  geometry: AreaGeometry;
  background: ResolvedBackground;
  /** Profiles exist; without them only the cloud-chain markers are drawn. */
  hasData: boolean;
  context: ChartAreaContext;
  clipId: string;
}

/**
 * Vertical cloud profile behind an area's series, with the cloud-chain
 * boundary markers and the altitude scale on the right. The first entry
 * holds the altitude labels, which `axisLabels.align` "inside" draws after
 * the data.
 */
export function cloudProfileBackground({
  geometry,
  background,
  hasData,
  context,
  clipId,
}: CloudProfileBackgroundProps): VInput[] {
  const { top, height, bottom } = geometry;
  const { maxAltitudeKm } = background;
  const {
    paddingLeft,
    paddingRight,
    svgWidth,
    timestamps,
    timeline,
    vcloudMap,
    draggedCloudX,
    cloudTransitionXs,
    theme,
  } = context;
  const colors = theme.cloud;
  const atEdge = context.axisLabels.align !== "plot";
  const inside = context.axisLabels.align === "inside";
  const getAltitudeY = (altKm: number) =>
    getCloudAltitudeY(geometry, maxAltitudeKm, altKm);
  const altitudeSteps = ALTITUDE_STEPS_KM.filter((km) => km <= maxAltitudeKm);

  const cloudColumns = timestamps.map((ts, idx) => {
    const cell = timeline.intervalToGeometry(ts);
    if (!cell) return null;
    const { x, width: cellWidth } = cell;
    const profile = vcloudMap.get(ts);

    if (!profile || !profile.levels || profile.levels.length === 0) {
      return h("rect", {
        key: `vcloud-missing-${idx}`,
        x,
        y: top + 10,
        width: cellWidth,
        height: height - 10,
        fill: colors.missing,
        opacity: "0.5",
      });
    }

    const levels: VerticalCloudLevel[] = profile.levels || [];
    return h(
      "g",
      { key: `vcloud-col-${idx}` },
      levels.map((lvl, lIdx) => {
        const cc = lvl.cloud_cover_percent;
        if (cc === null || cc === undefined || cc <= 0) return null;

        const altM = lvl.altitude_m_asl ?? 0;
        const altKm = altM / 1000.0;
        if (altKm > maxAltitudeKm) return null;

        const nextLvl = levels[lIdx + 1];
        const nextAltKm = nextLvl?.altitude_m_asl
          ? nextLvl.altitude_m_asl / 1000.0
          : altKm + 0.6;

        const {
          y,
          height: cellHeight,
          opacity,
        } = calculateCloudCellGeometry(cc, altKm, nextAltKm, maxAltitudeKm, getAltitudeY);

        return h("rect", {
          key: `vcloud-cell-${idx}-${lIdx}`,
          x,
          y,
          width: cellWidth,
          height: cellHeight,
          fill: colors.fill,
          opacity,
          "data-testid": "vertical-cloud-cell",
          "data-timestamp": canonicalTimestamp(ts),
          "data-cloud-cover": cc,
        });
      }),
    );
  });

  return [
    hasData &&
      background.altitudeLabels &&
      altitudeSteps.map((altKm) => {
        const y = getAltitudeY(altKm);
        const lines = axisLabelLines(altKm, "km", context.axisLabels.unit === "below");
        // Over the plot 1 unit off the right edge, as the left labels (REQ-622).
        const x = inside ? insideRightLabelX(svgWidth) : atEdge ? svgWidth : svgWidth - paddingRight + 8;
        const attrs = {
          fill: colors.altitudeLabel,
          "font-size": theme.fontSizes.altitude,
          "text-anchor": atEdge ? "end" : "start",
          "data-testid": `cloud-altitude-label-${altKm}`,
        };
        // Over the plot a halo behind the label, as its own element (REQ-747).
        const halo = inside ? axisLabelHalo(theme) : null;
        if (lines.length === 1) {
          return withHalo(
            h(
              "text",
              {
                key: `vcloud-alt-label-${altKm}`,
                x,
                y: y + 3,
                transform: getTextTransform(x, y + 3, context.pixelLayout.textScaleX),
                ...attrs,
              },
              lines[0],
            ),
            halo,
          );
        }
        // Value just above the altitude line, unit just below it.
        const lineHeight = Math.round(theme.fontSizes.altitude * AXIS_LABEL_LINE_HEIGHT * 100) / 100;
        return withHalo(
          h(
            "text",
            {
              key: `vcloud-alt-label-${altKm}`,
              x,
              y: y - 1,
              transform: getTextTransform(x, y - 1, context.pixelLayout.textScaleX),
              "data-lines": lines.length,
              ...attrs,
            },
            lines.map((line, index) => h("tspan", { key: index, x, ...(index > 0 ? { dy: lineHeight } : {}) }, line)),
          ),
          halo,
        );
      }),

    hasData &&
      drawingArea(
        {
          className: "cloud-profile-layer",
          testId: "cloud-profile-layer",
          clipId,
          bounds: {
            top,
            height,
            left: paddingLeft,
            width: svgWidth - paddingLeft - paddingRight,
          },
        },
        [
          altitudeSteps.map((altKm) => {
            const y = getAltitudeY(altKm);
            return h("line", {
              key: `vcloud-alt-line-${altKm}`,
              x1: paddingLeft,
              y1: y,
              x2: svgWidth - paddingRight,
              y2: y,
              stroke: colors.altitudeLine,
              "stroke-dasharray": "2 3",
            });
          }),
          cloudColumns,
        ],
      ),

    // Interactive drag indicator: cloud model boundary
    draggedCloudX !== null &&
      h(
        "g",
        {
          class: "vcloud-drag-boundary-indicator",
          "data-testid": "vcloud-drag-boundary-indicator",
          "clip-path": `url(#${clipId})`,
        },
        h("line", {
          x1: draggedCloudX,
          y1: top,
          x2: draggedCloudX,
          y2: bottom,
          stroke: colors.boundary,
          "stroke-width": "1",
          opacity: String(colors.boundaryOpacity),
          "data-testid": "cloud-boundary-drag-line",
          "data-timestamp": canonicalTimestamp(timeline.xToTimestamp(draggedCloudX)),
        }),
      ),

    cloudTransitionXs.map((transition) =>
      h("line", {
        key: `cloud-transition-${transition.timestampMs}-${transition.to_model}`,
        x1: transition.x,
        y1: top,
        x2: transition.x,
        y2: bottom,
        stroke: colors.boundary,
        "stroke-width": "1",
        opacity: String(colors.boundaryOpacity),
        "clip-path": `url(#${clipId})`,
        "data-testid": "cloud-model-boundary-line",
        "data-timestamp": canonicalTimestamp(transition.timestampMs),
      }),
    ),
  ];
}
