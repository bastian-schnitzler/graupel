// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { Meteogram, type MeteogramComponentOptions } from "@graupel/meteogram-react";
import { toMeteogramInput } from "@graupel/download";
import { buildLocationLabel, formatGeneratedAt, type MeteogramController, type MeteogramInput } from "@graupel/meteogram";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { siteDomain, useConfig } from "../../config/index.ts";
import { useI18n, useMeteogramI18n } from "../../i18n/index.ts";
import { RefreshIcon } from "../../icons/index.ts";
import { useForecast } from "../../state/forecast.ts";
import { FORECAST_FAILURE_DETAIL, forecastFailure } from "../../state/forecastFailure.ts";
import { useFavorites } from "../../state/favorites.ts";
import { useLocation } from "../../state/location.tsx";
import { samePlace } from "../../state/place.ts";
import { placeLabel } from "../../state/placeLabel.ts";
import { useForecastDays, type ForecastDay } from "../../state/days.ts";
import { setLegend, useDaySlider, useLegend, useModelHeaders } from "../../state/displaySettings.ts";
import {
  BOUNDARY_STYLES,
  CARD_BACKGROUNDS,
  TEXT_DARK,
  TEXT_LIGHT,
  defaultModelHeaderColor,
  useModelHeaderColors,
} from "../../state/chainColors.ts";
import { usePageTheme } from "../../state/pageTheme.ts";
import { isTypingInField, usePhone, usePhoneLandscape } from "../../state/phoneLandscape.ts";
import { useTablet, useTabletLandscape } from "../../state/deviceClass.ts";
import { isMapDialogOpen } from "../../state/mapDialog.ts";
import { useNarrowPage } from "../../state/narrowPage.ts";
import { useErrorNotice } from "../../state/notices.ts";
import { useFooterSlot } from "../../state/footerSlot.tsx";
import { useSliderCaptionSlot } from "../../state/sliderCaption.tsx";
import { MeteogramFullscreen } from "./MeteogramFullscreen.tsx";
import { MeteogramImageActions } from "./MeteogramImageActions.tsx";
import { ModelHeaderInfo } from "./ModelHeaderInfo.tsx";
import { legendCardFits, MeteogramLegend, useDrawnLegend, useSideLegendWidth } from "./MeteogramLegend.tsx";
import { useChartMinFontSize } from "../../state/chartFontSize.ts";
import {
  chartHeights,
  chartTopRoom,
  compactAxisLabels,
  desktopSideRoom,
  NARROW_CHART_OPTIONS,
  narrowAxisLabels,
  portraitAreaScale,
  portraitChartHeight,
  portraitChart,
  rightLabelsTop,
  scaleLayoutAreas,
  tabletDaysOnScreen,
  toolsOverRightLabels,
  WEB_LAYOUT,
  WEB_LAYOUT_WITHOUT_HEADERS,
} from "./layout.ts";
import { useMeteogramToggles } from "./useMeteogramToggles.ts";
import { usePortraitSpace } from "./usePortraitSpace.ts";
import { useVisibleWidth } from "./useVisibleWidth.ts";
import { useCardTools } from "./useCardTools.ts";
import { usePullToRefresh } from "./usePullToRefresh.ts";
import { isDoubleTap, type Tap } from "./phoneFullscreen.ts";
import "./MeteogramPanel.css";

/** How long a reload runs before "Updating forecast…" appears (REQ-497). */
export const UPDATING_DELAY_MS = 400;

/** True once `active` has lasted `delayMs`: a quick rebuild (e.g. a moved boundary) shows no message (REQ-497). */
function useDelayed(active: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setElapsed(true), delayMs);
    return () => {
      clearTimeout(timer);
      setElapsed(false);
    };
  }, [active, delayMs]);
  return active && elapsed;
}

/** How the full-screen view was opened: only a view opened by turning the phone closes when it is turned back. */
type FullscreenOpener = "user" | "rotation";

