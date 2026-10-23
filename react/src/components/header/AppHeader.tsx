import React from "react";
import type {
  AppMode,
  ArchivedFetchSummary,
  Location,
  MeteogramConfig,
} from "../../types";
import { HistoryMenu } from "./HistoryMenu";
import { AUTO_CONFIG_ID } from "../../utils/autoChain";
import { formatConfigOptionLabel } from "../../utils/configLocation";
import { LocationSelector } from "../LocationSelector";
import {
  Sliders,
  LineChart,
  Sparkles,
  AlertCircle,
  RotateCcw,
  Zap,
} from "lucide-react";
import { getDisplaySaveError } from "./AppHeader.logic";

export { getDisplaySaveError };

export interface AppHeaderProps {
  mode?: AppMode;
  onModeChange?: (mode: AppMode) => void;
  activeTab: "meteogram" | "config";
  onTabChange: (tab: "meteogram" | "config") => void;
  selectedConfig: MeteogramConfig | null;
  meteogramConfigs: MeteogramConfig[];
  onSelectConfig: (config: MeteogramConfig) => void;
  configSaveStatus: "saved" | "saving" | "error" | null;
  configSaveError: string | null;
  location: Location;
  /** Shown instead of the place name, e.g. a configuration's "INSB". */
  locationDisplayName?: string;
  onLocationChange: (loc: Location) => void;
  onRefreshForecast?: () => void;
  forecastLoading?: boolean;
  onResetModelChainBoundaries?: () => void;
  isFullscreenMapOpen?: boolean;
  onFullscreenMapChange?: (isOpen: boolean) => void;
  /** Normal mode: region and auto chain, shown instead of the dropdown. */
  autoChainLabel?: string | null;
  /** Power mode: label of the Auto entry, first in the dropdown (§16.4). */
  autoEntryLabel?: string;
  /** Power mode: the Auto entry is selected. */
  autoSelected?: boolean;
  onSelectAuto?: () => void;
  /** Tooltip of the Auto entry, e.g. the resolved chain. */
  autoEntryTitle?: string;
  /** Power mode: opens an archived fetch (historic viewer, system.md §10). */
  onSelectHistoric?: (fetch: ArchivedFetchSummary) => void;
  /** Shown while a historic fetch is drawn. */
  historic?: {
    badge: string;
    version: string | null;
    missing: string[];
  } | null;
  onBackToLive?: () => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  mode = "power",
  onModeChange,
  activeTab,
  onTabChange,
  selectedConfig,
  meteogramConfigs,
  onSelectConfig,
  configSaveStatus,
  configSaveError,
  location,
  locationDisplayName,
  onLocationChange,
  onRefreshForecast,
  forecastLoading = false,
  onResetModelChainBoundaries,
  isFullscreenMapOpen,
  onFullscreenMapChange,
  autoChainLabel,
  autoEntryLabel = "Auto",
  autoSelected = false,
  onSelectAuto,
  autoEntryTitle,
  onSelectHistoric,
  historic = null,
  onBackToLive,
}) => {
  const isPowerMode = mode === "power";
  return (
    <header className="app-header">
      <div className="header-left-section">
        <div className="header-top-row">
          <div className="brand">
            <img
              className="brand-icon"
              src="./favicon.svg"
              width={28}
              height={28}
              alt="Graupel cloud"
            />
            <h1 className="brand-title">Graupel</h1>
          </div>

          <div className="header-nav-row">
            {isPowerMode && (
              <nav className="nav-tabs">
                <button
                  type="button"
                  className={`nav-tab ${activeTab === "meteogram" ? "active" : ""}`}
                  onClick={() => onTabChange("meteogram")}
                >
                  <LineChart size={18} />
                  <span>Meteo</span>
                </button>
                <button
                  type="button"
                  className={`nav-tab ${activeTab === "config" ? "active" : ""}`}
                  onClick={() => onTabChange("config")}
                >
                  <Sliders size={18} />
                  <span>Config</span>
                </button>
              </nav>
            )}
            <button
              type="button"
              className={`power-mode-toggle ${isPowerMode ? "active" : ""}`}
              aria-pressed={isPowerMode}
              onClick={() => onModeChange?.(isPowerMode ? "normal" : "power")}
              title={
                isPowerMode
                  ? "Power mode: configurations and model chains are shown"
                  : "Normal mode: switch on power mode for configurations and model chains"
              }
              data-testid="power-mode-toggle"
            >
              <Zap size={16} />
              <span>Power mode</span>
              <span className="power-mode-switch" aria-hidden="true" />
            </button>
          </div>
        </div>

        {activeTab === "meteogram" ? (
          isPowerMode ? (
            <div className="header-bottom-row">
              <div className="header-config-control-group">
                <button
                  type="button"
                  className="config-reset-btn"
                  onClick={onResetModelChainBoundaries}
                  disabled={(!selectedConfig && !autoSelected) || Boolean(historic)}
                  title="Reset model-chain boundaries to configuration defaults"
                  aria-label="Reset model-chain boundaries to configuration defaults"
                >
                  <RotateCcw size={16} />
                </button>
                {onSelectHistoric && (
                  <HistoryMenu location={location} onSelect={onSelectHistoric} />
                )}
                <div className="header-config-selector">
                  <Sparkles size={16} className="sparkle-icon" />
                  <select
                    value={autoSelected ? AUTO_CONFIG_ID : selectedConfig?.id || ""}
                    onChange={(e) => {
                      if (e.target.value === AUTO_CONFIG_ID) {
                        onSelectAuto?.();
                        return;
                      }
                      const cfg = meteogramConfigs.find(
                        (c) => c.id === e.target.value,
                      );
                      if (cfg) onSelectConfig(cfg);
                    }}
                    className={`config-select-dropdown${autoSelected ? " auto-selected" : ""}`}
                    title={autoSelected ? autoEntryTitle : undefined}
                    data-testid="config-select"
                  >
                    {/* Not a stored configuration: marked and never editable. */}
                    <option
                      value={AUTO_CONFIG_ID}
                      className="config-option-auto"
                      title={autoEntryTitle}
                      data-testid="config-option-auto"
                    >
                      {`✦ ${autoEntryLabel}`}
                    </option>
                    {!autoSelected && !selectedConfig && (
                      <option value="" disabled>
                        {meteogramConfigs.length > 0
                          ? "Select a configuration"
                          : "No configurations with models"}
                      </option>
                    )}
                    {meteogramConfigs.map((cfg) => (
                      <option key={cfg.id || cfg.name} value={cfg.id}>
                        {formatConfigOptionLabel(cfg)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {historic && (
                <div className="historic-controls" data-testid="historic-controls">
                  <span className="historic-badge" data-testid="historic-badge">
                    {historic.badge}
                  </span>
                  {historic.version && (
                    <span className="historic-version" data-testid="historic-version">
                      {historic.version}
                    </span>
                  )}
                  {historic.missing.length > 0 && (
                    <span className="historic-missing" data-testid="historic-missing">
                      Not archived: {historic.missing.join(", ")}
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary historic-back-btn"
                    onClick={onBackToLive}
                    data-testid="historic-back-to-live"
                  >
                    Back to live
                  </button>
                </div>
              )}
            </div>
          ) : autoChainLabel ? (
            <div className="header-bottom-row">
              <div
                className="header-auto-chain"
                data-testid="auto-chain-label"
                title="Region and model chain chosen for this location"
              >
                <Sparkles size={16} className="sparkle-icon" />
                <span className="header-auto-chain-text">{autoChainLabel}</span>
              </div>
            </div>
          ) : null
        ) : configSaveStatus === "error" ? (
          <div className="header-bottom-row">
            <div className="header-save-status">
              <span
                className="save-status-badge error"
                data-testid="config-save-error"
                title={getDisplaySaveError(configSaveError)}
              >
                <AlertCircle size={14} /> {getDisplaySaveError(configSaveError)}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="header-right-section">
        <LocationSelector
          location={location}
          displayName={locationDisplayName}
          // Config view: each configuration has its own location field (#175).
          disabled={activeTab === "config"}
          onChange={onLocationChange}
          onRefreshForecast={
            activeTab === "meteogram" ? onRefreshForecast : undefined
          }
          loading={forecastLoading}
          refreshDisabled={Boolean(historic)}
          currentView={activeTab}
          onNavigateView={onTabChange}
          isFullscreenMapOpen={isFullscreenMapOpen}
          onFullscreenMapChange={onFullscreenMapChange}
        />
      </div>
    </header>
  );
};
