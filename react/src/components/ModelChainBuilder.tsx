import React, { useState, useMemo } from "react";
import type { WeatherModel, ModelMetadata } from "../types";
import { AlertCircle, Search, ChevronDown } from "lucide-react";
import { ModelChain } from "./modelChain/ModelChain";
import {
  validateModelChain,
  getUnselectedModelKeys,
  filterAndSortAvailableModels,
  tryAddModelToChain,
} from "./modelChain/modelChainBuilderUtils";
import { AVAILABLE_MODELS_METADATA } from "../models/openMeteoModels";

interface ModelChainBuilderProps {
  modelChain: WeatherModel[];
  onChange: (newChain: WeatherModel[], instant?: boolean) => void;
  onDragEnd?: () => void;
  onResizeEnd?: () => void;
  onBoundaryDrag?: (
    isDragging: boolean,
    boundaryIndex?: number,
    boundaryHour?: number,
  ) => void;
  availableModels?: Record<string, ModelMetadata>;
  readOnly?: boolean;
  allowReorder?: boolean;
  allowAdd?: boolean;
  allowDelete?: boolean;
  showTotalHours?: boolean;
  showMissingVariables?: boolean;
  isCloudChain?: boolean;
  title?: string;
  testIdPrefix?: string;
  emptyMessage?: string;
  borderLabel?: string;
  collapsible?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const ModelChainBuilder: React.FC<ModelChainBuilderProps> = ({
  modelChain,
  onChange,
  onDragEnd,
  onResizeEnd,
  onBoundaryDrag,
  availableModels = AVAILABLE_MODELS_METADATA,
  readOnly = false,
  allowReorder = false,
  allowAdd = true,
  allowDelete = true,
  showTotalHours = true,
  showMissingVariables,
  isCloudChain,
  title,
  testIdPrefix,
  emptyMessage,
  borderLabel,
  collapsible,
  isCollapsed,
  onToggleCollapse,
}) => {
  const effectiveIsCloudChain =
    isCloudChain ?? (testIdPrefix === "cloud-" || borderLabel === "CLOUDS");
  const effectiveShowMissingVariables =
    showMissingVariables ?? !effectiveIsCloudChain;
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>("");

  const validationErrors = useMemo(
    () =>
      validateModelChain(
        modelChain,
        availableModels,
        effectiveShowMissingVariables,
      ),
    [modelChain, availableModels, effectiveShowMissingVariables],
  );

  const handleAddModel = (modelKey: string) => {
    if (readOnly) return;
    const result = tryAddModelToChain(modelChain, modelKey, availableModels);
    if (!result.success) {
      if (result.error) alert(result.error);
      return;
    }

    onChange(result.newChain!, true);
    if (onDragEnd) onDragEnd();
    setIsDropdownOpen(false);
    setSearchTerm("");
  };

  const unselectedModelKeys = useMemo(
    () => getUnselectedModelKeys(modelChain, availableModels),
    [availableModels, modelChain],
  );

  const filteredModels = useMemo(
    () =>
      filterAndSortAvailableModels(
        unselectedModelKeys,
        availableModels,
        searchTerm,
      ),
    [unselectedModelKeys, availableModels, searchTerm],
  );

  return (
    <div className="model-chain-builder">
      {(title || (!readOnly && allowAdd && unselectedModelKeys.length > 0)) && (
        <div
          className="model-chain-actions"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "0.5rem",
          }}
        >
          {title ? (
            <h4
              style={{
                margin: 0,
                fontSize: "0.95rem",
                fontWeight: 600,
                color: "var(--text-primary, #1e293b)",
              }}
            >
              {title}
            </h4>
          ) : (
            <div />
          )}

          {!readOnly && allowAdd && unselectedModelKeys.length > 0 && (
            <div
              className="add-model-dropdown-container"
              style={{ position: "relative" }}
            >
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                data-testid={
                  testIdPrefix
                    ? `${testIdPrefix}add-model-btn`
                    : "add-model-btn"
                }
                style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}
              >
                <span>
                  + Add Model ({unselectedModelKeys.length} available)
                </span>
                <ChevronDown size={14} />
              </button>

              {isDropdownOpen && (
                <div
                  className="add-model-dropdown-menu"
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "100%",
                    marginTop: "0.25rem",
                    width: "20rem",
                    backgroundColor: "#ffffff",
                    borderRadius: "0.375rem",
                    boxShadow:
                      "0 0.625rem 0.9375rem -0.1875rem rgba(0, 0, 0, 0.1), 0 0.25rem 0.375rem -0.125rem rgba(0, 0, 0, 0.05)",
                    border: "0.0625rem solid #e2e8f0",
                    zIndex: 50,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      padding: "0.5rem",
                      borderBottom: "0.0625rem solid #e2e8f0",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.375rem",
                    }}
                  >
                    <Search size={14} color="#64748b" />
                    <input
                      type="text"
                      placeholder="Filter models (name, region, provider)..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      autoFocus
                      style={{
                        border: "none",
                        outline: "none",
                        width: "100%",
                        fontSize: "0.85rem",
                      }}
                    />
                  </div>

                  <div
                    style={{
                      overflowY: "auto",
                      maxHeight: "17.5rem",
                      padding: "0.25rem 0",
                    }}
                    data-testid={
                      testIdPrefix
                        ? `${testIdPrefix}model-dropdown-list`
                        : "model-dropdown-list"
                    }
                  >
                    {filteredModels.length === 0 ? (
                      <div
                        style={{
                          padding: "0.75rem",
                          fontSize: "0.85rem",
                          color: "#64748b",
                          textAlign: "center",
                        }}
                      >
                        No matching models found.
                      </div>
                    ) : (
                      filteredModels.map((key) => {
                        const meta = availableModels[key];
                        const provider = meta.provider || "Provider N/A";
                        const region =
                          meta.region ||
                          meta.geographical_coverage ||
                          "Coverage N/A";
                        const resolution =
                          meta.spatial_resolution_km || meta.spatial_resolution
                            ? `${meta.spatial_resolution_km || meta.spatial_resolution} km`
                            : "Res N/A";
                        const tempRes =
                          meta.temporal_resolution_hours ||
                          meta.temporal_resolution
                            ? `${meta.temporal_resolution_hours || meta.temporal_resolution}h`
                            : "1h";
                        const maxH =
                          meta.max_forecast_horizon_hours ||
                          meta.max_forecast_hours ||
                          24;
                        const hasMissingVars =
                          effectiveShowMissingVariables &&
                          meta.missing_variables &&
                          meta.missing_variables.length > 0;

                        return (
                          <div
                            key={key}
                            onClick={() => handleAddModel(key)}
                            data-testid={
                              testIdPrefix
                                ? `${testIdPrefix}add-model-item-${meta.name}`
                                : `add-model-item-${meta.name}`
                            }
                            style={{
                              padding: "0.5rem 0.75rem",
                              cursor: "pointer",
                              borderBottom: "0.0625rem solid #f1f5f9",
                              transition: "background-color 0.15s",
                            }}
                            onMouseEnter={(e) =>
                              (e.currentTarget.style.backgroundColor =
                                "#f8fafc")
                            }
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.backgroundColor =
                                "transparent")
                            }
                          >
                            <div
                              style={{
                                fontWeight: 600,
                                fontSize: "0.9rem",
                                color: "#1e293b",
                              }}
                            >
                              {meta.name}
                            </div>
                            <div
                              style={{
                                fontSize: "0.75rem",
                                color: "#64748b",
                                marginTop: "0.125rem",
                              }}
                            >
                              {provider} &bull; {region}
                            </div>
                            <div
                              style={{
                                fontSize: "0.75rem",
                                color: "#3b82f6",
                                marginTop: "0.125rem",
                              }}
                            >
                              {resolution} &bull; {tempRes} &bull; max {maxH}h
                            </div>
                            {hasMissingVars && (
                              <div
                                style={{
                                  fontSize: "0.7rem",
                                  color: "#f59e0b",
                                  marginTop: "0.125rem",
                                }}
                              >
                                ⚠ Missing: {meta.missing_variables?.join(", ")}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {validationErrors.length > 0 && (
        <div
          className="validation-banner error"
          style={{
            padding: "0.375rem 0.75rem",
            fontSize: "0.8rem",
            marginBottom: "0.5rem",
          }}
        >
          <AlertCircle size={16} />
          <div>
            {validationErrors.map((err, i) => (
              <div key={i}>{err}</div>
            ))}
          </div>
        </div>
      )}

      {modelChain.length === 0 ? (
        <div
          className="empty-chain-state card"
          style={{
            padding: "1.5rem",
            textAlign: "center",
            backgroundColor: "var(--bg-dark)",
            border: "0.0625rem dashed var(--border-color)",
            borderRadius: "0.5rem",
            margin: "0.5rem 0",
          }}
          data-testid={
            testIdPrefix
              ? `${testIdPrefix}empty-model-chain`
              : "empty-model-chain"
          }
        >
          <p
            style={{
              margin: 0,
              color: "var(--text-secondary)",
              fontSize: "0.9rem",
            }}
          >
            {emptyMessage || (
              <>
                No models configured. Click <strong>+ Add Model</strong> to
                start building a chain.
              </>
            )}
          </p>
        </div>
      ) : (
        <ModelChain
          modelChain={modelChain}
          onChange={onChange}
          availableModels={availableModels}
          readOnly={readOnly}
          allowReorder={allowReorder}
          allowDelete={allowDelete}
          showTotalHours={showTotalHours}
          onResizeEnd={onResizeEnd}
          onDragEnd={onDragEnd}
          onBoundaryDrag={onBoundaryDrag}
          borderLabel={borderLabel}
          showMissingVariables={effectiveShowMissingVariables}
          isCloudChain={effectiveIsCloudChain}
          collapsible={collapsible}
          isCollapsed={isCollapsed}
          onToggleCollapse={onToggleCollapse}
        />
      )}
    </div>
  );
};