/** Expand arrows of the full-screen button (decorative; the button carries the name). */
function FullscreenIcon() {
  return (
    <svg
      className="icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  );
}

/**
 * Full-screen state (REQ-454): opened by the user (double-click, button) or by turning a phone to landscape; turning it
 * back to portrait closes only a view the rotation opened. A view closed in landscape stays closed until the next turn.
 * On a phone only the turn opens it (REQ-532): `open` does nothing there (`phone`). A tablet is no phone here: it opens
 * the view on a double tap and on the footer's button, and a turn does not open it (REQ-728). A turn while a text field has the focus does
 * not open it either (REQ-628), nor a turn while a full-screen map is open (REQ-645): the map stays and fills the
 * landscape screen.
 */
function useFullscreen(available: boolean, phone: boolean) {
  const landscape = usePhoneLandscape();
  const [opener, setOpener] = useState<FullscreenOpener | null>(null);
  const [dismissedInLandscape, setDismissedInLandscape] = useState(false);
  // Follows rotation and data while rendering (no effect): the last values seen, compared with the current ones.
  const [seen, setSeen] = useState({ landscape: false, available: false });
  if (seen.landscape !== landscape || seen.available !== available) {
    setSeen({ landscape, available });
    if (!landscape) {
      setDismissedInLandscape(false);
      if (opener === "rotation") setOpener(null);
    } else if (available && !dismissedInLandscape && opener === null) {
      // Not while typing (REQ-628): the view would take the focus from the field and close the keyboard. Not over an
      // open full-screen map either (REQ-645): the map turns with the phone. Either way the view stays closed until the
      // next turn, as if closed in landscape, also once the map is closed.
      if (isTypingInField() || isMapDialogOpen()) setDismissedInLandscape(true);
      else setOpener("rotation");
    }
  }

  const open = useCallback(() => {
    if (!phone) setOpener((current) => current ?? "user");
  }, [phone]);
  const close = useCallback(() => {
    setDismissedInLandscape(landscape);
    setOpener(null);
  }, [landscape]);
  return { isOpen: opener !== null && available, open, close };
}

/**
 * A double tap on the tablet's embedded chart opens the full-screen view (REQ-728): the returned handler gets every
 * click and opens the view on the second of two taps close together (as the phone's view resets its zoom, REQ-715). A
 * mouse and a click without a pointer (keyboard) do not count; a mouse's double click opens it as on the desktop.
 */
function useDoubleTapOpen(open: () => void, enabled: boolean) {
  const last = useRef<Tap | null>(null);
  return useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const pointerType = (event.nativeEvent as Partial<PointerEvent>).pointerType;
      if (!enabled || pointerType === "mouse" || event.detail === 0) return;
      const tap = { x: event.clientX, y: event.clientY, time: event.timeStamp };
      if (!isDoubleTap(last.current, tap)) {
        last.current = tap;
        return;
      }
      last.current = null;
      open();
    },
    [open, enabled],
  );
}

/** Today's day as the chart keys it ("2026-10-30" in the forecast's time zone), or null without today. */
function useTodayKey(days: readonly ForecastDay[], timeZone: string): string | null {
  return useMemo(() => {
    const today = days.find((day) => day.isToday);
    if (!today) return null;
    const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone })
      .formatToParts(today.start);
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  }, [days, timeZone]);
}

/**
 * Time of the forecast's data as the chart's own label row writes it after the place, e.g. "31.10.26, 20:32": in the
 * chart's time zone (the input's, else the place's, else UTC) and language. Null without a time.
 */
function dataTime(input: MeteogramInput, locale: string): string | null {
  let timeZone = input.timezone;
  if (!timeZone || timeZone === "auto") timeZone = input.location?.timezone;
  if (!timeZone || timeZone === "auto") timeZone = "UTC";
  return formatGeneratedAt(input.generatedAt, timeZone, locale);
}

/**
 * Meteogram (REQ-436): the forecast of the selected place; the time axis follows the day slider, which has a card of
 * its own above this one (REQ-499).
 */
