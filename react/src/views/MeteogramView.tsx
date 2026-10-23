import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import type {
  MeteogramConfig,
  Location,
  HarmonizedForecastResponse,
  WeatherModel,
  ModelMetadata,
} from "../types";
import { MeteogramModelChains } from "../components/meteogram/MeteogramModelChains";
import { MeteogramChart } from "../components/MeteogramChart";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { apiService } from "../services/apiService";
import { DEFAULT_CLOUD_MODEL_CHAIN } from "../models/openMeteoModels";
import { AlertTriangle } from "lucide-react";
import {
  calculateActiveTimelineEnd,
  logTimelineDiagnostics,
  resolveActiveCombinedForecast,
  resolveActiveVerticalCloudData,
  resolveTargetModelChain,
  resolveTargetCloudChain,
  calculateMeteogramScale,
  DEFAULT_MAIN_CHAIN,
  applyAvailabilityToMetadata,
  applyMissingSourcesToMetadata,
  capChainToAvailability,
  mergeDraggedChain,
} from "./meteogramViewUtils";
import { buildModelMap } from "./config/configFactories";
import {
  POWER_DEFAULT_LAYOUT_ID,
  resolveChartLayout,
} from "../layouts/layoutResolution";
import { getDrawnQuantities } from "../layouts/layoutQuantities";
import { DEFAULT_LOCATION } from "../App.logic";
import type { DayRangeChoice, TimeRange } from "../utils/meteogramZoom";

interface MeteogramViewProps {
  currentConfig: MeteogramConfig | null;
  /** Meteogram layout (system.md §4); default: the `fallbackLayoutId` layout. */
  chartLayout?: unknown;
  /** Built-in layout drawn without or instead of an invalid `chartLayout`. */
  fallbackLayoutId?: string;
  /** Power mode (#203): model headers and boundaries whatever the layout says. */
  forceModelHeaders?: boolean;
  selectedLocation?: Location;
  forecastResponse?: HarmonizedForecastResponse | null;
  loading?: boolean;
  error?: string | null;
  availableModels?: Record<string, ModelMetadata>;
  onRefresh?: () => void;
  onSaveConfigBack?: (updatedConfig: MeteogramConfig) => void;
  displayModelChain?: WeatherModel[];
  onModelChainDisplayChange?: (newChain: WeatherModel[]) => void;
  displayCloudModelChain?: WeatherModel[];
  onCloudModelChainDisplayChange?: (newChain: WeatherModel[]) => void;
  isFullscreenMapOpen?: boolean;
  isMainChainCollapsed?: boolean;
  onToggleMainChainCollapse?: () => void;
  isCloudChainCollapsed?: boolean;
  onToggleCloudChainCollapse?: () => void;
  getPersistedVisibleRange?: () => TimeRange | null;
  onVisibleRangeChange?: (range: TimeRange | null) => void;
  /** Chosen day-range button (#162), kept by App across forecasts. */
  dayRangeChoice?: DayRangeChoice;
  onDayRangeChoiceChange?: (days: DayRangeChoice) => void;
  /** Model chain cards above the chart; hidden in normal mode. */
  showModelChains?: boolean;
}

