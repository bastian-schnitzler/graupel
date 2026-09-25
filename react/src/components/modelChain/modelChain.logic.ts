import type { WeatherModel, ModelMetadata } from "../../types";
import { reorderAndAdjustModelChain } from "./modelChainBuilderUtils";

export const MODEL_COLORS: Record<string, string> = {
  "ICON-D2": "#3b82f6",
  "ICON-EU": "#10b981",
  "ECMWF-IFS": "#8b5cf6",
  GFS: "#f59e0b",
  "GFS Seamless": "#f59e0b",
  "ICON Seamless": "#0ea5e9",
};

export interface ModelDropParams {
  draggedIdx: number | null;
  targetIndex: number;
  readOnly: boolean;
  modelChain: WeatherModel[];
  availableModels?: Record<string, ModelMetadata>;
  onChange: (newChain: WeatherModel[], instant?: boolean) => void;
  onDragEnd?: () => void;
}

/**
 * Handles dropping a model segment onto another position in the chain.
 * Reorders the chain and adjusts boundary horizons accordingly.
 */
export function resolveModelDrop({
  draggedIdx,
  targetIndex,
  readOnly,
  modelChain,
  availableModels,
  onChange,
  onDragEnd,
}: ModelDropParams): boolean {
  if (draggedIdx === null || draggedIdx === targetIndex || readOnly) {
    return false;
  }

  const adjusted = reorderAndAdjustModelChain(
    modelChain,
    draggedIdx,
    targetIndex,
    availableModels,
  );
  onChange(adjusted, true);
  if (onDragEnd) {
    onDragEnd();
  }
  return true;
}
