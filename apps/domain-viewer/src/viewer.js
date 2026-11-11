// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later

// Model Domain Viewer: map and sidebar. The data comes from model-data/ (data/*.json, written by
// scripts/prebuild.mjs), and the geometry handling lives in lib.js. Leaflet, MapLibre GL and maplibre-gl-leaflet are loaded as classic scripts
// (global L) before this module.
/* global L */

import {
  BANDS,
  GROUPS,
  OFF_BY_DEFAULT,
  buildModels,
  buildRegions,
  buildZones,
  escapeHtml,
  inParts,
  modelsAt,
  regionAt,
  wrapLon,
  zoneAt,
  zoneOrigin,
} from "./lib.js";

const status = /** @type {HTMLElement} */ (document.getElementById("status"));

async function loadJson(/** @type {string} */ file) {
  const response = await fetch(`data/${file}`);
  if (!response.ok) throw new Error(`data/${file}: HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const [domainsDoc, catalogueDoc, zonesDoc, zonesGeo, regionsGeo] = await Promise.all(
    ["model_domains.json", "model_catalogue.json", "chain_zones.json", "chain_zones.geojson", "regions.geojson"].map(
      loadJson,
    ),
  );
  const models = buildModels(domainsDoc, catalogueDoc);
  const zoneData = buildZones(zonesDoc, zonesGeo);
  const regions = buildRegions(regionsGeo);
  status.textContent = "";
  init(models, zoneData, regions);
  document.body.dataset.ready = "true";
}

main().catch((error) => {
  status.textContent = `Could not load the model data: ${error.message}`;
  status.classList.add("error");
  console.error(error);
});

/**
 * @param {import("./lib.js").Model[]} modelData
 * @param {import("./lib.js").Zone[]} zoneData
 * @param {import("./lib.js").Region[]} regions
 */
function init(modelData, zoneData, regions) {
  /** @type {any[]} models with view state */
  const models = modelData.map((m) => ({ ...m }));
  const regional = models.filter((m) => m.ring);
  const globals = models.filter((m) => !m.ring);
  // "ICON-D2 (48h, 2.2km)"
  const label = (/** @type {any} */ m) => `${m.name} (${m.hours}h, ${m.resolution_km}km)`;
  const CLOUD = "☁";
  // Name and short name with the cloud mark: what the tooltip and the list show.
  const title = (/** @type {any} */ m) =>
    `${escapeHtml(label(m))}${m.short_name && m.short_name !== m.name ? ` · ${escapeHtml(m.short_name)}` : ""}` +
    (m.cloud ? ` <span title="cloud profile">${CLOUD}</span>` : "");

  // Distinct hues by golden-angle stepping.
  regional.forEach((m, i) => {
    m.color = `hsl(${(i * 137.508) % 360} 75% 50%)`;
  });

  // Preload two screens on each side so panning sideways never reveals
  // undrawn domains or basemap (both redraw only after a move ends).
  const PRELOAD = 2;
  const map = L.map("map", {
    worldCopyJump: false,
    minZoom: 1,
    renderer: L.svg({ padding: PRELOAD }),
  }).setView([30, 0], 1);
  /** @type {any} */ (window).domainMap = map; // for debugging, screenshots and the end-to-end tests
  // OpenFreeMap vector tiles (free, no key; DEC-010). The Liberty style labels places
  // as "latin\nnon-latin"; every name label is reduced to the Latin name.
  // Tiles, fonts and sprites stay cached for 90 days (sw.js). Service
  // workers need http(s); opened from disk the browser cache alone applies.
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  const LATIN_NAME = ["coalesce", ["get", "name:latin"], ["get", "name_en"], ["get", "name"]];
  fetch("https://tiles.openfreemap.org/styles/liberty")
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((style) => {
      for (const layer of style.layers) {
        const text = layer.layout && layer.layout["text-field"];
        if (text && JSON.stringify(text).includes("name:latin")) {
          layer.layout["text-field"] = LATIN_NAME;
        }
      }
      L.maplibreGL({
        style,
        // One screen per side for the basemap: two would need a canvas of
        // ~86 Mpx at device pixel ratio 2. MapLibre caps the canvas at
        // 4096 px by default and then renders blurry text.
        padding: 1,
        maxCanvasSize: [16384, 16384],
        // Keep decoded tiles in memory, so panning back and forth across
        // world copies does not fetch or decode them again.
        maxTileCacheSize: 4000,
        attribution:
          '<a href="https://openfreemap.org">OpenFreeMap</a>' +
          ' &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a>' +
          ' &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      }).addTo(map);
    })
    // Without the base map (offline, no WebGL) the domains still show.
    .catch((error) => console.warn("Base map not available:", error));

  // Leaflet expects [lat, lon]; rings keep unwrapped longitudes (lib.js normalizeRing).
  // Models with the identical polygon share one shape: a dashed border
  // alternating their colours and a striped fill.
  /** @type {Map<string, { members: any[], layers: any[] }>} */
  const shapes = new Map();
  for (const m of regional) {
    m.latlngs = m.ring.map((/** @type {number[]} */ [lon, lat]) => [lat, lon]);
    m.outlineLatlngs = m.outline.map((/** @type {number[]} */ [lon, lat]) => [lat, lon]);
    m.bounds = L.latLngBounds(m.latlngs);
    m.visible = false;
    const key = JSON.stringify(m.ring);
    if (!shapes.has(key)) shapes.set(key, { members: [], layers: [] });
    /** @type {{ members: any[] }} */ (shapes.get(key)).members.push(m);
  }

  const DASH = 10;
  const STRIPE = 6;
  /** @type {SVGDefsElement | null} */
  let defs = null;
  function stripePattern(/** @type {string[]} */ colors) {
    const id = "stripes-" + colors.join("-").replace(/[^a-z0-9-]/gi, "");
    const ns = "http://www.w3.org/2000/svg";
    if (!defs) {
      const svg = /** @type {SVGSVGElement} */ (map.getPanes().overlayPane.querySelector("svg"));
      defs = /** @type {SVGDefsElement} */ (document.createElementNS(ns, "defs"));
      svg.prepend(defs);
    }
    if (!defs.querySelector(`#${id}`)) {
      const pattern = document.createElementNS(ns, "pattern");
      const size = STRIPE * colors.length;
      pattern.id = id;
      pattern.setAttribute("patternUnits", "userSpaceOnUse");
      pattern.setAttribute("width", String(size));
      pattern.setAttribute("height", String(size));
      pattern.setAttribute("patternTransform", "rotate(45)");
      colors.forEach((c, i) => {
        const rect = document.createElementNS(ns, "rect");
        rect.setAttribute("x", String(i * STRIPE));
        rect.setAttribute("width", String(STRIPE));
        rect.setAttribute("height", String(size));
        rect.setAttribute("fill", c);
        pattern.append(rect);
      });
      defs.append(pattern);
    }
    return `url(#${id})`;
  }

  // Fill opacities: single colour, striped (stripes are fully coloured).
  const FILL = { plain: [0.12, 0.25], striped: [0.22, 0.4] };
  // World copies so the same domains reappear when panning east or west:
  // the visible worlds plus one on each side, redrawn when the view moves.
  /** @type {number[]} */
  let copies = [];
  function worldCopies() {
    const b = map.getBounds().pad(PRELOAD);
    const first = Math.floor((b.getWest() + 180) / 360) - 1;
    const last = Math.floor((b.getEast() + 180) / 360) + 1;
    const out = [];
    for (let k = first; k <= last; k++) out.push(k * 360);
    return out;
  }
  const shift = (/** @type {number[][]} */ latlngs, /** @type {number} */ dx) =>
    latlngs.map(([lat, lon]) => [lat, /** @type {number} */ (lon) + dx]);

  let activeTab = "domains";
  function drawShape(/** @type {{ members: any[], layers: any[] }} */ shape) {
    for (const layer of shape.layers) layer.remove();
    shape.layers = [];
    if (activeTab !== "domains") return;
    const shown = shape.members.filter((m) => m.visible);
    if (!shown.length) return;
    const n = shown.length;
    // Fill and border apart: the border of a domain closed over the pole (RDPS) leaves out the closure.
    for (const dx of copies) {
      const latlngs = shift(shown[0].latlngs, dx);
      const outline = shift(shown[0].outlineLatlngs, dx);
      if (n === 1) {
        const m = shown[0];
        const layer = L.polygon(latlngs, {
          stroke: false,
          fillColor: m.color,
          fillOpacity: FILL.plain[0],
          interactive: false,
        }).addTo(map);
        layer.fill = FILL.plain;
        shape.layers.push(layer, L.polyline(outline, { color: m.color, weight: 1.5, interactive: false }).addTo(map));
        continue;
      }
      const fill = L.polygon(latlngs, { stroke: false, fillOpacity: 0, interactive: false }).addTo(map);
      fill.setStyle({
        fillColor: stripePattern(shown.map((m) => m.color)),
        fillOpacity: FILL.striped[0],
      });
      fill.fill = FILL.striped;
      shape.layers.push(fill);
      shown.forEach((m, i) => {
        shape.layers.push(
          L.polyline(outline, {
            color: m.color,
            weight: 2,
            interactive: false,
            dashArray: `${DASH} ${DASH * (n - 1)}`,
            dashOffset: `${i * DASH}`,
          }).addTo(map),
        );
      });
    }
  }
  const highlight = (/** @type {any[]} */ hits) => {
    for (const shape of shapes.values()) {
      const on = shape.members.some((m) => hits.includes(m));
      for (const layer of shape.layers) {
        if (layer.fill) layer.setStyle({ fillOpacity: layer.fill[on ? 1 : 0] });
      }
    }
  };

  const tooltip = L.tooltip({ className: "domains", direction: "right", offset: [14, 0] });
  map.on("mousemove", (/** @type {any} */ e) => {
    const lon = wrapLon(e.latlng.lng);
    if (activeTab === "chains") {
      hoverChains(e, lon);
      return;
    }
    // Every model covering the point, also hidden ones (grey): the
    // tooltip answers "what is available here" whatever is drawn.
    const hits = modelsAt(regional, lon, e.latlng.lat);
    // Models sharing the identical area are bracketed together.
    const item = (/** @type {any} */ m) => `<span style="color:${m.visible ? m.color : "#94a3b8"}">${title(m)}</span>`;
    // Finest spatial resolution first; a bracketed group sorts by its finest.
    const byRes = (/** @type {any} */ a, /** @type {any} */ b) =>
      a.resolution_km - b.resolution_km || a.name.localeCompare(b.name);
    const groups = [];
    for (const shape of shapes.values()) {
      const shared = shape.members.filter((m) => hits.includes(m)).sort(byRes);
      if (shared.length) groups.push(shared);
    }
    groups.sort((a, b) => byRes(a[0], b[0]));
    const lines = groups.map((g) => (g.length === 1 ? item(g[0]) : `[ ${g.map(item).join(",<br>&nbsp;&nbsp;")} ]`));
    const hidden = hits.some((m) => !m.visible) ? `<span class="muted">grey: hidden on the map</span>` : "";
    const cloud = hits.some((m) => m.cloud) ? `<span class="muted">${CLOUD} cloud profile</span>` : "";
    const global = `<span class="muted">+ ${globals.length} global models</span>`;
    tooltip.setLatLng(e.latlng).setContent(lines.map((l) => `<b>${l}</b>`).join("") + global + cloud + hidden);
    if (!map.hasLayer(tooltip)) tooltip.addTo(map);
    highlight(hits.filter((m) => m.visible));
  });
  map.on("mouseout", () => {
    map.closeTooltip(tooltip);
    highlight([]);
    highlightRegion(null);
  });

  // Visibility state:
  // - m.checked: a regional model's own checkbox; every bulk action sets it.
  // - groupOn: a category is enabled; disabling it unchecks its models.
  // Horizon chips and category checkboxes are derived from the models:
  // all shown = checked, some = partial (dashed, translucent tick), none =
  // unchecked. A horizon chip only touches models in enabled categories;
  // a category checkbox shows every model in it, whatever its horizon.
  /** @type {Record<string, boolean>} */
  const groupOn = Object.fromEntries(GROUPS.map((g) => [g, !OFF_BY_DEFAULT.includes(g)]));
  for (const m of regional) m.checked = groupOn[m.group];

  function setTick(/** @type {HTMLInputElement} */ box, /** @type {boolean} */ all, /** @type {boolean} */ some) {
    box.checked = all;
    box.classList.toggle("partial", !all && some);
    box.indeterminate = false;
    box.setAttribute("aria-checked", all ? "true" : some ? "mixed" : "false");
  }
  const tickState = (/** @type {any[]} */ list) => [
    list.length > 0 && list.every((m) => m.checked),
    list.some((m) => m.checked),
  ];

  const filters = /** @type {HTMLElement} */ (document.getElementById("filters"));
  /** @type {Array<{ band: string, box: HTMLInputElement }>} */
  const chips = [];
  for (const b of BANDS) {
    const chip = document.createElement("label");
    chip.innerHTML = `<input type="checkbox" class="tick"> ${escapeHtml(b.label)}`;
    const box = /** @type {HTMLInputElement} */ (chip.querySelector("input"));
    box.addEventListener("change", () => {
      const inBand = regional.filter((m) => m.band === b.id && groupOn[m.group]);
      const [all] = tickState(inBand);
      if (all) {
        for (const m of regional) if (m.band === b.id) m.checked = false;
      } else {
        for (const m of inBand) m.checked = true;
      }
      refresh();
    });
    chips.push({ band: b.id, box });
    filters.append(chip);
  }
  /** @type {Array<{ group: string, box: HTMLInputElement, members: any[] }>} */
  const headings = [];

  function refresh() {
    for (const m of models) {
      // Rows stay listed; hidden models are dimmed like an unchecked model.
      if (!m.ring) {
        m.row.classList.toggle("off", !groupOn[m.group]);
        continue;
      }
      m.visible = m.checked;
      m.box.checked = m.checked;
      m.row.classList.toggle("off", !m.checked);
    }
    for (const shape of shapes.values()) drawShape(shape);
    autoCollapse();
    for (const { band, box } of chips) {
      const [all, some] = tickState(regional.filter((m) => m.band === band && groupOn[m.group]));
      setTick(box, /** @type {boolean} */ (all), /** @type {boolean} */ (some));
    }
    for (const { group, box, members } of headings) {
      const withLayers = members.filter((m) => m.ring);
      if (!withLayers.length) {
        setTick(box, /** @type {boolean} */ (groupOn[group]), false);
        continue;
      }
      const [all, some] = tickState(withLayers);
      setTick(box, Boolean(groupOn[group] && all), Boolean(groupOn[group] && some));
    }
  }

  // Collapsible category headings. After every map move a category is
  // expanded when one of its entries lies in the view and collapsed
  // otherwise; the chevron toggles it by hand until the next move.
  /** @type {Array<{ title: string, body: HTMLElement, chev: HTMLElement, inView: () => boolean }>} */
  const collapsibles = [];
  function boundsInView(/** @type {any} */ bounds) {
    const view = map.getBounds();
    return [-360, 0, 360].some((dx) =>
      view.intersects(
        L.latLngBounds([bounds.getSouth(), bounds.getWest() + dx], [bounds.getNorth(), bounds.getEast() + dx]),
      ),
    );
  }
  function setExpanded(
    /** @type {{ title: string, body: HTMLElement, chev: HTMLElement }} */ c,
    /** @type {boolean} */ expanded,
  ) {
    c.body.hidden = !expanded;
    c.chev.setAttribute("aria-expanded", String(expanded));
    c.chev.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${c.title}`);
  }
  function groupHeading(/** @type {string} */ title, /** @type {() => boolean} */ inView) {
    const heading = document.createElement("h2");
    heading.className = "group";
    heading.innerHTML = `<label><input type="checkbox" class="tick"> ${escapeHtml(title)}</label>
      <button class="chev" aria-expanded="true" aria-label="Collapse ${escapeHtml(title)}">▾</button>`;
    const body = document.createElement("div");
    body.className = "group-body";
    const c = { title, body, chev: /** @type {HTMLElement} */ (heading.querySelector(".chev")), inView };
    c.chev.addEventListener("click", () => setExpanded(c, c.body.hidden));
    collapsibles.push(c);
    return { heading, box: /** @type {HTMLInputElement} */ (heading.querySelector("input")), body };
  }
  function autoCollapse() {
    for (const c of collapsibles) setExpanded(c, c.inView());
  }

  const list = /** @type {HTMLElement} */ (document.getElementById("list"));
  /** @type {HTMLElement | null} */
  let active = null;
  function select(/** @type {HTMLElement} */ row) {
    if (active) active.classList.remove("active");
    active = row;
    row.classList.add("active");
  }
  for (const group of GROUPS) {
    const members = models.filter((m) => m.group === group);
    if (!members.length) continue;
    // Expanded only while one of its shown models lies in the view.
    const { heading, box, body } = groupHeading(group, () => {
      const withRings = members.filter((m) => m.ring);
      if (!withRings.length) return Boolean(groupOn[group]) && map.getZoom() <= 2;
      return withRings.some((m) => m.checked && boundsInView(m.bounds));
    });
    box.addEventListener("change", () => {
      const withLayers = members.filter((m) => m.ring);
      const [all] = tickState(withLayers);
      const fullyOn = groupOn[group] && (withLayers.length ? all : true);
      groupOn[group] = !fullyOn;
      for (const m of withLayers) m.checked = !fullyOn;
      refresh();
    });
    list.append(heading, body);
    headings.push({ group, box, members });
    for (const m of members) {
      const row = document.createElement("div");
      row.className = "model";
      row.dataset.model = m.id;
      m.row = row;
      row.innerHTML = m.ring
        ? `<input type="checkbox" class="tick" aria-label="Show ${escapeHtml(m.name)}">
           <span class="swatch" style="background:${m.color}"></span>
           <span class="label">${title(m)}<small>${escapeHtml(m.id)} · ${escapeHtml(m.source)}</small></span>`
        : `<span class="swatch" style="border:1px dashed var(--muted);border-radius:50%"></span>
           <span class="label">${title(m)}<small>${escapeHtml(m.id)}</small></span>`;
      if (!m.ring) {
        row.addEventListener("click", () => {
          select(row);
          map.setView([30, 0], 1);
        });
      } else {
        const box = /** @type {HTMLInputElement} */ (row.querySelector("input"));
        m.box = box;
        box.addEventListener("click", (e) => e.stopPropagation());
        box.addEventListener("change", () => {
          m.checked = box.checked;
          // Showing a model of a hidden category enables that category.
          if (m.checked) groupOn[m.group] = true;
          refresh();
        });
        row.addEventListener("click", () => {
          select(row);
          if (!m.checked) {
            m.checked = true;
            groupOn[m.group] = true;
            refresh();
          }
          // Zoom to the world copy nearest to the current view.
          const dx = Math.round((map.getCenter().lng - m.bounds.getCenter().lng) / 360) * 360;
          map.fitBounds(L.latLngBounds(shift(m.latlngs, dx)), { padding: [40, 40] });
        });
      }
      body.append(row);
    }
  }
  map.on("moveend", () => {
    // Keep the centre in the main world: the identical view, but MapLibre
    // stops drawing several worlds away from it.
    const c = map.getCenter();
    if (Math.abs(c.lng) > 180) {
      map.setView([c.lat, wrapLon(c.lng)], map.getZoom(), { animate: false });
      return;
    }
    autoCollapse();
    const next = worldCopies();
    if (next.join() === copies.join()) return;
    copies = next;
    for (const shape of shapes.values()) drawShape(shape);
    drawZones();
  });
  copies = worldCopies();
  refresh();

  // ---- Chains tab: areas with the same resolved auto chain (chain_zones.json and chain_zones.geojson, computed by
  // graupel-gen with the resolver the apps use).
  function initChains() {
    document.querySelectorAll("#tabs button").forEach((b) =>
      b.addEventListener("click", () => {
        const tab = /** @type {HTMLElement} */ (b).dataset.tab ?? "domains";
        if (tab === activeTab) return;
        syncHiddenCategories(activeTab, tab);
        activeTab = tab;
        document
          .querySelectorAll("#tabs button")
          .forEach((x) => x.setAttribute("aria-selected", String(x === b)));
        /** @type {HTMLElement} */ (document.getElementById("tab-domains")).hidden = activeTab !== "domains";
        /** @type {HTMLElement} */ (document.getElementById("tab-chains")).hidden = activeTab !== "chains";
        map.closeTooltip(tooltip);
        for (const shape of shapes.values()) drawShape(shape);
        drawZones();
      }),
    );
    zonesInit();
    autoCollapse();
  }

  // A category hidden completely in one tab is hidden in the other tab
  // too when switching; one that is shown again is shown again there.
  /** @type {Record<string, { hidden: (g: string) => boolean, set: (g: string, on: boolean) => void, refresh: () => void }>} */
  const tabCategories = {
    domains: {
      hidden: (g) => {
        const withRings = regional.filter((m) => m.group === g);
        return !groupOn[g] || (withRings.length > 0 && withRings.every((m) => !m.checked));
      },
      set: (g, on) => {
        groupOn[g] = on;
        for (const m of regional) if (m.group === g) m.checked = on;
      },
      refresh: () => refresh(),
    },
    chains: {
      hidden: (g) => {
        const members = zones.filter((z) => z.group === g);
        return !zoneGroupOn[g] || (members.length > 0 && members.every((z) => !z.checked));
      },
      set: (g, on) => {
        zoneGroupOn[g] = on;
        for (const z of zones) if (z.group === g) z.checked = on;
      },
      refresh: () => refreshZones(),
    },
  };
  function syncHiddenCategories(/** @type {string} */ from, /** @type {string} */ to) {
    const src = /** @type {any} */ (tabCategories[from]);
    const dst = /** @type {any} */ (tabCategories[to]);
    for (const g of GROUPS) {
      const hidden = src.hidden(g);
      if (hidden !== dst.hidden(g)) dst.set(g, !hidden);
    }
    dst.refresh();
  }

  const byId = Object.fromEntries(models.map((m) => [m.id, m]));
  /** @type {Record<string, boolean>} */
  const zoneGroupOn = Object.fromEntries(GROUPS.map((g) => [g, !OFF_BY_DEFAULT.includes(g)]));
  /** @type {any[]} zones with view state */
  const zones = zoneData.map((z, i) => ({
    ...z,
    color: `hsl(${(i * 137.508 + 40) % 360} 70% 45%)`,
  }));
  const shortName = (/** @type {string} */ id) => (byId[id] ? byId[id].short_name || byId[id].name : id);
  const chainText = (/** @type {string[]} */ ids, withHours = false) =>
    ids.map((id) => (withHours && byId[id] ? `${shortName(id)} ${byId[id].hours}h` : shortName(id))).join(" → ");

  let refreshZones = () => {};
  function zonesInit() {
    const list = /** @type {HTMLElement} */ (document.getElementById("zone-list"));
    /** @type {Array<{ group: string, box: HTMLInputElement, members: any[] }>} */
    const headings = [];
    const toLatLng = (/** @type {import("./lib.js").Part[]} */ parts) =>
      parts.map(({ rings }) => rings.map((ring) => ring.map(([x, y]) => [y, x])));
    const partBounds = (/** @type {import("./lib.js").Part[]} */ parts) =>
      parts.map(({ box: [w, s, e, n] }) => L.latLngBounds([s, w], [n, e]));
    for (const z of zones) {
      z.latlngs = toLatLng(z.land);
      z.coastLatlngs = toLatLng(z.coast);
      z.seaLatlngs = toLatLng(z.sea);
      // Per-part bounds: a zone spread over the world (global fallback)
      // counts as in view only where one of its parts is.
      z.landPartBounds = partBounds(z.land);
      z.coastPartBounds = partBounds(z.coast);
      z.seaPartBounds = partBounds(z.sea);
      const own = z.landPartBounds.length ? z.landPartBounds : [...z.coastPartBounds, ...z.seaPartBounds];
      z.bounds = own.reduce((/** @type {any} */ all, /** @type {any} */ b) => all.extend(b), L.latLngBounds(own[0]));
      z.checked = zoneGroupOn[z.group];
      z.layers = [];
    }
    refreshZones = () => {
      for (const z of zones) {
        z.box.checked = z.checked;
        z.row.classList.toggle("off", !z.checked);
      }
      for (const { group, box, members } of headings) {
        const [all, some] = tickState(members);
        setTick(box, Boolean(zoneGroupOn[group] && all), Boolean(zoneGroupOn[group] && some));
      }
      drawZones();
      autoCollapse();
    };
    for (const group of GROUPS) {
      const members = zones.filter((z) => z.group === group);
      if (!members.length) continue;
      const { heading, box, body } = groupHeading(group, () =>
        members.some(
          (z) =>
            z.checked &&
            [...z.landPartBounds, ...(showCoast ? z.coastPartBounds : []), ...(showSea ? z.seaPartBounds : [])].some(
              boundsInView,
            ),
        ),
      );
      box.addEventListener("change", () => {
        const [all] = tickState(members);
        const fullyOn = zoneGroupOn[group] && all;
        zoneGroupOn[group] = !fullyOn;
        for (const z of members) z.checked = !fullyOn;
        refreshZones();
      });
      list.append(heading, body);
      headings.push({ group, box, members });
      for (const z of members) {
        const row = document.createElement("div");
        row.className = "model";
        row.dataset.zone = z.id;
        z.row = row;
        row.innerHTML = `<input type="checkbox" class="tick" aria-label="Show ${escapeHtml(chainText(z.main_chain_ids))}">
          <span class="swatch" style="background:${z.color}"></span>
          <span class="label">${escapeHtml(chainText(z.main_chain_ids))}
          <small class="chain">cloud: ${escapeHtml(chainText(z.cloud_chain_ids))}</small>
          <small>${escapeHtml(zoneOrigin(z))}</small></span>`;
        z.box = row.querySelector("input");
        z.box.addEventListener("click", (/** @type {Event} */ e) => e.stopPropagation());
        z.box.addEventListener("change", () => {
          z.checked = z.box.checked;
          if (z.checked) zoneGroupOn[z.group] = true;
          refreshZones();
        });
        row.addEventListener("click", () => {
          select(row);
          if (!z.checked) {
            z.checked = true;
            zoneGroupOn[z.group] = true;
            refreshZones();
          }
          const dx = Math.round((map.getCenter().lng - z.bounds.getCenter().lng) / 360) * 360;
          const b = z.bounds;
          map.fitBounds(
            [
              [b.getSouth(), b.getWest() + dx],
              [b.getNorth(), b.getEast() + dx],
            ],
            { padding: [40, 40] },
          );
        });
        body.append(row);
      }
    }
    refreshZones();
  }

  const ZONE_FILL = [0.2, 0.4];
  let showSea = false;
  let showCoast = false;
  for (const [id, set] of /** @type {Array<[string, (v: boolean) => void]>} */ ([
    ["show-sea", (v) => (showSea = v)],
    ["show-coast", (v) => (showCoast = v)],
  ])) {
    /** @type {HTMLElement} */ (document.getElementById(id)).addEventListener("change", (e) => {
      set(/** @type {HTMLInputElement} */ (e.target).checked);
      drawZones();
      autoCollapse();
    });
  }
  function drawZones() {
    for (const z of zones) {
      for (const l of z.layers ?? []) l.remove();
      z.layers = [];
    }
    if (activeTab !== "chains") return;
    for (const z of zones) {
      if (!z.checked) continue;
      const polys = [...z.latlngs, ...(showCoast ? z.coastLatlngs : []), ...(showSea ? z.seaLatlngs : [])];
      if (!polys.length) continue;
      for (const dx of copies) {
        const latlngs = polys.map((/** @type {number[][][]} */ rings) => rings.map((ring) => shift(ring, dx)));
        z.layers.push(
          L.polygon(latlngs, {
            color: z.color,
            weight: 1,
            fillColor: z.color,
            fillOpacity: ZONE_FILL[0],
            interactive: false,
          }).addTo(map),
        );
      }
    }
  }
  function highlightRegion(/** @type {any} */ zone) {
    for (const z of zones)
      for (const l of z.layers ?? []) {
        l.setStyle({ fillOpacity: ZONE_FILL[z === zone ? 1 : 0] });
      }
  }
  function hoverChains(/** @type {any} */ e, /** @type {number} */ lon) {
    // Also hidden areas (grey title): the chain applies whatever is drawn.
    // Land and sea: over the sea the chain shows even with sea regions off.
    const lat = e.latlng.lat;
    const zone = zoneAt(zones, lon, lat);
    if (!zone) {
      map.closeTooltip(tooltip);
      highlightRegion(null);
      return;
    }
    const z = /** @type {any} */ (zone);
    const region = regionAt(regions, lon, lat);
    const sea = !inParts(z.land, lon, lat);
    const lines = [
      `<b style="color:${z.checked ? z.color : "#94a3b8"}">${escapeHtml(zoneOrigin(z))}${z.checked ? "" : " (hidden on the map)"}</b>`,
      `<b>Main: ${escapeHtml(chainText(z.main_chain_ids, true))}</b>`,
      `<b>Cloud: ${escapeHtml(chainText(z.cloud_chain_ids, true))}</b>`,
      `<span class="muted">${region ? `Region here: ${escapeHtml(region.name)}` : "No region here"}${sea ? " (sea)" : ""}</span>`,
    ];
    tooltip.setLatLng(e.latlng).setContent(lines.join(""));
    if (!map.hasLayer(tooltip)) tooltip.addTo(map);
    highlightRegion(zone);
  }

  initChains();
}