export const MeteogramView: React.FC<MeteogramViewProps> = ({
  currentConfig,
  chartLayout,
  fallbackLayoutId,
  forceModelHeaders = false,
  selectedLocation: propLocation,
  forecastResponse: propForecastResponse,
  loading: propLoading,
  error: propError,
  availableModels: propAvailableModels,
  onRefresh: propOnRefresh,
  onSaveConfigBack: _onSaveConfigBack,
  displayModelChain,
  onModelChainDisplayChange,
  displayCloudModelChain,
  onCloudModelChainDisplayChange,
  isFullscreenMapOpen,
  isMainChainCollapsed: propMainCollapsed,
  onToggleMainChainCollapse,
  isCloudChainCollapsed: propCloudCollapsed,
  onToggleCloudChainCollapse,
  getPersistedVisibleRange,
  showModelChains = true,
  onVisibleRangeChange,
  dayRangeChoice,
  onDayRangeChoiceChange,
}) => {
  const selectedLocation =
    propLocation || currentConfig?.location || DEFAULT_LOCATION;

  const [activeModelChain, setActiveModelChain] = useState<WeatherModel[]>(
    () =>
      resolveTargetModelChain(displayModelChain, currentConfig) ||
      DEFAULT_MAIN_CHAIN,
  );

  const [activeCloudModelChain, setActiveCloudModelChain] = useState<
    WeatherModel[]
  >(() =>
    resolveTargetCloudChain(
      displayCloudModelChain,
      currentConfig,
      DEFAULT_CLOUD_MODEL_CHAIN,
    ),
  );

  const [internalForecastResponse, setInternalForecastResponse] =
    useState<HarmonizedForecastResponse | null>(null);
  const [internalLoading, setInternalLoading] = useState<boolean>(false);
  const [internalError, setInternalError] = useState<string | null>(null);
  const [internalAvailableModels, setInternalAvailableModels] = useState<
    Record<string, ModelMetadata>
  >({});

  const [draggedCloudBoundaryHour, setDraggedCloudBoundaryHour] = useState<
    number | null
  >(null);
  const [internalMainCollapsed, setInternalMainCollapsed] =
    useState<boolean>(false);
  const [internalCloudCollapsed, setInternalCloudCollapsed] =
    useState<boolean>(false);
  const isMainChainCollapsed = propMainCollapsed ?? internalMainCollapsed;
  const isCloudChainCollapsed = propCloudCollapsed ?? internalCloudCollapsed;
  const [userTimezone, setUserTimezone] = useState<string | undefined>(
    () => apiService.getCachedUserTimezone() || undefined,
  );

  useEffect(() => {
    let mounted = true;
    void apiService.getUserTimezone().then((tz) => {
      if (mounted && tz) {
        setUserTimezone(tz);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (propAvailableModels) return;
    let mounted = true;
    void apiService
      .getModels()
      .then((models) => {
        if (!mounted) return;
        setInternalAvailableModels(buildModelMap(models));
      })
      .catch((e) => {
        console.warn("Failed to load available models in MeteogramView:", e);
      });
    return () => {
      mounted = false;
    };
  }, [propAvailableModels]);

  const availableModels = propAvailableModels || internalAvailableModels;
  const forecastResponse =
    propForecastResponse !== undefined
      ? propForecastResponse
      : internalForecastResponse;
  const loading = propLoading !== undefined ? propLoading : internalLoading;
  const error = propError !== undefined ? propError : internalError;

  const currentConfigId = currentConfig?.id;

  const fetchForecast = useCallback(
    async (loc: Location) => {
      if (propForecastResponse !== undefined) return;
      setInternalLoading(true);
      setInternalError(null);
      try {
        const response = await apiService.getForecast(loc, currentConfigId);
        setInternalForecastResponse(response);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        if (message !== "STALE_REQUEST") {
          setInternalError(
            message || "Failed to retrieve forecast data from weather server.",
          );
        }
      } finally {
        setInternalLoading(false);
      }
    },
    [currentConfigId, propForecastResponse],
  );

  useEffect(() => {
    if (propForecastResponse === undefined) {
      const initialFetch = window.setTimeout(() => {
        void fetchForecast(selectedLocation);
      }, 0);
      return () => window.clearTimeout(initialFetch);
    }
  }, [fetchForecast, selectedLocation, propForecastResponse]);

  const handleRefreshClick = () => {
    if (propOnRefresh) {
      propOnRefresh();
    } else {
      void fetchForecast(selectedLocation);
    }
  };

  const activeModelChainRef = useRef<WeatherModel[]>(activeModelChain);
  activeModelChainRef.current = activeModelChain;

  useEffect(() => {
    const targetChain = resolveTargetModelChain(
      displayModelChain,
      currentConfig,
    );
    if (targetChain && targetChain !== activeModelChainRef.current) {
      setActiveModelChain(targetChain);
      activeModelChainRef.current = targetChain;
    }
  }, [
    displayModelChain,
    currentConfig?.id,
    currentConfig?.main_model_chain,
    currentConfig?.model_chain,
  ]);

  const activeCloudModelChainRef = useRef<WeatherModel[]>(
    activeCloudModelChain,
  );
  activeCloudModelChainRef.current = activeCloudModelChain;

  useEffect(() => {
    const targetChain = resolveTargetCloudChain(
      displayCloudModelChain,
      currentConfig,
      DEFAULT_CLOUD_MODEL_CHAIN,
    );
    if (targetChain && targetChain !== activeCloudModelChainRef.current) {
      setActiveCloudModelChain(targetChain);
      activeCloudModelChainRef.current = targetChain;
    }
  }, [
    displayCloudModelChain,
    currentConfig?.id,
    currentConfig?.cloud_model_chain,
  ]);

  // Meteogram View shows each model only for the hours its latest run
  // delivers; the requested (config or dragged) chain stays uncapped so a
  // later, longer run extends the boundary again.
  const mainAvailability = forecastResponse?.model_availability;
  const cloudAvailability = forecastResponse?.cloud_model_availability;
  const displayedModelChain = useMemo(
    () => capChainToAvailability(activeModelChain, mainAvailability),
    [activeModelChain, mainAvailability],
  );
  const displayedCloudModelChain = useMemo(
    () => capChainToAvailability(activeCloudModelChain, cloudAvailability),
    [activeCloudModelChain, cloudAvailability],
  );
  const mainRunSegments = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(mainAvailability ?? {}).map(([name, info]) => [
          name,
          info.run_segments,
        ]),
      ),
    [mainAvailability],
  );
  // Derived quantities the layout draws: their sources are checked per model.
  const drawnQuantities = useMemo(
    () =>
      getDrawnQuantities(
        resolveChartLayout(
          chartLayout,
          fallbackLayoutId ?? POWER_DEFAULT_LAYOUT_ID,
        ).layout,
      ),
    [chartLayout, fallbackLayoutId],
  );
  const mainChainModels = useMemo(
    () =>
      applyMissingSourcesToMetadata(
        applyAvailabilityToMetadata(
          availableModels,
          activeModelChain,
          mainAvailability,
          forecastResponse?.forecast_start_time,
        ),
        activeModelChain,
        drawnQuantities,
        forecastResponse?.model_forecasts,
      ),
    [
      availableModels,
      activeModelChain,
      mainAvailability,
      forecastResponse?.forecast_start_time,
      forecastResponse?.model_forecasts,
      drawnQuantities,
    ],
  );
  const cloudChainModels = useMemo(
    () =>
      applyAvailabilityToMetadata(
        availableModels,
        activeCloudModelChain,
        cloudAvailability,
        forecastResponse?.forecast_start_time,
      ),
    [
      availableModels,
      activeCloudModelChain,
      cloudAvailability,
      forecastResponse?.forecast_start_time,
    ],
  );

  const handleModelChainChange = (draggedChain: WeatherModel[]) => {
    const newChain = mergeDraggedChain(
      activeModelChainRef.current,
      capChainToAvailability(activeModelChainRef.current, mainAvailability),
      draggedChain,
    );
    setActiveModelChain(newChain);
    activeModelChainRef.current = newChain;
    onModelChainDisplayChange?.(newChain);
  };

  const handleResizeEnd = () => {
    onModelChainDisplayChange?.(activeModelChainRef.current);
  };

  const handleCloudModelChainChange = (draggedChain: WeatherModel[]) => {
    const newChain = mergeDraggedChain(
      activeCloudModelChainRef.current,
      capChainToAvailability(
        activeCloudModelChainRef.current,
        cloudAvailability,
      ),
      draggedChain,
    );
    setActiveCloudModelChain(newChain);
    activeCloudModelChainRef.current = newChain;
    onCloudModelChainDisplayChange?.(newChain);
  };

  const handleCloudResizeEnd = () => {
    onCloudModelChainDisplayChange?.(activeCloudModelChainRef.current);
  };

  const handleCloudBoundaryDrag = useCallback(
    (isDragging: boolean, _boundaryIndex?: number, boundaryHour?: number) => {
      if (!isDragging) {
        setDraggedCloudBoundaryHour(null);
      } else if (typeof boundaryHour === "number") {
        setDraggedCloudBoundaryHour(boundaryHour);
      }
    },
    [],
  );

  const activeTimelineEnd = useMemo(
    () =>
      calculateActiveTimelineEnd(
        forecastResponse?.forecast_start_time,
        displayedModelChain,
        forecastResponse?.timeline_end,
      ),
    [forecastResponse, displayedModelChain],
  );

  useEffect(() => {
    if (!import.meta.env.DEV || !forecastResponse?.timeline_diagnostics) return;
    logTimelineDiagnostics(forecastResponse.timeline_diagnostics);
  }, [forecastResponse?.timeline_diagnostics]);

  const activeCombinedForecast = useMemo(
    () =>
      resolveActiveCombinedForecast(
        forecastResponse,
        displayedModelChain,
        activeTimelineEnd,
      ),
    [forecastResponse, displayedModelChain, activeTimelineEnd],
  );

  const activeVerticalCloudData = useMemo(
    () =>
      resolveActiveVerticalCloudData(
        forecastResponse,
        displayedCloudModelChain,
        activeCombinedForecast,
        selectedLocation,
      ),
    [
      forecastResponse,
      displayedCloudModelChain,
      activeCombinedForecast,
      selectedLocation,
    ],
  );

  const chartViewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportDimensions, setViewportDimensions] = useState<{
    width: number;
    height: number;
  }>({ width: 1000, height: 0 });

  useEffect(() => {
    const el = chartViewportRef.current;
    if (!el) return;

    const updateDimensions = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        setViewportDimensions((current) =>
          current.width === rect.width && current.height === rect.height
            ? current
            : { width: rect.width, height: rect.height },
        );
      }
    };

    updateDimensions();

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(updateDimensions);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const hasDetailedCloud = Boolean(
    activeVerticalCloudData.verticalCloudForecast &&
    (activeVerticalCloudData.verticalCloudForecast.profiles?.length ?? 0) > 0,
  );
  const naturalHeight = hasDetailedCloud ? 468 : 438;
  const meteogramScale = useMemo(
    () =>
      calculateMeteogramScale({
        availableHeight: viewportDimensions.height,
        naturalHeight,
      }),
    [viewportDimensions.height, naturalHeight],
  );

  if (
    !currentConfig ||
    !currentConfig.model_chain ||
    currentConfig.model_chain.length === 0
  ) {
    return (
      <div className="view-container meteogram-view">
        <div
          className="card empty-state"
          data-testid="no-runnable-config-state"
        >
          <p>
            No forecast configuration available. Create or edit a configuration
            and add at least one weather model.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="view-container meteogram-view">
      {showModelChains && (
        <MeteogramModelChains
          activeModelChain={displayedModelChain}
          activeCloudModelChain={displayedCloudModelChain}
          availableModels={mainChainModels}
          cloudAvailableModels={cloudChainModels}
          onModelChainChange={handleModelChainChange}
          onModelChainResizeEnd={handleResizeEnd}
          onCloudModelChainChange={handleCloudModelChainChange}
          onCloudModelChainResizeEnd={handleCloudResizeEnd}
          onCloudBoundaryDrag={handleCloudBoundaryDrag}
          isMainChainCollapsed={isMainChainCollapsed}
          onToggleMainChainCollapse={
            onToggleMainChainCollapse ??
            (() => setInternalMainCollapsed((prev) => !prev))
          }
          isCloudChainCollapsed={isCloudChainCollapsed}
          onToggleCloudChainCollapse={
            onToggleCloudChainCollapse ??
            (() => setInternalCloudCollapsed((prev) => !prev))
          }
        />
      )}

      {error && (
        <div className="status-banner error">
          <AlertTriangle size={18} />
          <div>
            <strong>Error Loading Forecast: </strong>
            <span>{error}</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ marginLeft: "12px" }}
              onClick={handleRefreshClick}
            >
              Retry Fetch
            </button>
          </div>
        </div>
      )}

      {loading && !forecastResponse && (
        <div className="card loading-state">
          <div className="spinner" />
          <p>Fetching multi-model weather forecasts from Open-Meteo...</p>
        </div>
      )}

      {activeCombinedForecast.length > 0 ? (
        <div
          className="meteogram-chart-viewport"
          ref={chartViewportRef}
          data-testid="meteogram-chart-viewport"
        >
          <div
            className="meteogram-scaler"
            style={{
              transform:
                meteogramScale < 1 ? `scale(${meteogramScale})` : undefined,
              transformOrigin: "top center",
              width:
                meteogramScale < 1
                  ? `${Math.round(viewportDimensions.width)}px`
                  : "100%",
              height: meteogramScale < 1 ? `${naturalHeight}px` : "100%",
              flex: meteogramScale < 1 ? undefined : 1,
              marginBottom:
                meteogramScale < 1
                  ? `-${Math.round(naturalHeight * (1 - meteogramScale))}px`
                  : undefined,
            }}
          >
            <ErrorBoundary
              fallbackTitle="Error Rendering Meteogram Chart"
              onReset={handleRefreshClick}
            >
              <MeteogramChart
                data={activeCombinedForecast}
                modelChain={displayedModelChain}
                availableModels={mainChainModels}
                location={selectedLocation}
                verticalCloudForecast={
                  activeVerticalCloudData.verticalCloudForecast
                }
                verticalCloudTransitions={
                  activeVerticalCloudData.verticalCloudTransitions
                }
                modelForecasts={forecastResponse?.model_forecasts}
                modelRunSegments={mainRunSegments}
                sunPhases={forecastResponse?.sun_phases}
                forecastStartTime={forecastResponse?.forecast_start_time}
                generatedAt={forecastResponse?.generated_at}
                chartLayout={chartLayout}
                fallbackLayoutId={fallbackLayoutId}
                forceModelHeaders={forceModelHeaders}
                timelineStart={forecastResponse?.timeline_start}
                timelineEnd={activeTimelineEnd}
                draggedCloudBoundaryHour={draggedCloudBoundaryHour}
                isFullscreenMapOpen={isFullscreenMapOpen}
                getPersistedVisibleRange={getPersistedVisibleRange}
                onVisibleRangeChange={onVisibleRangeChange}
                dayRangeChoice={dayRangeChoice}
                onDayRangeChoiceChange={onDayRangeChoiceChange}
                userTimezone={
                  forecastResponse?.user_timezone ||
                  userTimezone ||
                  apiService.getCachedUserTimezone() ||
                  undefined
                }
              />
            </ErrorBoundary>
          </div>
        </div>
      ) : (
        !loading &&
        !error && (
          <div className="card empty-state">
            <p>
              No forecast data available. Click "Refresh Forecast" to load
              weather data.
            </p>
          </div>
        )
      )}
    </div>
  );
};
