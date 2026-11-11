// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Values of the meteogram layout's switches as chosen in the settings (REQ-661): dew point (REQ-593), relative humidity
 * (REQ-650) and whether the precipitation and wind axes follow the visible range (REQ-656). The same object while the
 * settings stay, for the chart on the page, the full-screen view and the picture.
 */
import { useMemo } from "react";
import { useDewPoint, useRelativeHumidity, useScaleToVisibleRange } from "../../state/displaySettings.ts";
import { meteogramToggles, type MeteogramToggles } from "./layout.ts";

export function useMeteogramToggles(): MeteogramToggles {
  const dewPoint = useDewPoint();
  const relativeHumidity = useRelativeHumidity();
  const scaleToVisibleRange = useScaleToVisibleRange();
  return useMemo(
    () => meteogramToggles(dewPoint, relativeHumidity, scaleToVisibleRange),
    [dewPoint, relativeHumidity, scaleToVisibleRange],
  );
}
