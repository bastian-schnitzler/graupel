import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import type {
  AppMode,
  ArchivedFetchSummary,
  AutoChainInfo,
  HistoricForecast,
  MeteogramConfig,
  Location,
  HarmonizedForecastResponse,
  StoredLayout,
  WeatherModel,
} from "./types";
import type { DayRangeChoice, TimeRange } from "./utils/meteogramZoom";
import { ConfigView, type ConfigTab } from "./views/ConfigView";
import { MeteogramView } from "./views/MeteogramView";
import { AppHeader } from "./components/header/AppHeader";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { apiService } from "./services/apiService";
import {
  getForecastSnapshotKey,
  createConfigSnapshots,
  getChangedConfigIds,
  pruneEphemeralChains,
  pruneModifiedChainsAgainstSnapshot,
  shouldRefetchForecastOnTabSwitch,
} from "./utils/appConfigSync";
import { getForecastCacheKey, type ForecastCache } from "./utils/forecastCache";
import {
  AUTO_CONFIG_ID,
  autoChainSignature,
  buildAutoConfig,
  formatAutoChainLabel,
  formatAutoEntryLabel,
  withResponseChains,
} from "./utils/autoChain";
import {
  DEFAULT_LOCATION,
  resolveAppBoot,
  filterMeteogramConfigs,
  resolveHeaderLocationChange,
} from "./App.logic";
import { DEFAULT_MAIN_CHAIN } from "./views/meteogramViewUtils";
import { getLocationDisplayName } from "./utils/configLocation";
import { chooseChartLayout } from "./layouts/layoutLibrary.logic";
import { resolveChartLayout } from "./layouts/layoutResolution";
import { getLayoutQuantities } from "./layouts/layoutQuantities";
import { getQuantity } from "./quantities/registry";
import {
  buildHistoricConfig,
  findMissingQuantities,
  formatConfigVersion,
  formatHistoricBadge,
} from "./utils/historicForecast";
import type { ChartLayout } from "./layouts/types";
import "./App.css";

