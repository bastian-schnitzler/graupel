import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import type {
  MeteogramConfig,
  Location,
  HarmonizedForecastResponse,
  WeatherModel,
} from "./types";
import { ConfigView } from "./views/ConfigView";
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
import {
  DEFAULT_LOCATION,
  resolveAppBoot,
  mergeSavedConfigLocation,
  filterMeteogramConfigs,
  resolveHeaderLocationChange,
} from "./App.logic";
import { DEFAULT_MAIN_CHAIN } from "./views/meteogramViewUtils";
import "./App.css";

export function App() {
  const [activeTab, setActiveTab] = useState<"meteogram" | "config">(
    "meteogram",
  );
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

  const [forecastResponse, setForecastResponse] =
    useState<HarmonizedForecastResponse | null>(null);
  const [forecastLoading, setForecastLoading] = useState<boolean>(false);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [meteogramDisplayChains, setMeteogramDisplayChains] = useState<
    Record<string, WeatherModel[]>
  >({});
  const [meteogramCloudDisplayChains, setMeteogramCloudDisplayChains] =
    useState<Record<string, WeatherModel[]>>({});
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

  const fetchForecast = useCallback(
    async (loc: Location, configId?: string) => {
      const requestId = ++forecastRequestIdRef.current;
      const targetConfig = configId
        ? configsRef.current.find((c: MeteogramConfig) => c.id === configId)
        : selectedConfigRef.current;
      if (
        targetConfig &&
        (!targetConfig.model_chain || targetConfig.model_chain.length === 0)
      ) {
        if (requestId === forecastRequestIdRef.current) {
          setForecastResponse(null);
          setForecastError(null);
          setForecastLoading(false);
        }
        return;
      }

      setForecastLoading(true);
      setForecastError(null);
      try {
        const response = await apiService.getForecast(loc, configId);
        if (requestId !== forecastRequestIdRef.current) {
          return;
        }
        setForecastResponse(response);
        setForecastError(null);
        const cfg = configId
          ? configsRef.current.find(
              (c: MeteogramConfig) => c.id === configId,
            ) || selectedConfigRef.current
          : selectedConfigRef.current;
        lastLoadedForecastKeyRef.current = getForecastSnapshotKey(loc, cfg);
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

  const bootApp = useCallback(async () => {
    const bootId = ++bootRequestIdRef.current;
    setInitialLoading(true);
    try {
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
      if (boot.shouldFetch && boot.targetLoc) {
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
  }, [fetchForecast]);

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

      // 3. Determine if forecast needs to be refetched for selectedConfig.
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
  }, [activeTab, effectiveMeteogramLocation, selectedConfig, fetchForecast]);

  const handleSelectConfig = (config: MeteogramConfig) => {
    selectedConfigRef.current = config;
    setSelectedConfig(config);
    if (activeTab === "meteogram") {
      const targetLoc = sessionLocationOverride || config.location;
      void fetchForecast(targetLoc, config.id);
    }
  };

  const handleSaveConfigBack = async (updatedConfig: MeteogramConfig) => {
    try {
      const saved = await apiService.saveConfiguration(updatedConfig);
      const mergedSaved = mergeSavedConfigLocation(saved, updatedConfig);
      selectedConfigRef.current = mergedSaved;
      setSelectedConfig(mergedSaved);
      const updatedList = await apiService.getConfigurations();
      configsRef.current = updatedList;
      setConfigs(updatedList);
    } catch (e: unknown) {
      console.error("Failed to auto-save configuration from MeteogramView:", e);
    }
  };

  const meteogramConfigs = useMemo(
    () => filterMeteogramConfigs(configs),
    [configs],
  );

  // Fallback selection if selectedConfig becomes empty while in Meteogram View or switching to it
  useEffect(() => {
    if (
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
    activeTab,
    selectedConfig?.id,
    selectedConfig?.model_chain?.length,
    meteogramConfigs,
    fetchForecast,
    sessionLocationOverride,
  ]);

  const handleHeaderLocationChange = (newLoc: Location) => {
    const outcome = resolveHeaderLocationChange(
      activeTab,
      selectedConfig,
      newLoc,
    );
    if (outcome.updatedConfigToSave) {
      const updated = outcome.updatedConfigToSave;
      setSelectedConfig(updated);
      setConfigs((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c)),
      );
      void handleSaveConfigBack(updated);
    } else if (outcome.sessionLocationOverride) {
      setSessionLocationOverride(outcome.sessionLocationOverride);
      if (outcome.fetchForecastArgs) {
        void fetchForecast(
          outcome.fetchForecastArgs.loc,
          outcome.fetchForecastArgs.configId,
        );
      }
    }
  };

  const handleRefreshClick = () => {
    if (
      !selectedConfig ||
      !selectedConfig.model_chain ||
      selectedConfig.model_chain.length === 0
    ) {
      return;
    }
    void fetchForecast(effectiveMeteogramLocation, selectedConfig?.id);
  };

  const handleResetModelChainBoundaries = useCallback(() => {
    const cfgId = selectedConfig?.id;
    if (!cfgId || !selectedConfig) return;
    const defaultMain = (
      selectedConfig.main_model_chain ||
      selectedConfig.model_chain ||
      DEFAULT_MAIN_CHAIN
    ).map((m) => ({ ...m }));
    const defaultCloud = (selectedConfig.cloud_model_chain || []).map((m) => ({
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
  }, [selectedConfig]);

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
          activeTab={activeTab}
          onTabChange={setActiveTab}
          selectedConfig={selectedConfig}
          meteogramConfigs={meteogramConfigs}
          onSelectConfig={handleSelectConfig}
          configSaveStatus={configSaveStatus}
          configSaveError={configSaveError}
          location={
            activeTab === "config" && selectedConfig
              ? selectedConfig.location
              : effectiveMeteogramLocation
          }
          onLocationChange={handleHeaderLocationChange}
          onRefreshForecast={handleRefreshClick}
          forecastLoading={forecastLoading}
          onResetModelChainBoundaries={handleResetModelChainBoundaries}
          isFullscreenMapOpen={isFullscreenMapOpen}
          onFullscreenMapChange={setIsFullscreenMapOpen}
        />

        <main className="app-main">
          <ErrorBoundary
            fallbackTitle="Error in Meteogram Application"
            onReset={handleRefreshClick}
          >
            {activeTab === "meteogram" ? (
              <MeteogramView
                key={
                  selectedConfig
                    ? `${selectedConfig.id}-${effectiveMeteogramLocation.latitude}-${effectiveMeteogramLocation.longitude}`
                    : "default"
                }
                currentConfig={selectedConfig}
                selectedLocation={effectiveMeteogramLocation}
                forecastResponse={forecastResponse}
                loading={forecastLoading}
                error={forecastError}
                onRefresh={handleRefreshClick}
                isFullscreenMapOpen={isFullscreenMapOpen}
                displayModelChain={
                  selectedConfig?.id
                    ? meteogramDisplayChains[selectedConfig.id]
                    : undefined
                }
                onModelChainDisplayChange={(chain) => {
                  const cfgId = selectedConfig?.id;
                  if (cfgId) {
                    setMeteogramDisplayChains((prev) => ({
                      ...prev,
                      [cfgId]: chain,
                    }));
                  }
                }}
                displayCloudModelChain={
                  selectedConfig?.id
                    ? meteogramCloudDisplayChains[selectedConfig.id]
                    : undefined
                }
                onCloudModelChainDisplayChange={(chain) => {
                  const cfgId = selectedConfig?.id;
                  if (cfgId) {
                    setMeteogramCloudDisplayChains((prev) => ({
                      ...prev,
                      [cfgId]: chain,
                    }));
                  }
                }}
              />
            ) : (
              <ConfigView
                selectedConfigId={selectedConfig?.id || null}
                onSelectConfig={handleSelectConfig}
                onConfigsUpdated={refreshConfigs}
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