export function MeteogramPanel() {
  const { t, locale } = useI18n();
  const config = useConfig();
  // Own choice in the settings, else config.json (REQ-472).
  const modelHeaders = useModelHeaders();
  // The layout's switches as chosen in the settings (REQ-661), here and in the full-screen view: dew point and spread
  // (REQ-593), the relative humidity (REQ-650) and whether the precipitation and wind axes follow the visible range
  // (REQ-656).
  const toggles = useMeteogramToggles();
  const i18n = useMeteogramI18n();
  const theme = usePageTheme();
  const {
    status,
    result,
    error,
    reload,
    refreshing = false,
    placeChanging = false,
    previewingCloud = false,
  } = useForecast();
  // Each model header in the model's shade of the weather chain (REQ-443), with the chain cards' text colours. The
  // shades follow the models the chart draws (the shown result's chain), which may differ from the selected chain: the
  // previous place's chart while the new one loads, an archived fetch, a replacement model (REQ-770).
  const headerColors = useModelHeaderColors(result?.chain);
  // The card names why the forecast did not load (REQ-632) in its second line; the general case has the message alone.
  const failure = status === "error" ? forecastFailure(error) : null;
  useErrorNotice("forecast", failure ? "forecast.error" : null, failure ? FORECAST_FAILURE_DETAIL[failure] : null);
  const { visibleRange, days, timeZone } = useForecastDays();
  const todayKey = useTodayKey(days, timeZone);
  // On a phone and a tablet a new place's load shows no message over the chart: the place field's symbol turns instead
  // and the previous place's chart stands until the new one is there (REQ-751). The desktop keeps the message
  // (REQ-497).
  const phone = usePhone();
  const fieldLoading = phone && placeChanging;
  const updating = useDelayed(status === "loading" && result !== undefined && !fieldLoading, UPDATING_DELAY_MS);
  // A reload the user asked for (REQ-637) shows the message of the first load at once, in the day slider's box (REQ-737).
  const reloading = refreshing && result !== undefined;
  const daySliderShown = useDaySlider().enabled;

  // The chart and its image name the place as the search field does: the own name of a renamed favourite at the place
  // (REQ-535, as REQ-489), else its own name, else its coordinates in the active language, which the footer puts before
  // the elevation (REQ-536). The selected place gives the name while the forecast is its own; the forecast (perhaps
  // from the cache, perhaps of the place before) only its point. A map point's elevation arrives after its forecast
  // started (no new load): the footer takes it from the place.
  const { favorites } = useFavorites(config.favorites.presets);
  const { place } = useLocation();
  const own = result !== undefined && samePlace(place, { lat: result.location.latitude, lon: result.location.longitude });
  const label = useMemo(() => {
    if (!result) return null;
    const { name = "", latitude: lat, longitude: lon } = result.location;
    return placeLabel(own ? place : { name, lat, lon }, favorites, locale, t);
  }, [result, own, place, favorites, locale, t]);
  const placeElevation = own ? place.elevation : undefined;
  const input = useMemo(() => {
    if (!result) return null;
    const value = toMeteogramInput(result);
    if (!value.location || label === null) return value;
    const location = { ...value.location, name: label };
    if (typeof location.elevation !== "number" && placeElevation !== undefined) location.elevation = placeElevation;
    return { ...value, location };
  }, [result, label, placeElevation]);
  // On a phone the embedded chart only scrolls; the full-screen view is opened by turning it (REQ-531, REQ-532). A
  // tablet has the phone's design, but a double tap on the chart and a button in the footer open the view (REQ-728).
  const tablet = useTablet();
  const fullscreen = useFullscreen(input !== null, phone && !tablet);
  const openOnDoubleTap = useDoubleTapOpen(fullscreen.open, tablet);
  // On a phone the copy and save buttons stand in the page footer's row (REQ-541): the chart takes the card's width.
  const footerSlot = useFooterSlot();
  const captionSlot = useSliderCaptionSlot();
  const actionsInFooter = phone && footerSlot !== null;
  const meteogram = useRef<MeteogramController | null>(null);
  const attributionUrl = result?.attribution.url;
  const domain = siteDomain(config);
  const options = useMemo<MeteogramComponentOptions>(() => {
    const value: MeteogramComponentOptions = {
      // The card's background (`--color-surface`): the snow bars take it along, so in dark mode they are as dark as
      // the card instead of white (REQ-486).
      theme: {
        base: theme,
        background: CARD_BACKGROUNDS[theme],
        // Model boundaries as thin lines in the chain colours (REQ-523). A header without a colour of its own takes the
        // weather chain's first shade, never the meteogram's orange (REQ-770).
        modelHeader: {
          background: defaultModelHeaderColor(theme),
          text: TEXT_DARK,
          contrastText: TEXT_LIGHT,
          boundary: BOUNDARY_STYLES[theme].main.color,
          boundaryOpacity: BOUNDARY_STYLES[theme].main.opacity,
        },
        cloud: {
          boundary: BOUNDARY_STYLES[theme].cloud.color,
          boundaryOpacity: BOUNDARY_STYLES[theme].cloud.opacity,
        },
      },
      // The cloud-chain boundaries only while that chain is moved (REQ-523); the weather chain's follow the headers.
      showCloudBoundaries: previewingCloud,
      modelHeaderColors: headerColors,
      locale: i18n.locale,
      texts: i18n.texts,
      tooltipTexts: i18n.tooltipTexts,
      // The day slider sets the time axis; no zoom with the mouse wheel or the zoom keys. The desktop's full-screen view
      // zooms on its own, within the range it opened with (REQ-636).
      interaction: { zoom: false },
      attribution: {
        text: t("meteogram.attribution.prefix"),
        linkText: "Open-Meteo.com",
        ...(attributionUrl ? { href: attributionUrl } : {}),
      },
      // The domain in short form in the middle of the footer row (REQ-464).
      centerLabel: domain || null,
      // Values of the layout's switches as chosen in the settings (REQ-661), not render options of their own: the dew
      // point auto, on or off (REQ-593), the library draws the line, the spread and the axis; the relative humidity on
      // or off (REQ-650), the line and its axis right of the plot; "adjust axes when zooming" on or off (REQ-656), with
      // fewer days in the slider or a pinch zoom the precipitation and wind axes from the values in the visible range.
      toggles,
    };
    // Without the convection area (REQ-447).
    if (modelHeaders) {
      value.forceModelHeaders = true;
      value.layout = WEB_LAYOUT;
    } else value.layout = WEB_LAYOUT_WITHOUT_HEADERS;
    return value;
  }, [
    theme,
    headerColors,
    i18n,
    t,
    attributionUrl,
    modelHeaders,
    domain,
    previewingCloud,
    toggles,
  ]);
  // On a phone in portrait the chart shows 4.5 days on the screen's width (REQ-554), wider for a longer time range. Its
  // scale is fixed, that of the full forecast (REQ-585, REQ-741): with fewer days chosen or loaded it is narrower but
  // as high, with text, lines and symbols as large. It starts at the first selected day, with all days at yesterday
  // (REQ-583): scrolled back to the left edge when a chart or a time range is new.
  const phoneLandscape = usePhoneLandscape();
  const portrait = phone && !phoneLandscape;
  const timeline = result?.timeline;
  const shownRange = useMemo(
    () => visibleRange ?? (timeline ? { start: Date.parse(timeline.start), end: Date.parse(timeline.end) } : null),
    [visibleRange, timeline],
  );
  // A tablet's chart has the scale of an iPhone 13's, with more days on its wider screen (REQ-742, REQ-744), upright
  // and in landscape, where slider, legend and chart take the page's whole width as well (REQ-750).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const visibleWidth = useVisibleWidth(scrollRef, tablet && portrait && input !== null);
  const portraitLayout =
    portrait && shownRange ? portraitChart(shownRange, tablet ? tabletDaysOnScreen(visibleWidth) : undefined) : null;
  const viewBoxWidth = portraitLayout?.viewBoxWidth;
  // There it takes the height the rest of the page leaves on the screen, so the page does not scroll: at least 40 % of
  // the screen, at most its own height. Only its areas get lower; width, text, lines and symbols stay (REQ-608,
  // DEC-053). Rounded down, so it never takes more than it has. Where the page fits on the screen, Safari keeps no room
  // below the footer for its bottom bar: without scrolling the bar stays shown and covers nothing (REQ-614).
  const space = usePortraitSpace(scrollRef, portrait && input !== null);
  // On a phone a touch on the embedded chart shows no cursor line and no tooltip, only the full-screen view has them
  // (REQ-531); sideways scrolling of the wide chart stays. On a narrow page its legend stands at the edges with the
  // units below the values (REQ-542).
  const narrow = useNarrowPage();
  const cardRef = useRef<HTMLElement | null>(null);
  // A new place or time span starts a new chart; a rebuilt chain of the same place (a moved or dragged boundary,
  // REQ-504) only updates the chart's input, without a new chart.
  const chartKey = result
    ? `${result.location.latitude},${result.location.longitude}|${result.timeline.start}|${result.timeline.end}`
    : "";
  // The legend (REQ-639), while the setting is on and only in the normal view: what the chart draws, beside the card in
  // the page's free margin on the desktop, on a narrow page a card of its own directly above the meteogram (on a phone
  // in portrait left out where the page would not fit the screen with it). That card stands outside the meteogram card,
  // so a pull to refresh leaves it in place. Where the desktop's margin is too narrow for it, the legend is such a card
  // above the meteogram as well, with more columns (REQ-670); not on a phone in landscape, whose chart takes the screen.
  const legendOn = useLegend();
  const legendActive = legendOn && input !== null && !fullscreen.isOpen;
  const drawnLegend = useDrawnLegend(scrollRef, legendActive, chartKey);
  const sideLegendWidth = useSideLegendWidth(cardRef, legendActive && !narrow);
  const closeLegend = useCallback(() => setLegend(false), []);
  const legendShown = legendActive && drawnLegend.keys.length > 0;
  // On a phone in portrait the card's room as last measured: where the page with it would not fit the screen with the
  // chart at 40 % of it, the card is left out (REQ-608).
  const [legendRoom, setLegendRoom] = useState<number | null>(null);
  if (space && space.optional > 0 && Math.abs(space.optional - (legendRoom ?? -1)) >= 0.5) setLegendRoom(space.optional);
  const legendCard = narrow
    ? legendShown && legendCardFits(space, legendRoom)
    : legendShown && sideLegendWidth === null && !phoneLandscape;
  // The rest of the page with the legend card as it is drawn now: measured with or without it.
  const rest = space ? space.rest - space.optional + (legendCard ? (legendRoom ?? space.optional) : 0) : Number.NaN;
  const backgroundHasData = Boolean(input?.cloudProfile?.profiles?.length);
  const heights = useMemo(
    () =>
      chartHeights(modelHeaders ? WEB_LAYOUT : WEB_LAYOUT_WITHOUT_HEADERS, {
        forceModelHeaders: modelHeaders,
        backgroundHasData,
        toggles,
      }),
    [modelHeaders, backgroundHasData, toggles],
  );
  const available = space ? space.screen - rest : Number.NaN;
  const areaScale = space
    ? Math.max(
        heights.leastScale,
        Math.floor(portraitAreaScale(heights, space.pxPerUnit, available, space.screen) * 1000) / 1000,
      )
    : 1;
  const fits = space !== null && portraitChartHeight(heights, space.pxPerUnit, areaScale) <= available + 1;
  // On the desktop the chart takes the card's whole width, with as much room left as right of the plot, only as much as
  // the labels need; the button column stands in the room on the right, above the right labels (REQ-613). Where the
  // chart scrolls sideways, the column stays beside it. Right labels that reach up to the column (the relative
  // humidity's axis) stand under it, and its buttons are translucent until pointed at or focused (REQ-672).
  const toolsRef = useRef<HTMLDivElement | null>(null);
  const cardTools = useCardTools(cardRef, toolsRef, !phone && !narrow && input !== null);
  const rightTop = useMemo(
    () =>
      rightLabelsTop(modelHeaders ? WEB_LAYOUT : WEB_LAYOUT_WITHOUT_HEADERS, {
        forceModelHeaders: modelHeaders,
        backgroundHasData,
        toggles,
      }),
    [modelHeaders, backgroundHasData, toggles],
  );
  const sideRoom = cardTools ? desktopSideRoom(cardTools) : null;
  const toolsTranslucent = sideRoom !== null && cardTools !== null && toolsOverRightLabels({ ...cardTools, rightTop });
  // On a narrow page the chart moves up by the room above its model headers (MeteogramPanel.css), so its first row,
  // with or without them, follows the day slider's grips as closely as the slider the place row (REQ-615).
  const topRoom = useMemo(
    () =>
      chartTopRoom(
        modelHeaders ? WEB_LAYOUT : WEB_LAYOUT_WITHOUT_HEADERS,
        { forceModelHeaders: modelHeaders, backgroundHasData, toggles },
        viewBoxWidth,
      ),
    [modelHeaders, backgroundHasData, toggles, viewBoxWidth],
  );
  // A small chart on a narrow page, whose areas are too low for the two-line labels (on a phone in portrait with lowered
  // areas), gets compact axis labels: each unit once below its area, maximum and minimum in its corners (REQ-694).
  const embeddedOptions = useMemo<MeteogramComponentOptions>(() => {
    if (sideRoom !== null) return { ...options, padding: { left: sideRoom, right: sideRoom } };
    if (!phone && !narrow) return options;
    const value: MeteogramComponentOptions = { ...options };
    if (phone) value.interaction = { ...options.interaction, hover: false, tooltip: false };
    if (viewBoxWidth !== undefined) value.viewBoxWidth = viewBoxWidth;
    const layout = scaleLayoutAreas(modelHeaders ? WEB_LAYOUT : WEB_LAYOUT_WITHOUT_HEADERS, areaScale);
    if (areaScale !== 1) value.layout = layout;
    if (narrow) {
      const compact = compactAxisLabels(layout, { forceModelHeaders: modelHeaders, backgroundHasData, toggles });
      Object.assign(value, NARROW_CHART_OPTIONS, { axisLabels: narrowAxisLabels(compact) });
    }
    return value;
  }, [options, phone, narrow, viewBoxWidth, areaScale, modelHeaders, sideRoom, backgroundHasData, toggles]);
  // On a phone the full-screen view takes the whole width (REQ-553): the plot reaches from edge to edge, its legend
  // stands over it as on a narrow page, and the tooltip is a narrow side bar with short labels (REQ-557). On the desktop
  // the legend stands beside the plot with the units next to the values, as in the card (REQ-568).
  const fullscreenOptions = useMemo<MeteogramComponentOptions>(
    () => (phone ? { ...options, ...NARROW_CHART_OPTIONS, tooltipTexts: i18n.shortTooltipTexts } : options),
    [options, phone, i18n],
  );
  // The phone's footer links take the chart's smallest font size (REQ-552).
  const rangeKey = shownRange ? `${shownRange.start}|${shownRange.end}` : "";
  const scrollToStart = portraitLayout !== null;
  // On a phone in portrait only the data source and the data's time below the chart (REQ-616).
  const sourceTime = useMemo(() => (input ? dataTime(input, i18n.locale) : null), [input, i18n.locale]);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && scrollToStart) element.scrollLeft = 0;
    // Keyed by chart and range only: a reload with the same range keeps where the user scrolled to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartKey, rangeKey, portrait, input !== null]);
  useChartMinFontSize(scrollRef, `${chartKey}|${input !== null}|${portraitLayout?.widthFactor ?? 1}`);
  // On a phone in portrait pulling the chart down at the top of the page loads the forecast anew (REQ-638), as the
  // desktop's refresh button does; so does pulling the page there from the header, the place row or the day slider, on
  // a phone and a tablet (REQ-750). The chart goes back to its place at once; the day slider's box says that it loads
  // (REQ-737).
  const pullEnabled = portrait && input !== null;
  const [pullReload, setPullReload] = useState(false);
  if (pullReload && !refreshing) setPullReload(false);
  const pullLoading = pullReload && refreshing;
  const pullRefresh = useCallback(() => {
    setPullReload(true);
    reload();
  }, [reload]);
  usePullToRefresh(cardRef, scrollRef, pullEnabled, pullRefresh, pullLoading);

  // On a phone and a tablet in portrait the data source with the data's time and the copy and share buttons share the
  // footer's row (REQ-729): on a tablet the line left and the buttons right, on a phone the buttons left and the line
  // right-aligned.
  const sourceInFooter = actionsInFooter && portraitLayout !== null;
  const sourceLine = (
    <p className="meteogram__source" data-testid="meteogram-source">
      {t("meteogram.attribution.prefix")}
      {attributionUrl ? (
        <a href={attributionUrl} target="_blank" rel="noopener noreferrer">
          Open-Meteo.com
        </a>
      ) : (
        "Open-Meteo.com"
      )}
      {sourceTime ? ` (${sourceTime})` : null}
    </p>
  );

  // On a tablet in landscape the card is as wide as the page: its groups in four columns, so it is lower and leaves the
  // chart more room (REQ-756, REQ-763).
  const tabletLandscape = useTabletLandscape();
  const legend = (variant: "side" | "card", width?: number) => (
    <MeteogramLegend
      drawn={drawnLegend}
      theme={options.theme}
      variant={variant}
      wide={!narrow}
      width={width}
      columns={tabletLandscape}
      chain={input?.chain}
      onClose={closeLegend}
    />
  );

  return (
    <>
      {legendCard && legend("card")}
      {/*
       * No visible heading (REQ-507): the card is named by its label; the tool buttons stand in a narrow column to the
       * right of the chart, on the desktop in the room right of the plot (REQ-613).
       */}
      <section
        ref={cardRef}
        className={
          // Without a forecast only "Try again", without a card of its own, right below the box above (REQ-739, REQ-740).
          status === "error"
            ? "region meteogram-card meteogram-card--bare"
            : sideRoom !== null
            ? `region meteogram-card meteogram-card--tools-over${toolsTranslucent ? " meteogram-card--tools-translucent" : ""}`
            : pullEnabled
              ? "region meteogram-card meteogram-card--pull"
              : "region meteogram-card"
        }
        aria-label={t("region.meteogram.title")}
        data-testid="meteogram-card"
      >
        {legendShown && !narrow && sideLegendWidth !== null && legend("side", sideLegendWidth)}
        {/*
         * Pull to refresh (REQ-638): no arrow over the chart; the day slider's box above shows the refresh symbol while
         * pulling and "Loading forecast…" while the forecast loads anew (REQ-737).
         */}
        <div className="meteogram" data-region="meteogram" aria-busy={status === "loading"}>
          {/*
           * "Loading forecast…" stands once, in the day slider's box above (REQ-737); here only while the slider is
           * switched off: without a forecast yet in place of the chart.
           */}
          {status === "loading" && !result && !daySliderShown && (
            <p className="meteogram__status" role="status" data-testid="forecast-loading">
              {t("forecast.loading")}
            </p>
          )}
          {/*
           * A reload that takes a while: the message lies over the chart instead of pushing it down (REQ-497). A reload
           * the user asked for says so in the day slider's box (REQ-737), here only while the slider is switched off.
           */}
          {(reloading ? !daySliderShown : updating) && (
            <p className="meteogram__status meteogram__status--overlay" role="status" data-testid="forecast-loading">
              {t(reloading ? "forecast.loading" : "forecast.updating")}
            </p>
          )}
          {/* The message is a card (REQ-492); in place only the retry button. */}
          {status === "error" && (
            <div className="meteogram__error" data-testid="forecast-error">
              <button type="button" className="meteogram__retry" onClick={reload}>
                {t("forecast.retry")}
              </button>
            </div>
          )}
          {result && input && (
            <>
              {/*
               * Today's label in the day header in the colour of today in the day slider, on phones (REQ-559) and on the
               * desktop (REQ-642), in the card and on the whole screen. The page's style only: the copied or saved image
               * draws its own markup and keeps the usual colour.
               */}
              {todayKey && (
                <style data-testid="meteogram-today-style">
                  {`text.day-label-text[data-day="${todayKey}"] { fill: var(--color-today); }`}
                </style>
              )}
              {/* On narrow screens the chart keeps a readable width and scrolls sideways inside the region. */}
              {/*
               * A double-click opens the chart on the whole screen (REQ-454); not on a phone (REQ-532), but on a tablet,
               * also a double tap (REQ-728).
               */}
              <div
                ref={scrollRef}
                className={
                  portraitLayout
                    ? `meteogram__scroll meteogram__scroll--portrait${fits ? " meteogram__scroll--fits" : ""}`
                    : "meteogram__scroll"
                }
                style={
                  {
                    "--meteogram-top-room": topRoom,
                    ...(portraitLayout ? { "--meteogram-width-factor": portraitLayout.widthFactor } : {}),
                  } as CSSProperties
                }
                data-testid="meteogram-scroll"
                onDoubleClick={phone && !tablet ? undefined : fullscreen.open}
                onClick={tablet ? openOnDoubleTap : undefined}
              >
                <Meteogram
                  // A new place or time span starts a new chart, so the visible range is applied from scratch.
                  key={chartKey}
                  ref={meteogram}
                  className="meteogram__chart"
                  input={input}
                  options={embeddedOptions}
                  visibleRange={visibleRange}
                />
                {/* While the weather chain is hidden: info buttons in the model headers (REQ-643). */}
                <ModelHeaderInfo containerRef={scrollRef} chain={input.chain} />
              </div>
              {/*
               * On a phone in portrait the line below the chart names only the data source, with the data's time: place
               * and elevation stand between the slider's grips (REQ-562). It stands outside the sideways scrolling, so it
               * stays where it is; the chart's own row (place, domain, source at its end) is hidden there and only drawn
               * into the copied or saved image (REQ-616). With the footer's slot it stands in the footer's row beside
               * copy and share (REQ-729), else here below the chart.
               */}
              {portraitLayout && !sourceInFooter && sourceLine}
              {fullscreen.isOpen && (
                <MeteogramFullscreen
                  input={input}
                  options={fullscreenOptions}
                  visibleRange={visibleRange}
                  chartKey={chartKey}
                  onClose={fullscreen.close}
                  closeOnDoubleClick={!phone}
                  controls={!phone}
                  closable={tablet}
                />
              )}
            </>
          )}
        </div>
        {/* On a phone in portrait place and elevation, centred between the day slider's grips (REQ-562). */}
        {portrait && input?.location && captionSlot
          ? createPortal(<span data-testid="meteogram-place">{buildLocationLabel(input.location)}</span>, captionSlot)
          : null}
        {result && input && actionsInFooter && footerSlot
          ? createPortal(
              <>
                {sourceInFooter && tablet ? sourceLine : null}
                <MeteogramImageActions meteogram={meteogram} input={input} placement="footer">
                  {/* A tablet's full-screen button beside copy and share (REQ-728); a phone opens the view by turning. */}
                  {tablet && (
                    <button
                      type="button"
                      className="icon-button meteogram-actions__button"
                      aria-label={t("meteogram.fullscreen.open")}
                      title={t("meteogram.fullscreen.open")}
                      onClick={fullscreen.open}
                      data-testid="meteogram-fullscreen-open"
                    >
                      <FullscreenIcon />
                    </button>
                  )}
                </MeteogramImageActions>
                {sourceInFooter && !tablet ? sourceLine : null}
              </>,
              footerSlot,
            )
          : null}
        {result && input && !actionsInFooter && (
          <div ref={toolsRef} className="meteogram-card__tools" data-testid="meteogram-tools">
            <MeteogramImageActions meteogram={meteogram} input={input} placement="card" />
            {/*
             * Between "save as" and full screen: loads the place's forecast completely anew (REQ-637). Not on a phone,
             * where pulling the chart down does that (REQ-638).
             */}
            {!phone && (
              <button
                type="button"
                className="icon-button meteogram-card__refresh"
                aria-label={t("meteogram.refresh")}
                title={t("meteogram.refresh")}
                onClick={reload}
                data-testid="meteogram-refresh"
              >
                <RefreshIcon />
              </button>
            )}
            {/* No full-screen button on a phone: turning it opens the view (REQ-532). */}
            {!phone && (
              <button
                type="button"
                className="icon-button meteogram-card__fullscreen"
                aria-label={t("meteogram.fullscreen.open")}
                title={t("meteogram.fullscreen.open")}
                onClick={fullscreen.open}
                data-testid="meteogram-fullscreen-open"
              >
                <FullscreenIcon />
              </button>
            )}
          </div>
        )}
      </section>
    </>
  );
}