export function App() {
  const [activeTab, setActiveTab] = useState<"meteogram" | "config">(
    "meteogram",
  );
  // Normal mode hides configuration and model chains (system.md §3.2).
  const [mode, setMode] = useState<AppMode>("power");
  const modeRef = useRef<AppMode>("power");
  const [configTab, setConfigTab] = useState<ConfigTab>("chains");
  // Meteogram configurations (layout library, system.md §4.3).
  const [layouts, setLayouts] = useState<StoredLayout[]>([]);
  const [configs, setConfigs] = useState<MeteogramConfig[]>([]);
  const [configSaveStatus, setConfigSaveStatus] = useState<
    "saved" | "saving" | "error" | null
  >(null);
  const [configSaveError, setConfigSaveError] = useState<string | null>(null);
  const [selectedConfig, setSelectedConfig] = useState<MeteogramConfig | null>(
    null,
  );
  const [sessionLocationOverride, setSessionLocationOverride] =
    useState<Location | null>(null);
  const [initialLoading, setInitialLoading] = useState<boolean>(true);

  const effectiveMeteogramLocation =
    sessionLocationOverride || selectedConfig?.location || DEFAULT_LOCATION;
  // Meteogram view location when the Config view opened ("Start from auto
  // configuration", system.md §6.5); config selection there does not move it.
  const [configEntryLocation, setConfigEntryLocation] =
    useState<Location | null>(null);
  // Normal mode draws the auto chain of the current location (system.md §3.3).
  const [autoConfig, setAutoConfig] = useState<MeteogramConfig | null>(null);
  const [autoChainInfo, setAutoChainInfo] = useState<AutoChainInfo | null>(
    null,
  );
  const autoResolveIdRef = useRef<number>(0);
  // Power mode: the Auto dropdown entry is selected (system.md §16.4). Kept while
  // in normal mode, so returning to power mode shows Auto again.
  const [powerAutoSelected, setPowerAutoSelected] = useState<boolean>(false);
  const powerAutoSelectedRef = useRef<boolean>(false);
  const autoConfigRef = useRef<MeteogramConfig | null>(null);
  // Normal mode and the Auto entry draw the auto chain of the location.
  const showsAutoNow = () =>
    modeRef.current === "normal" || powerAutoSelectedRef.current;

  const [forecastResponse, setForecastResponse] =
    useState<HarmonizedForecastResponse | null>(null);
  const [forecastLoading, setForecastLoading] = useState<boolean>(false);
  const [forecastError, setForecastError] = useState<string | null>(null);
  // Snapshot key (location + configuration) the forecast state belongs to.
  // A response is only shown while it matches the current selection.
  const [forecastKey, setForecastKey] = useState<string>("");
  // Meteogram UI state lives here so it survives MeteogramView remounts.
  const [isMainChainCollapsed, setIsMainChainCollapsed] =
    useState<boolean>(false);
  const [isCloudChainCollapsed, setIsCloudChainCollapsed] =
    useState<boolean>(false);
  // Read only when the chart mounts, so a ref avoids an App re-render per zoom.
  const meteogramVisibleRangeRef = useRef<TimeRange | null>(null);
  const handleVisibleRangeChange = useCallback((range: TimeRange | null) => {
    meteogramVisibleRangeRef.current = range;
  }, []);
  // Day-range button (#162): applied to every new forecast until changed.
  const [dayRangeChoice, setDayRangeChoice] = useState<
    DayRangeChoice | undefined
  >(undefined);
  const getPersistedVisibleRange = useCallback(
    () => meteogramVisibleRangeRef.current,
    [],
  );
  const [meteogramDisplayChains, setMeteogramDisplayChains] = useState<
    Record<string, WeatherModel[]>
  >({});
  const [meteogramCloudDisplayChains, setMeteogramCloudDisplayChains] =
    useState<Record<string, WeatherModel[]>>({});
  // Archived fetch drawn instead of the live forecast (system.md §10, #144).
  const [historic, setHistoric] = useState<HistoricForecast | null>(null);
  const historicRequestIdRef = useRef(0);
  const [isFullscreenMapOpen, setIsFullscreenMapOpen] =
    useState<boolean>(false);

  useEffect(() => {
    if (activeTab === "config") {
      setIsFullscreenMapOpen(false);
    }
  }, [activeTab]);

  const lastLoadedForecastKeyRef = useRef<string>("");
  const prevTabRef = useRef<"meteogram" | "config">(activeTab);
  const configSnapshotWhenLeavingMeteogramRef = useRef<Record<string, string>>(
    {},
  );
  const leavingMeteogramConfigIdRef = useRef<string | null>(null);
  const selectedConfigRef = useRef<MeteogramConfig | null>(null);
  selectedConfigRef.current = selectedConfig;
  const configsRef = useRef<MeteogramConfig[]>([]);
  configsRef.current = configs;

  const forecastRequestIdRef = useRef<number>(0);
  const bootRequestIdRef = useRef<number>(0);
  // Every forecast fetched since program start (system.md §16.13).
  const forecastCacheRef = useRef<ForecastCache>(new Map());

  const fetchForecast = useCallback(
    async (
      loc: Location,
      configId?: string,
      forceRefresh = false,
      autoTarget?: MeteogramConfig,
    ) => {
      const requestId = ++forecastRequestIdRef.current;
      const targetConfig = autoTarget
        ? autoTarget
        : configId
          ? selectedConfigRef.current?.id === configId
            ? selectedConfigRef.current
            : configsRef.current.find(
                (c: MeteogramConfig) => c.id === configId,
              ) || selectedConfigRef.current
          : selectedConfigRef.current;
      // A load shows the forecast of this location and chain content from
      // the session cache; otherwise the meteogram is emptied and only
      // filled again with the new live response.
      const snapshotKey = getForecastSnapshotKey(loc, targetConfig ?? null);
      const cacheKey = getForecastCacheKey(loc, targetConfig ?? null);
      setForecastKey(snapshotKey);
      setForecastResponse(null);
      setForecastError(null);
      meteogramVisibleRangeRef.current = null;
      if (
        targetConfig &&
        (!targetConfig.model_chain || targetConfig.model_chain.length === 0)
      ) {
        setForecastLoading(false);
        return;
      }
      const cached = forceRefresh
        ? undefined
        : forecastCacheRef.current.get(cacheKey);
      if (cached) {
        setForecastResponse(cached);
        setForecastLoading(false);
        lastLoadedForecastKeyRef.current = snapshotKey;
        return;
      }

      setForecastLoading(true);
      try {
        const response = autoTarget
          ? await apiService.getAutoForecast(loc, autoTarget)
          : await apiService.getForecast(loc, configId);
        if (requestId !== forecastRequestIdRef.current) {
          return;
        }
        forecastCacheRef.current.set(cacheKey, response);
        setForecastResponse(response);
        setForecastError(null);
        lastLoadedForecastKeyRef.current = snapshotKey;
      } catch (e: unknown) {
        if (requestId !== forecastRequestIdRef.current) {
          return;
        }
        const message = e instanceof Error ? e.message : String(e);
        if (message !== "STALE_REQUEST") {
          setForecastError(
            `Forecast could not be loaded for ${loc.name}. ${message || "Network/API failure"}`,
          );
        }
      } finally {
        if (requestId === forecastRequestIdRef.current) {
          setForecastLoading(false);
        }
      }
    },
    [],
  );

  // Resolves the auto chain for `loc`, then loads its forecast (session
  // cache first). A newer resolution or a switch to power mode wins.
  const loadAutoForecast = useCallback(
    async (loc: Location, forceRefresh = false) => {
      const resolveId = ++autoResolveIdRef.current;
      // Responses of earlier requests no longer belong to the selection.
      forecastRequestIdRef.current++;
      setForecastLoading(true);
      let info: AutoChainInfo;
      try {
        info = await apiService.resolveAutoChain(loc);
      } catch (e: unknown) {
        if (resolveId !== autoResolveIdRef.current) return;
        const message = e instanceof Error ? e.message : String(e);
        setForecastResponse(null);
        setForecastError(
          `Forecast could not be loaded for ${loc.name}. ${message}`,
        );
        setForecastLoading(false);
        return;
      }
      if (resolveId !== autoResolveIdRef.current || !showsAutoNow()) {
        return;
      }
      const config = buildAutoConfig(loc, info);
      // Dragged boundaries belong to the previous auto chain.
      if (
        autoChainSignature(config) !== autoChainSignature(autoConfigRef.current)
      ) {
        setMeteogramDisplayChains((prev) =>
          pruneEphemeralChains(prev, new Set([AUTO_CONFIG_ID])),
        );
        setMeteogramCloudDisplayChains((prev) =>
          pruneEphemeralChains(prev, new Set([AUTO_CONFIG_ID])),
        );
      }
      autoConfigRef.current = config;
      setAutoChainInfo(info);
      setAutoConfig(config);
      await fetchForecast(loc, undefined, forceRefresh, config);
    },
    [fetchForecast],
  );

  // Loads the meteogram the current mode shows for `loc`.
  const loadForMode = useCallback(
    (loc: Location, forceRefresh = false) => {
      if (showsAutoNow()) {
        void loadAutoForecast(loc, forceRefresh);
        return;
      }
      autoResolveIdRef.current++;
      const cfg = selectedConfigRef.current;
      if (cfg?.model_chain && cfg.model_chain.length > 0) {
        void fetchForecast(loc, cfg.id, forceRefresh);
      }
    },
    [fetchForecast, loadAutoForecast],
  );

  const bootApp = useCallback(async () => {
    const bootId = ++bootRequestIdRef.current;
    setInitialLoading(true);
    try {
      await apiService.loadQuantityRegistry();
      try {
        const settings = await apiService.getSettings();
        if (bootId !== bootRequestIdRef.current) {
          return;
        }
        modeRef.current = settings.mode;
        setMode(settings.mode);
      } catch (e) {
        console.error("Failed to load settings:", e);
      }
      try {
        const library = await apiService.getLayouts();
        if (bootId !== bootRequestIdRef.current) {
          return;
        }
        setLayouts(library);
      } catch (e) {
        // The built-in layouts are drawn instead.
        console.error("Failed to load meteogram configurations:", e);
      }
      const list = await apiService.getConfigurations();
      if (bootId !== bootRequestIdRef.current) {
        return;
      }
      configsRef.current = list;
      setConfigs(list);
      const boot = resolveAppBoot(list);
      selectedConfigRef.current = boot.selectedConfig;
      setSelectedConfig(boot.selectedConfig);
      lastLoadedForecastKeyRef.current = boot.snapshotKey;
      if (showsAutoNow()) {
        void loadAutoForecast(
          boot.targetLoc || boot.selectedConfig?.location || DEFAULT_LOCATION,
        );
      } else if (boot.shouldFetch && boot.targetLoc) {
        void fetchForecast(boot.targetLoc, boot.fetchConfigId);
      } else {
        setForecastResponse(null);
        setForecastError(null);
        setForecastLoading(false);
      }
    } catch (e) {
      if (bootId !== bootRequestIdRef.current) {
        return;
      }
      console.error("Failed to boot application:", e);
      setForecastResponse(null);
      setForecastError(null);
      setForecastLoading(false);
      lastLoadedForecastKeyRef.current = "";
    } finally {
      if (bootId === bootRequestIdRef.current) {
        setInitialLoading(false);
      }
    }
  }, [fetchForecast, loadAutoForecast]);

  const refreshLayoutLibrary = useCallback(async () => {
    try {
      setLayouts(await apiService.getLayouts());
    } catch (e) {
      console.error("Failed to reload meteogram configurations:", e);
    }
  }, []);

  const refreshConfigs = useCallback(async () => {
    try {
      const list = await apiService.getConfigurations();
      configsRef.current = list;
      setConfigs(list);
      setSelectedConfig((prev) => {
        const next = prev
          ? list.find((c) => c.id === prev.id) || list[0] || null
          : list[0] || null;
        selectedConfigRef.current = next;
        return next;
      });

      // Clear ephemeral display chains for any configs whose stored state changed compared to the snapshot
      setMeteogramDisplayChains((prevDisplayChains) =>
        pruneModifiedChainsAgainstSnapshot(
          prevDisplayChains,
          list,
          configSnapshotWhenLeavingMeteogramRef.current,
        ),
      );
      setMeteogramCloudDisplayChains((prevDisplayChains) =>
        pruneModifiedChainsAgainstSnapshot(
          prevDisplayChains,
          list,
          configSnapshotWhenLeavingMeteogramRef.current,
        ),
      );
    } catch (e) {
      console.error("Failed to refresh configurations:", e);
    }
  }, []);

  useEffect(() => {
    const handlePywebviewReady = () => {
      void bootApp();
    };
    window.addEventListener("pywebviewready", handlePywebviewReady);
    let initialLoad: number | undefined;
    if (window.pywebview?.api) {
      void bootApp();
    } else {
      initialLoad = window.setTimeout(handlePywebviewReady, 0);
    }

    return () => {
      if (initialLoad !== undefined) {
        window.clearTimeout(initialLoad);
      }
      window.removeEventListener("pywebviewready", handlePywebviewReady);
    };
  }, [bootApp]);

  // ESC key handler for Configuration View -> return to Meteogram View
  useEffect(() => {
    if (activeTab !== "config") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (e.defaultPrevented) return;
        setActiveTab("meteogram");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTab]);

  // Tab switch effect: Handle snapshotting and restoration between Meteogram View and Configuration View
  useEffect(() => {
    if (prevTabRef.current === "meteogram" && activeTab === "config") {
      // User switched from Meteogram View to Configuration View.
      // Snapshot the configuration states and the currently selected config ID.
      leavingMeteogramConfigIdRef.current = selectedConfig?.id || null;
      configSnapshotWhenLeavingMeteogramRef.current = createConfigSnapshots(
        configsRef.current,
      );
    } else if (prevTabRef.current === "config" && activeTab === "meteogram") {
      // User switched back from Configuration View to Meteogram View.
      // 1. Identify which configurations were modified or deleted in Configuration View.
      const changedConfigIds = getChangedConfigIds(
        configSnapshotWhenLeavingMeteogramRef.current,
        configsRef.current,
      );

      // 2. Clear ephemeral display chains for any configurations that were modified.
      if (changedConfigIds.size > 0) {
        setMeteogramDisplayChains((prev) =>
          pruneEphemeralChains(prev, changedConfigIds),
        );
        setMeteogramCloudDisplayChains((prev) =>
          pruneEphemeralChains(prev, changedConfigIds),
        );
      }

      // 3. The Auto entry reloads only when its chain or location changed.
      if (powerAutoSelectedRef.current) {
        const autoKey = getForecastSnapshotKey(
          effectiveMeteogramLocation,
          autoConfigRef.current,
        );
        if (autoKey !== lastLoadedForecastKeyRef.current) {
          void loadAutoForecast(effectiveMeteogramLocation);
        }
        prevTabRef.current = activeTab;
        return;
      }

      // 4. Determine if forecast needs to be refetched for selectedConfig.
      const currentKey = getForecastSnapshotKey(
        effectiveMeteogramLocation,
        selectedConfig,
      );
      const shouldRefetch = shouldRefetchForecastOnTabSwitch({
        currentConfigId: selectedConfig?.id,
        leavingConfigId: leavingMeteogramConfigIdRef.current,
        changedConfigIds,
        currentKey,
        lastLoadedKey: lastLoadedForecastKeyRef.current,
      });

      if (shouldRefetch) {
        void fetchForecast(effectiveMeteogramLocation, selectedConfig?.id);
      }
    }
    prevTabRef.current = activeTab;
  }, [
    activeTab,
    effectiveMeteogramLocation,
    selectedConfig,
    fetchForecast,
    loadAutoForecast,
  ]);

  // Power mode with a stored configuration shown: the Auto entry still names
  // the auto chain of the current location (system.md §16.4). Only resolves, no
  // forecast; loadAutoForecast resolves itself while Auto is shown.
  const autoEntryResolveIdRef = useRef<number>(0);
  useEffect(() => {
    if (initialLoading || mode !== "power" || powerAutoSelected) return;
    const resolveId = ++autoEntryResolveIdRef.current;
    apiService
      .resolveAutoChain(effectiveMeteogramLocation)
      .then((info) => {
        if (
          resolveId === autoEntryResolveIdRef.current &&
          modeRef.current === "power" &&
          !powerAutoSelectedRef.current
        ) {
          setAutoChainInfo(info);
        }
      })
      .catch((e: unknown) => {
        console.error("Failed to resolve the auto chain:", e);
      });
  }, [initialLoading, mode, powerAutoSelected, effectiveMeteogramLocation]);

  // Switching mode never deletes data. Normal mode draws the auto chain,
  // power mode the selected configuration; both come from the session cache
  // when already fetched. Leaving power mode leaves the Config view.
  const handleModeChange = useCallback(
    async (nextMode: AppMode) => {
      const previous = modeRef.current;
      if (nextMode === previous) return;
      modeRef.current = nextMode;
      setMode(nextMode);
      historicRequestIdRef.current++;
      setHistoric(null);
      if (nextMode === "normal") {
        setActiveTab("meteogram");
      } else {
        // Power mode continues with the chain normal mode showed (§16.4).
        powerAutoSelectedRef.current = true;
        setPowerAutoSelected(true);
      }
      loadForMode(effectiveMeteogramLocation);
      try {
        const settings = await apiService.updateSettings({ mode: nextMode });
        if (modeRef.current === nextMode && settings.mode !== nextMode) {
          modeRef.current = settings.mode;
          setMode(settings.mode);
          loadForMode(effectiveMeteogramLocation);
        }
      } catch (e) {
        console.error("Failed to store mode:", e);
        if (modeRef.current === nextMode) {
          modeRef.current = previous;
          setMode(previous);
          loadForMode(effectiveMeteogramLocation);
        }
      }
    },
    [loadForMode, effectiveMeteogramLocation],
  );

  const handleBackToLive = () => {
    historicRequestIdRef.current++;
    setHistoric(null);
  };

  const handleSelectHistoric = async (fetch: ArchivedFetchSummary) => {
    const requestId = ++historicRequestIdRef.current;
    try {
      const loaded = await apiService.getHistoricForecast(fetch.id);
      if (historicRequestIdRef.current === requestId && loaded) {
        setHistoric(loaded);
      }
    } catch (e) {
      console.error("Failed to load archived forecast:", e);
    }
  };

  const handleSelectAuto = () => {
    powerAutoSelectedRef.current = true;
    setPowerAutoSelected(true);
    if (activeTab === "meteogram") {
      void loadAutoForecast(effectiveMeteogramLocation);
    }
  };

  const handleSelectConfig = (config: MeteogramConfig) => {
    powerAutoSelectedRef.current = false;
    setPowerAutoSelected(false);
    autoResolveIdRef.current++;
    selectedConfigRef.current = config;
    setSelectedConfig(config);
    if (activeTab === "meteogram") {
      const targetLoc = sessionLocationOverride || config.location;
      void fetchForecast(targetLoc, config.id);
    }
  };

  const isNormalMode = mode === "normal";
  const showsAuto = isNormalMode || powerAutoSelected;
  // Header location (#175): the configuration's own location (with its
  // display name) on the Model chains tab and in Meteogram view while no
  // manual location is set; otherwise the Meteogram view location.
  const headerShowsConfigLocation =
    activeTab === "config"
      ? configTab === "chains"
      : !showsAuto && !sessionLocationOverride;
  const currentForecastKey = useMemo(
    () =>
      getForecastSnapshotKey(
        effectiveMeteogramLocation,
        showsAuto ? autoConfig : selectedConfig,
      ),
    [effectiveMeteogramLocation, showsAuto, autoConfig, selectedConfig],
  );
  const forecastMatchesSelection = forecastKey === currentForecastKey;
  const shownForecast = forecastMatchesSelection ? forecastResponse : null;
  // Normal mode stitches the chains the response used (empty models dropped).
  const meteogramConfig = useMemo(
    () =>
      showsAuto
        ? autoConfig
          ? withResponseChains(autoConfig, shownForecast)
          : null
        : selectedConfig,
    [showsAuto, autoConfig, shownForecast, selectedConfig],
  );
  const autoChainLabel = isNormalMode
    ? formatAutoChainLabel(shownForecast?.auto_chain || autoChainInfo)
    : null;
  // The Auto entry draws the Default layout like normal mode (#203).
  const layoutChoice = useMemo(
    () =>
      chooseChartLayout(
        layouts,
        mode,
        powerAutoSelected ? null : selectedConfig,
      ),
    [layouts, mode, powerAutoSelected, selectedConfig],
  );
  const autoEntryLabel = formatAutoEntryLabel(autoChainInfo, configs);
  const autoEntryTitle = autoChainInfo
    ? `Auto chain for this location: ${formatAutoChainLabel(autoChainInfo)}`
    : "Auto chain for this location";
  const handleLayoutsUpdated = useCallback(() => {
    void refreshLayoutLibrary();
    void refreshConfigs();
  }, [refreshLayoutLibrary, refreshConfigs]);

  // Layout editor preview (#142): the edited layout over the forecast of the
  // Meteogram view, without model chain cards.
  const renderLayoutPreview = useCallback(
    (layout: ChartLayout, fallbackLayoutId: string) =>
      shownForecast && meteogramConfig ? (
        <MeteogramView
          key={currentForecastKey}
          currentConfig={meteogramConfig}
          selectedLocation={effectiveMeteogramLocation}
          forecastResponse={shownForecast}
          showModelChains={false}
          chartLayout={layout}
          fallbackLayoutId={fallbackLayoutId}
          isMainChainCollapsed
          isCloudChainCollapsed
        />
      ) : (
        <p className="layout-note">
          {forecastLoading
            ? "Loading the forecast for the preview..."
            : "Load a forecast in the Meteogram view to see a preview here."}
        </p>
      ),
    [
      shownForecast,
      meteogramConfig,
      currentForecastKey,
      effectiveMeteogramLocation,
      forecastLoading,
    ],
  );

  // A new data folder brings its own settings, layouts and configurations
  // (#140): boot again from it. Without copied settings it starts in normal
  // mode, which has no Config view.
  const handleDataDirChanged = useCallback(async () => {
    await bootApp();
    if (modeRef.current === "normal") {
      setActiveTab("meteogram");
    }
  }, [bootApp]);

  const meteogramConfigs = useMemo(
    () => filterMeteogramConfigs(configs),
    [configs],
  );

  // Fallback selection if selectedConfig becomes empty while in Meteogram View or switching to it
  useEffect(() => {
    if (
      mode === "power" &&
      !powerAutoSelected &&
      activeTab === "meteogram" &&
      selectedConfig &&
      (!selectedConfig.model_chain || selectedConfig.model_chain.length === 0)
    ) {
      if (meteogramConfigs.length > 0) {
        const fallback = meteogramConfigs[0];
        setSelectedConfig(fallback);
        const targetLoc = sessionLocationOverride || fallback.location;
        void fetchForecast(targetLoc, fallback.id);
      } else {
        // All configurations are empty; no meteogram should be loaded
        setForecastResponse(null);
        setForecastError(null);
        setForecastLoading(false);
        lastLoadedForecastKeyRef.current = "";
      }
    }
  }, [
    mode,
    powerAutoSelected,
    activeTab,
    selectedConfig?.id,
    selectedConfig?.model_chain?.length,
    meteogramConfigs,
    fetchForecast,
    sessionLocationOverride,
  ]);

  const handleHeaderLocationChange = (newLoc: Location) => {
    handleBackToLive();
    if (showsAuto && activeTab === "meteogram") {
      setSessionLocationOverride(newLoc);
      void loadAutoForecast(newLoc);
      return;
    }
    const outcome = resolveHeaderLocationChange(
      activeTab,
      selectedConfig,
      newLoc,
    );
    if (outcome.sessionLocationOverride) {
      setSessionLocationOverride(outcome.sessionLocationOverride);
      if (outcome.fetchForecastArgs) {
        void fetchForecast(
          outcome.fetchForecastArgs.loc,
          outcome.fetchForecastArgs.configId,
        );
      }
    }
  };

  const handleTabChange = (tab: "meteogram" | "config") => {
    if (tab === "config" && activeTab !== "config") {
      setConfigEntryLocation(effectiveMeteogramLocation);
    }
    setActiveTab(tab);
  };

  const handleRefreshClick = () => {
    // A historic fetch is stored data: nothing to refresh (system.md §10).
    if (historic) return;
    if (showsAuto) {
      void loadAutoForecast(effectiveMeteogramLocation, true);
      return;
    }
    if (
      !selectedConfig ||
      !selectedConfig.model_chain ||
      selectedConfig.model_chain.length === 0
    ) {
      return;
    }
    void fetchForecast(effectiveMeteogramLocation, selectedConfig?.id, true);
  };

  const handleResetModelChainBoundaries = useCallback(() => {
    // The Auto entry resets to the chains of its response.
    const source = powerAutoSelected ? meteogramConfig : selectedConfig;
    const cfgId = source?.id;
    if (!cfgId || !source) return;
    const defaultMain = (
      source.main_model_chain ||
      source.model_chain ||
      DEFAULT_MAIN_CHAIN
    ).map((m) => ({ ...m }));
    const defaultCloud = (source.cloud_model_chain || []).map((m) => ({
      ...m,
    }));
    setMeteogramDisplayChains((prev) => ({
      ...prev,
      [cfgId]: defaultMain,
    }));
    setMeteogramCloudDisplayChains((prev) => ({
      ...prev,
      [cfgId]: defaultCloud,
    }));
  }, [powerAutoSelected, meteogramConfig, selectedConfig]);

  const historicConfig = useMemo(
    () => (historic ? buildHistoricConfig(historic.fetch) : null),
    [historic],
  );
  // Drawn with the current layout; what the archive lacks is listed.
  const historicInfo = useMemo(() => {
    if (!historic) return null;
    const layout = resolveChartLayout(
      layoutChoice.chartLayout,
      layoutChoice.fallbackLayoutId,
    ).layout;
    return {
      badge: formatHistoricBadge(historic.fetch.fetched_at),
      version: formatConfigVersion(historic.fetch.config_version),
      missing: findMissingQuantities(
        getLayoutQuantities(layout),
        historic.forecast,
        (historic.fetch.chain.cloud ?? []).length > 0,
      ).map((id) => getQuantity(id)?.label ?? id),
    };
  }, [historic, layoutChoice]);

  // Dragged boundaries per shown chain; normal mode has no chain cards.
  // A historic fetch keeps its own (temporary) boundaries.
  const displayChainId = isNormalMode
    ? undefined
    : historicConfig
      ? historicConfig.id
      : powerAutoSelected
        ? AUTO_CONFIG_ID
        : selectedConfig?.id;

  if (initialLoading) {
    return (
      <div className="app-container initial-loader">
        <div className="spinner" />
        <h2>Loading Meteogram App...</h2>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <div className="main-workspace">
        <AppHeader
          mode={mode}
          onModeChange={handleModeChange}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          selectedConfig={selectedConfig}
          meteogramConfigs={meteogramConfigs}
          onSelectConfig={(config) => {
            handleBackToLive();
            handleSelectConfig(config);
          }}
          configSaveStatus={configSaveStatus}
          configSaveError={configSaveError}
          location={
            headerShowsConfigLocation && selectedConfig
              ? selectedConfig.location
              : effectiveMeteogramLocation
          }
          locationDisplayName={
            headerShowsConfigLocation && selectedConfig
              ? getLocationDisplayName(selectedConfig)
              : undefined
          }
          onLocationChange={handleHeaderLocationChange}
          onRefreshForecast={handleRefreshClick}
          forecastLoading={forecastLoading}
          onResetModelChainBoundaries={handleResetModelChainBoundaries}
          isFullscreenMapOpen={isFullscreenMapOpen}
          onFullscreenMapChange={setIsFullscreenMapOpen}
          autoChainLabel={autoChainLabel}
          autoEntryLabel={autoEntryLabel}
          autoEntryTitle={autoEntryTitle}
          autoSelected={powerAutoSelected}
          onSelectAuto={() => {
            handleBackToLive();
            handleSelectAuto();
          }}
          onSelectHistoric={handleSelectHistoric}
          historic={historicInfo}
          onBackToLive={handleBackToLive}
        />

        <main className="app-main">
          <ErrorBoundary
            fallbackTitle="Error in Meteogram Application"
            onReset={handleRefreshClick}
          >
            {activeTab === "meteogram" ? (
              <MeteogramView
                key={
                  historicConfig
                    ? historicConfig.id
                    : showsAuto
                    ? `${AUTO_CONFIG_ID}-${effectiveMeteogramLocation.latitude}-${effectiveMeteogramLocation.longitude}`
                    : selectedConfig
                      ? `${selectedConfig.id}-${effectiveMeteogramLocation.latitude}-${effectiveMeteogramLocation.longitude}`
                      : "default"
                }
                currentConfig={historicConfig ?? meteogramConfig}
                selectedLocation={
                  historicConfig?.location ?? effectiveMeteogramLocation
                }
                forecastResponse={historic ? historic.forecast : shownForecast}
                loading={historic ? false : forecastLoading}
                error={
                  historic || !forecastMatchesSelection ? null : forecastError
                }
                isMainChainCollapsed={isMainChainCollapsed}
                onToggleMainChainCollapse={() =>
                  setIsMainChainCollapsed((prev) => !prev)
                }
                isCloudChainCollapsed={isCloudChainCollapsed}
                onToggleCloudChainCollapse={() =>
                  setIsCloudChainCollapsed((prev) => !prev)
                }
                getPersistedVisibleRange={getPersistedVisibleRange}
                onVisibleRangeChange={handleVisibleRangeChange}
                dayRangeChoice={dayRangeChoice}
                onDayRangeChoiceChange={setDayRangeChoice}
                showModelChains={mode === "power"}
                chartLayout={layoutChoice.chartLayout}
                fallbackLayoutId={layoutChoice.fallbackLayoutId}
                forceModelHeaders={mode === "power"}
                onRefresh={handleRefreshClick}
                isFullscreenMapOpen={isFullscreenMapOpen}
                displayModelChain={
                  displayChainId
                    ? meteogramDisplayChains[displayChainId]
                    : undefined
                }
                onModelChainDisplayChange={(chain) => {
                  if (displayChainId) {
                    setMeteogramDisplayChains((prev) => ({
                      ...prev,
                      [displayChainId]: chain,
                    }));
                  }
                }}
                displayCloudModelChain={
                  displayChainId
                    ? meteogramCloudDisplayChains[displayChainId]
                    : undefined
                }
                onCloudModelChainDisplayChange={(chain) => {
                  if (displayChainId) {
                    setMeteogramCloudDisplayChains((prev) => ({
                      ...prev,
                      [displayChainId]: chain,
                    }));
                  }
                }}
              />
            ) : (
              <ConfigView
                activeTab={configTab}
                onTabChange={setConfigTab}
                selectedConfigId={selectedConfig?.id || null}
                onSelectConfig={handleSelectConfig}
                currentLocation={
                  configEntryLocation || effectiveMeteogramLocation
                }
                onConfigsUpdated={refreshConfigs}
                onLayoutsUpdated={handleLayoutsUpdated}
                renderLayoutPreview={renderLayoutPreview}
                onDataDirChanged={handleDataDirChanged}
                onSaveStatusChange={(status, err) => {
                  setConfigSaveStatus(status);
                  setConfigSaveError(err || null);
                }}
              />
            )}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export default App;
