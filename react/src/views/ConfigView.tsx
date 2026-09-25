import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import type { MeteogramConfig, WeatherModel } from "../types";
import { ConfigSidebar } from "./config/ConfigSidebar";
import { ConfigEditor } from "./config/ConfigEditor";
import { apiService } from "../services/apiService";
import {
  isValidConfig as isConfigValid,
  filterCloudCompatibleModels,
} from "./config/configValidation";
import {
  calculateInsertIndex,
  createNewConfigurationPayload,
  createDuplicateConfigurationPayload,
  buildModelMap,
  findInitialActiveConfig,
  getNextActiveConfigAfterDelete,
  reorderConfigurationsList,
} from "./config/configFactories";

interface ConfigViewProps {
  selectedConfigId: string | null;
  onSelectConfig: (config: MeteogramConfig) => void;
  onConfigsUpdated?: () => void;
  onSaveStatusChange?: (
    status: "saved" | "saving" | "error" | null,
    error?: string | null,
  ) => void;
}

export const ConfigView: React.FC<ConfigViewProps> = ({
  selectedConfigId,
  onSelectConfig,
  onConfigsUpdated,
  onSaveStatusChange,
}) => {
  const [configs, setConfigs] = useState<MeteogramConfig[]>([]);
  const [availableModels, setAvailableModels] = useState<Record<string, any>>(
    {},
  );
  const [activeConfig, setActiveConfig] = useState<MeteogramConfig | null>(
    null,
  );
  const [loading, setLoading] = useState<boolean>(true);

  // Status feedback state
  const [saveStatus, setSaveStatus] = useState<
    "saved" | "saving" | "error" | null
  >(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (onSaveStatusChange) {
      onSaveStatusChange(saveStatus, saveError);
    }
  }, [saveStatus, saveError, onSaveStatusChange]);

  // Refs for debouncing, version tracking, and race condition protection
  const pendingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );
  const configVersions = useRef<Record<string, number>>({});
  const lastSavedVersions = useRef<Record<string, number>>({});
  const pendingSaves = useRef<Record<string, MeteogramConfig>>({});
  const deletedIds = useRef<Set<string>>(new Set());

  const activeConfigRef = useRef<MeteogramConfig | null>(null);
  activeConfigRef.current = activeConfig;
  const isMountedRef = useRef<boolean>(true);

  const cloudAvailableModels = useMemo(
    () => filterCloudCompatibleModels(availableModels),
    [availableModels],
  );

  // Validation function
  const isValidConfig = useCallback(
    (cfg: MeteogramConfig): boolean => isConfigValid(cfg, availableModels),
    [availableModels],
  );

  const performSave = useCallback(
    async (configId: string) => {
      const configToSave = pendingSaves.current[configId];
      const version = configVersions.current[configId] || 0;

      if (!configToSave || deletedIds.current.has(configId)) {
        return;
      }

      if (activeConfigRef.current?.id === configId) {
        setSaveStatus("saving");
        setSaveError(null);
      }

      try {
        await apiService.saveConfiguration(configToSave);
        delete pendingSaves.current[configId];

        if (deletedIds.current.has(configId)) return;

        const currentLastSaved = lastSavedVersions.current[configId] || 0;
        if (version >= currentLastSaved) {
          lastSavedVersions.current[configId] = version;

          if (activeConfigRef.current?.id === configId) {
            setSaveStatus("saved");
            setSaveError(null);
          }
        }

        if (onConfigsUpdated) {
          onConfigsUpdated();
        }
      } catch (e: any) {
        console.error(`Autosave failed for config ${configId}:`, e);
        if (deletedIds.current.has(configId) || !isMountedRef.current) return;

        if (activeConfigRef.current?.id === configId) {
          setSaveStatus("error");
          setSaveError("Could not save configuration. Retrying...");
        }

        // Schedule retry after 3 seconds
        if (pendingTimers.current[configId]) {
          clearTimeout(pendingTimers.current[configId]);
        }
        pendingTimers.current[configId] = setTimeout(() => {
          performSave(configId);
        }, 3000);
      }
    },
    [onConfigsUpdated],
  );

  const flushPendingSave = useCallback(
    (configId: string) => {
      if (pendingTimers.current[configId]) {
        clearTimeout(pendingTimers.current[configId]);
        delete pendingTimers.current[configId];
      }
      if (pendingSaves.current[configId]) {
        performSave(configId);
      }
    },
    [performSave],
  );

  const scheduleSave = useCallback(
    (configToSave: MeteogramConfig, debounceMs: number) => {
      const configId = configToSave.id;
      if (!configId) return;

      if (!isValidConfig(configToSave)) {
        // Invalid state, do not schedule backend write
        return;
      }

      const newVersion = (configVersions.current[configId] || 0) + 1;
      configVersions.current[configId] = newVersion;
      pendingSaves.current[configId] = configToSave;

      if (pendingTimers.current[configId]) {
        clearTimeout(pendingTimers.current[configId]);
      }

      if (debounceMs <= 0) {
        performSave(configId);
      } else {
        if (activeConfigRef.current?.id === configId) {
          setSaveStatus("saving");
        }
        pendingTimers.current[configId] = setTimeout(() => {
          delete pendingTimers.current[configId];
          performSave(configId);
        }, debounceMs);
      }
    },
    [isValidConfig, performSave],
  );

  useEffect(() => {
    isMountedRef.current = true;
    loadConfigs();
    return () => {
      isMountedRef.current = false;
      // Clear all pending retry timers
      Object.values(pendingTimers.current).forEach(clearTimeout);
      pendingTimers.current = {};
      // Flush all pending saves on unmount so unsaved edits are persisted
      Object.keys(pendingSaves.current).forEach((id) => {
        flushPendingSave(id);
      });
      // Clear any retry timers that might have been scheduled during flush
      Object.values(pendingTimers.current).forEach(clearTimeout);
      pendingTimers.current = {};
    };
  }, [flushPendingSave]);

  const loadConfigs = async () => {
    setLoading(true);
    try {
      const list = await apiService.getConfigurations();
      const models = await apiService.getModels();
      const modelMap = buildModelMap(models);
      setAvailableModels(modelMap);
      setConfigs(list);

      const current = findInitialActiveConfig(list, selectedConfigId);
      if (current) {
        setActiveConfig(current);
        setSaveStatus("saved");
        onSelectConfig(current);
      }
    } catch (e: any) {
      console.error("Failed to load configurations:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectConfig = (cfg: MeteogramConfig) => {
    if (activeConfig?.id && activeConfig.id !== cfg.id) {
      flushPendingSave(activeConfig.id);
    }

    setActiveConfig(cfg);
    setSaveStatus("saved");
    setSaveError(null);
    onSelectConfig(cfg);
  };

  const handleCreateNewConfig = async () => {
    if (activeConfig?.id) {
      flushPendingSave(activeConfig.id);
    }

    const insertIdx = calculateInsertIndex(configs, activeConfig?.id);
    const newCfgPayload = createNewConfigurationPayload(
      configs,
      activeConfig?.location,
    );

    try {
      setSaveStatus("saving");
      const persisted = await apiService.createConfiguration(
        newCfgPayload,
        insertIdx,
      );
      const updatedList = [...configs];
      updatedList.splice(insertIdx, 0, persisted);
      setConfigs(updatedList);
      setActiveConfig(persisted);
      setSaveStatus("saved");
      setSaveError(null);
      onSelectConfig(persisted);
      if (onConfigsUpdated) onConfigsUpdated();
    } catch (e: any) {
      console.error("Failed to create configuration:", e);
      setSaveStatus("error");
      setSaveError("Failed to create configuration.");
    }
  };

  const handleDuplicate = async () => {
    if (!activeConfig) return;
    if (activeConfig.id) {
      flushPendingSave(activeConfig.id);
    }

    const insertIdx = calculateInsertIndex(configs, activeConfig.id);
    const duplicatePayload = createDuplicateConfigurationPayload(
      activeConfig,
      configs,
    );

    try {
      setSaveStatus("saving");
      const persisted = await apiService.createConfiguration(
        duplicatePayload,
        insertIdx,
      );
      const updatedList = [...configs];
      updatedList.splice(insertIdx, 0, persisted);
      setConfigs(updatedList);
      setActiveConfig(persisted);
      setSaveStatus("saved");
      setSaveError(null);
      onSelectConfig(persisted);
      if (onConfigsUpdated) onConfigsUpdated();
    } catch (e: any) {
      console.error("Failed to duplicate configuration:", e);
      setSaveStatus("error");
      setSaveError("Failed to duplicate configuration.");
    }
  };

  const handleDelete = async () => {
    if (!activeConfig || !activeConfig.id) return;
    if (configs.length <= 1) {
      alert("Cannot delete the last remaining configuration.");
      return;
    }

    if (!confirm(`Are you sure you want to delete "${activeConfig.name}"?`)) {
      return;
    }

    const idToDelete = activeConfig.id;
    const deletedIdx = configs.findIndex((c) => c.id === idToDelete);

    if (pendingTimers.current[idToDelete]) {
      clearTimeout(pendingTimers.current[idToDelete]);
      delete pendingTimers.current[idToDelete];
    }
    delete pendingSaves.current[idToDelete];
    deletedIds.current.add(idToDelete);

    try {
      await apiService.deleteConfiguration(idToDelete);
      const updatedList = configs.filter((c) => c.id !== idToDelete);
      setConfigs(updatedList);

      const nextActive = getNextActiveConfigAfterDelete(
        updatedList,
        deletedIdx,
      );
      if (nextActive) {
        setActiveConfig(nextActive);
        setSaveStatus("saved");
        setSaveError(null);
        onSelectConfig(nextActive);
      }
      if (onConfigsUpdated) onConfigsUpdated();
    } catch (e: any) {
      console.error(`Delete failed:`, e);
      setSaveStatus("error");
      setSaveError(`Delete failed: ${e.message}`);
    }
  };

  const handleReorderConfigs = async (
    sourceIndex: number,
    targetIndex: number,
  ) => {
    const reordered = reorderConfigurationsList(
      configs,
      sourceIndex,
      targetIndex,
    );
    setConfigs(reordered);

    try {
      const ids = reordered.map((c) => c.id!).filter(Boolean);
      await apiService.reorderConfigurations(ids);
      if (onConfigsUpdated) onConfigsUpdated();
    } catch (err) {
      console.error("Failed to persist reordered configurations:", err);
    }
  };

  const updateActiveConfigState = (
    updated: MeteogramConfig,
    debounceMs?: number,
  ) => {
    activeConfigRef.current = updated;
    setActiveConfig(updated);

    // Update sidebar / configs list immediately for instant UI feedback
    setConfigs((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));

    onSelectConfig(updated);
    if (debounceMs !== undefined) {
      scheduleSave(updated, debounceMs);
    }
  };

  const handleNameChange = (newName: string) => {
    if (!activeConfig) return;
    const updated = { ...activeConfig, name: newName };
    updateActiveConfigState(updated, 400);
  };

  const handleModelChainChange = (
    newChain: WeatherModel[],
    instant = false,
  ) => {
    if (!activeConfig) return;
    const updated = {
      ...activeConfig,
      model_chain: newChain,
      main_model_chain: newChain,
    };
    if (instant) {
      updateActiveConfigState(updated, 0);
    } else {
      // While dragging sliders between boxes, do not schedule autosave.
      // Cancel any pending timer and update local UI state only.
      if (updated.id && pendingTimers.current[updated.id]) {
        clearTimeout(pendingTimers.current[updated.id]);
        delete pendingTimers.current[updated.id];
      }
      updateActiveConfigState(updated);
    }
  };

  const handleCloudModelChainChange = (
    newChain: WeatherModel[],
    instant = false,
  ) => {
    if (!activeConfig) return;
    const updated = {
      ...activeConfig,
      cloud_model_chain: newChain,
    };
    if (instant) {
      updateActiveConfigState(updated, 0);
    } else {
      if (updated.id && pendingTimers.current[updated.id]) {
        clearTimeout(pendingTimers.current[updated.id]);
        delete pendingTimers.current[updated.id];
      }
      updateActiveConfigState(updated);
    }
  };

  const handleModelChainInstantCommit = () => {
    const currentActive = activeConfigRef.current;
    if (!currentActive) return;
    // Commit model reorder drop, add model, remove model, or resize drag end immediately
    scheduleSave(currentActive, 0);
  };

  if (loading) {
    return (
      <div className="view-container loading-state">
        <div className="spinner" />
        <p>Loading configurations...</p>
      </div>
    );
  }

  return (
    <div className="view-container config-view">
      <ConfigSidebar
        configs={configs}
        activeConfigId={activeConfig?.id || null}
        onSelectConfig={handleSelectConfig}
        onCreateConfig={handleCreateNewConfig}
        onDuplicateConfig={handleDuplicate}
        onDeleteConfig={handleDelete}
        onReorderConfigs={handleReorderConfigs}
      />

      <ConfigEditor
        activeConfig={activeConfig}
        availableModels={availableModels}
        cloudAvailableModels={cloudAvailableModels}
        onNameChange={handleNameChange}
        onNameBlur={() => {
          if (activeConfig?.id && pendingSaves.current[activeConfig.id]) {
            flushPendingSave(activeConfig.id);
          }
        }}
        onMainModelChainChange={handleModelChainChange}
        onCloudModelChainChange={handleCloudModelChainChange}
        onModelChainInstantCommit={handleModelChainInstantCommit}
      />
    </div>
  );
};
