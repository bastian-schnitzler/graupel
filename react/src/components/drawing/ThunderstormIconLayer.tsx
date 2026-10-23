import React from "react";
import { CloudLightning, CloudHail } from "lucide-react";
import { canonicalTimestamp } from "../../utils/timeline";
import type { IconSlot } from "../../utils/thunderstormIcons";
import type { MeteogramLayout, MeteogramRenderMode } from "./meteogramLayout";

export type ThunderstormIcon = IconSlot & { code: number };

export interface ThunderstormIconLayerProps {
  icons: ThunderstormIcon[];
  /** Top of the area; glyphs sit just below it. */
  top: number;
  getX: (ts: number) => number;
  layout: MeteogramLayout;
  instance: MeteogramRenderMode;
}

/** Fixed-size thunderstorm glyphs (weather codes 95, 96, 99) per icon slot. */
export const ThunderstormIconLayer: React.FC<ThunderstormIconLayerProps> = ({
  icons,
  top,
  getX,
  layout,
  instance,
}) => (
  <>
    {icons.map((icon) => (
      <g
        key={icon.id}
        data-testid="thunderstorm-icon"
        data-weather-code={icon.code}
        data-interval-start={canonicalTimestamp(icon.start)}
        data-interval-end={canonicalTimestamp(icon.end)}
        data-center-x={getX(icon.center)}
        data-render-mode={instance}
        transform={`translate(${getX(icon.center)}, ${top + 11 * layout.windIconScaleY})`}
      >
        <g transform={`scale(${layout.windIconScaleX} ${layout.windIconScaleY})`}>
          <circle r="8" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="0.6" />
          <CloudLightning
            x={-7}
            y={-7}
            width={14}
            height={14}
            color="#7c3aed"
            strokeWidth={1.8}
          />
          {icon.code !== 95 && (
            <CloudHail
              x={-7}
              y={-7}
              width={14}
              height={14}
              color="#7c3aed"
              strokeWidth={icon.code === 99 ? 2.4 : 1.4}
            />
          )}
        </g>
      </g>
    ))}
  </>
);
