import React from "react";
import type { Location, MeteogramConfig } from "../../types";
import { LocationSelector } from "../LocationSelector";
import {
  Sliders,
  LineChart,
  Sparkles,
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import { getDisplaySaveError } from "./AppHeader.logic";

export { getDisplaySaveError };

export interface AppHeaderProps {
  activeTab: "meteogram" | "config";
  onTabChange: (tab: "meteogram" | "config") => void;
  selectedConfig: MeteogramConfig | null;
  meteogramConfigs: MeteogramConfig[];
  onSelectConfig: (config: MeteogramConfig) => void;
  configSaveStatus: "saved" | "saving" | "error" | null;
  configSaveError: string | null;
  location: Location;
  onLocationChange: (loc: Location) => void;
  onRefreshForecast?: () => void;
  forecastLoading?: boolean;
  onResetModelChainBoundaries?: () => void;
  isFullscreenMapOpen?: boolean;
  onFullscreenMapChange?: (isOpen: boolean) => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  activeTab,
  onTabChange,
  selectedConfig,
  meteogramConfigs,
  onSelectConfig,
  configSaveStatus,
  configSaveError,
  location,
  onLocationChange,
  onRefreshForecast,
  forecastLoading = false,
  onResetModelChainBoundaries,
  isFullscreenMapOpen,
  onFullscreenMapChange,
}) => {
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
        </div>

        {activeTab === "meteogram" ? (
          <div className="header-bottom-row">
            <div className="header-config-control-group">
              <button
                type="button"
                className="config-reset-btn"
                onClick={onResetModelChainBoundaries}
                disabled={!selectedConfig}
                title="Reset model-chain boundaries to configuration defaults"
                aria-label="Reset model-chain boundaries to configuration defaults"
              >
                <RotateCcw size={16} />
              </button>
              <div className="header-config-selector">
                <Sparkles size={16} className="sparkle-icon" />
                <select
                  value={selectedConfig?.id || ""}
                  onChange={(e) => {
                    const cfg = meteogramConfigs.find(
                      (c) => c.id === e.target.value,
                    );
                    if (cfg) onSelectConfig(cfg);
                  }}
                  className="config-select-dropdown"
                  disabled={meteogramConfigs.length === 0}
                >
                  {meteogramConfigs.length > 0 ? (
                    meteogramConfigs.map((cfg) => (
                      <option key={cfg.id || cfg.name} value={cfg.id}>
                        {cfg.name} ({cfg.location.name})
                      </option>
                    ))
                  ) : (
                    <option value="" disabled>
                      No configurations with models
                    </option>
                  )}
                </select>
              </div>
            </div>
          </div>
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
          onChange={onLocationChange}
          onRefreshForecast={
            activeTab === "meteogram" ? onRefreshForecast : undefined
          }
          loading={forecastLoading}
          currentView={activeTab}
          onNavigateView={onTabChange}
          isFullscreenMapOpen={isFullscreenMapOpen}
          onFullscreenMapChange={onFullscreenMapChange}
        />
      </div>
    </header>
  );
};
