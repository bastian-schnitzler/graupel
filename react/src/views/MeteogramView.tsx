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
} from "./meteogramViewUtils";
import { buildModelMap } from "./config/configFactories";
import { DEFAULT_LOCATION } from "../App.logic";

interface MeteogramViewProps {
  currentConfig: MeteogramConfig | null;
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
}

export const MeteogramView: React.FC<MeteogramViewProps> = ({
  currentConfig,
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
  const [isMainChainCollapsed, setIsMainChainCollapsed] =
    useState<boolean>(false);
  const [isCloudChainCollapsed, setIsCloudChainCollapsed] =
    useState<boolean>(false);
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

  const handleModelChainChange = (newChain: WeatherModel[]) => {
    setActiveModelChain(newChain);
    activeModelChainRef.current = newChain;
    onModelChainDisplayChange?.(newChain);
  };

  const handleResizeEnd = () => {
    onModelChainDisplayChange?.(activeModelChainRef.current);
  };

  const handleCloudModelChainChange = (newChain: WeatherModel[]) => {
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
        activeModelChain,
        forecastResponse?.timeline_end,
      ),
    [forecastResponse, activeModelChain],
  );

  useEffect(() => {
    if (!import.meta.env.DEV || !forecastResponse?.timeline_diagnostics) return;
    logTimelineDiagnostics(forecastResponse.timeline_diagnostics);
  }, [forecastResponse?.timeline_diagnostics]);

  const activeCombinedForecast = useMemo(
    () =>
      resolveActiveCombinedForecast(
        forecastResponse,
        activeModelChain,
        activeTimelineEnd,
      ),
    [forecastResponse, activeModelChain, activeTimelineEnd],
  );

  const activeVerticalCloudData = useMemo(
    () =>
      resolveActiveVerticalCloudData(
        forecastResponse,
        activeCloudModelChain,
        activeCombinedForecast,
        selectedLocation,
      ),
    [
      forecastResponse,
      activeCloudModelChain,
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
      <MeteogramModelChains
        activeModelChain={activeModelChain}
        activeCloudModelChain={activeCloudModelChain}
        availableModels={availableModels}
        onModelChainChange={handleModelChainChange}
        onModelChainResizeEnd={handleResizeEnd}
        onCloudModelChainChange={handleCloudModelChainChange}
        onCloudModelChainResizeEnd={handleCloudResizeEnd}
        onCloudBoundaryDrag={handleCloudBoundaryDrag}
        isMainChainCollapsed={isMainChainCollapsed}
        onToggleMainChainCollapse={() =>
          setIsMainChainCollapsed((prev) => !prev)
        }
        isCloudChainCollapsed={isCloudChainCollapsed}
        onToggleCloudChainCollapse={() =>
          setIsCloudChainCollapsed((prev) => !prev)
        }
      />

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
                modelChain={activeModelChain}
                availableModels={availableModels}
                location={selectedLocation}
                verticalCloudForecast={
                  activeVerticalCloudData.verticalCloudForecast
                }
                verticalCloudTransitions={
                  activeVerticalCloudData.verticalCloudTransitions
                }
                modelForecasts={forecastResponse?.model_forecasts}
                sunPhases={forecastResponse?.sun_phases}
                forecastStartTime={forecastResponse?.forecast_start_time}
                timelineStart={forecastResponse?.timeline_start}
                timelineEnd={activeTimelineEnd}
                draggedCloudBoundaryHour={draggedCloudBoundaryHour}
                isFullscreenMapOpen={isFullscreenMapOpen}
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
