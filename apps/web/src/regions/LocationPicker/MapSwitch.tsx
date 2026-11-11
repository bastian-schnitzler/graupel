// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Switch between OpenTopoMap and Maptoolkit in the full-screen map (REQ-659, DEC-065). On the desktop a preview tile in
 * the bottom-left corner shows a picture (REQ-675) and the name of the other map; on a phone (`MAP_PHONE_QUERY`) a layers
 * button sits top right under the zoom buttons, in the style of the shown map's controls. Either one changes to the
 * other map.
 */
import type { MapProvider } from "../../config/index.ts";
import { useT } from "../../i18n/index.ts";
import { MAP_PROVIDER_NAMES, otherMapProvider } from "../../state/index.ts";
import { Icon } from "./Icon.tsx";
import maptoolkitPreview from "./images/maptoolkit.webp";
import openTopoMapPreview from "./images/opentopomap.webp";

/**
 * Pictures of the two maps (REQ-675): the halves of Bastian's sample, the flat light one for OpenTopoMap, the shaded one
 * for Maptoolkit (left half x 0-876, right half x 899-1774 of the sample, each the middle square), shrunk to 160 px (twice the tile, for sharp screens) as WebP. Bundled assets, so they show
 * without loading anything from the map servers.
 */
const MAP_PREVIEW_IMAGES: Readonly<Record<MapProvider, string>> = {
  opentopomap: openTopoMapPreview,
  maptoolkit: maptoolkitPreview,
};

export interface MapSwitchProps {
  /** The map shown now; the switch changes to the other one. */
  provider: MapProvider;
  /** Phone layout (`MAP_PHONE_QUERY`): the layers button under the zoom instead of the preview tile. */
  phone: boolean;
  onSwitch: (next: MapProvider) => void;
}

export function MapSwitch({ provider, phone, onSwitch }: MapSwitchProps) {
  const t = useT();
  const next = otherMapProvider(provider);
  const name = MAP_PROVIDER_NAMES[next];
  const label = t("location.map.switch", { name });
  if (phone) {
    return (
      <button
        type="button"
        className="map-switch map-switch--button"
        data-target={next}
        aria-label={label}
        title={label}
        onClick={() => onSwitch(next)}
      >
        <Icon name="layers" />
      </button>
    );
  }
  return (
    <button
      type="button"
      className="map-switch map-switch--tile"
      data-target={next}
      aria-label={label}
      title={label}
      onClick={() => onSwitch(next)}
    >
      <img
        className="map-switch__picture"
        src={MAP_PREVIEW_IMAGES[next]}
        alt=""
        width={80}
        height={80}
        draggable={false}
      />
      <span className="map-switch__icon">
        <Icon name="layers" />
      </span>
      <span className="map-switch__name" aria-hidden="true">
        {name}
      </span>
    </button>
  );
}
