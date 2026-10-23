import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Copy, GripVertical, Lock, RotateCcw, Trash2 } from "lucide-react";
import type { MeteogramConfig, StoredLayout } from "../../types";
import type { ChartLayout } from "../../layouts/types";
import { apiService } from "../../services/apiService";
import {
  canDeleteLayout,
  getNextLayoutName,
  moveLayoutIds,
} from "../../layouts/layoutLibrary.logic";
import {
  getEntryFallbackId,
  getLayoutError,
  toEditableLayout,
} from "../../layouts/layoutEditor.logic";
import { LayoutEditor } from "./LayoutEditor";

/** Delay between the last edit and the autosave of a layout. */
export const LAYOUT_SAVE_DEBOUNCE_MS = 600;

type SaveStatus = "saved" | "saving" | "error" | null;

export interface MeteogramLayoutsPanelProps {
  /** Model chain configurations, to count how many use each layout. The
   * layout itself is chosen in the Model chains tab (#199). */
  configs: MeteogramConfig[];
  /** Called after the library or the global layout changed. */
  onLayoutsUpdated?: () => void;
  /** Autosave state for the header error badge. */
  onSaveStatusChange?: (status: SaveStatus, error?: string | null) => void;
  /** Live preview of the edited layout with the current forecast. */
  renderPreview?: (
    layout: ChartLayout,
    fallbackLayoutId: string,
  ) => React.ReactNode;
}

function fetchLibrary(): Promise<StoredLayout[]> {
  return apiService.getLayouts();
}

/** Name field; commits a non-empty change on blur or Enter. */
const LayoutNameInput: React.FC<{
  name: string;
  disabled: boolean;
  onCommit: (name: string) => void;
}> = ({ name, disabled, onCommit }) => {
  const [draft, setDraft] = useState(name);
  return (
    <input
      id="layout-name-input"
      type="text"
      className="text-input"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const trimmed = draft.trim();
        if (trimmed) onCommit(trimmed);
        else setDraft(name);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Config → Meteogram tab (system.md §4.3, #168): library of meteogram
 * configurations (layouts) with the fixed Normal mode entry, the global
 * layout and the layout of each model chain configuration, plus the area
 * and series editor with live preview and autosave (#142).
 */
export const MeteogramLayoutsPanel: React.FC<MeteogramLayoutsPanelProps> = ({
  configs,
  onLayoutsUpdated,
  onSaveStatusChange,
  renderPreview,
}) => {
  const [layouts, setLayouts] = useState<StoredLayout[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const draggedIdxRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Edited layout of the selected entry; invalid drafts are never saved.
  const [draft, setDraft] = useState<{
    id: string;
    layout: ChartLayout;
  } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<{ id: string; layout: ChartLayout } | null>(
    null,
  );
  const callbacksRef = useRef({ onLayoutsUpdated, onSaveStatusChange });
  useEffect(() => {
    callbacksRef.current = { onLayoutsUpdated, onSaveStatusChange };
  });

  const selected = layouts.find((layout) => layout.id === selectedId) ?? null;
  const editedLayout = useMemo(
    () =>
      selected
        ? draft?.id === selected.id
          ? draft.layout
          : toEditableLayout(selected)
        : null,
    [selected, draft],
  );

  const applyLibrary = useCallback(
    (list: StoredLayout[]) => {
      setLayouts(list);
      setSelectedId((current) =>
        list.some((layout) => layout.id === current)
          ? current
          : (list[0]?.id ?? null),
      );
      setError(null);
      setLoading(false);
    },
    [],
  );

  const load = useCallback(
    async () => applyLibrary(await fetchLibrary()),
    [applyLibrary],
  );

  const saveLayout = useCallback(async (id: string, layout: ChartLayout) => {
    const { onLayoutsUpdated: updated, onSaveStatusChange: report } =
      callbacksRef.current;
    try {
      const saved = await apiService.updateLayout(id, { layout });
      setLayouts((prev) =>
        prev.map((entry) => (entry.id === id ? saved : entry)),
      );
      report?.("saved", null);
      updated?.();
    } catch (e) {
      console.error("Saving the meteogram configuration failed:", e);
      setEditError(errorText(e));
      report?.("error", "Could not save meteogram configuration.");
    }
  }, []);

  const flushPendingSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (pending) void saveLayout(pending.id, pending.layout);
  }, [saveLayout]);

  // Unsaved edits are saved when the tab or the Config view closes.
  useEffect(() => flushPendingSave, [flushPendingSave]);

  const handleLayoutEdit = (layout: ChartLayout) => {
    if (!selected) return;
    setDraft({ id: selected.id, layout });
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const problem = getLayoutError(layout);
    setEditError(problem);
    if (problem) {
      // Rejected: the stored layout stays as it was.
      pendingSaveRef.current = null;
      return;
    }
    pendingSaveRef.current = { id: selected.id, layout };
    onSaveStatusChange?.("saving", null);
    saveTimerRef.current = setTimeout(
      flushPendingSave,
      LAYOUT_SAVE_DEBOUNCE_MS,
    );
  };

  const selectLayout = (id: string) => {
    if (id === selectedId) return;
    flushPendingSave();
    setDraft(null);
    setEditError(null);
    setSelectedId(id);
  };

  useEffect(() => {
    let cancelled = false;
    fetchLibrary()
      .then((library) => {
        if (!cancelled) applyLibrary(library);
      })
      .catch((e) => {
        console.error("Failed to load meteogram configurations:", e);
        if (cancelled) return;
        setError("Could not load meteogram configurations.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applyLibrary]);

  /** Run a library change, then reload the list and tell the app. */
  const run = async (action: () => Promise<string | void>) => {
    try {
      const nextSelected = await action();
      if (nextSelected) setSelectedId(nextSelected);
      await load();
      onLayoutsUpdated?.();
    } catch (e) {
      console.error("Meteogram configuration change failed:", e);
      setError(errorText(e));
    }
  };

  const handleCreate = () =>
    run(async () => {
      const position = selected ? selected.position + 1 : undefined;
      const created = await apiService.createLayout(
        getNextLayoutName(layouts),
        undefined,
        position,
      );
      return created.id;
    });

  const handleDuplicate = () =>
    selected &&
    run(async () => (await apiService.duplicateLayout(selected.id)).id);

  const handleDelete = () => {
    if (!selected || !canDeleteLayout(layouts, selected.id)) return;
    if (!confirm(`Are you sure you want to delete "${selected.name}"?`)) {
      return;
    }
    const index = layouts.findIndex((layout) => layout.id === selected.id);
    const next = layouts[index + 1] ?? layouts[index - 1];
    void run(async () => {
      await apiService.deleteLayout(selected.id);
      return next?.id;
    });
  };

  const handleReset = () => {
    if (!selected) return;
    // Drop unsaved edits: the reset replaces them.
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    pendingSaveRef.current = null;
    setDraft(null);
    setEditError(null);
    void run(async () => {
      await apiService.resetLayout(selected.id);
    });
  };

  const commitName = (name: string) => {
    if (!selected || selected.fixed || name === selected.name) return;
    void run(async () => {
      await apiService.updateLayout(selected.id, { name });
    });
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const sourceIndex =
      draggedIdxRef.current ??
      parseInt(e.dataTransfer.getData("text/plain"), 10);
    draggedIdxRef.current = null;
    setDragOverIdx(null);
    const ids = moveLayoutIds(layouts, sourceIndex, targetIndex);
    if (!ids) return;
    const byId = new Map(layouts.map((layout) => [layout.id, layout]));
    setLayouts(ids.map((id) => byId.get(id)!));
    void run(async () => {
      await apiService.reorderLayouts(ids);
    });
  };

  if (loading) {
    return (
      <div
        className="view-container loading-state"
        id="config-tab-panel"
        role="tabpanel"
        aria-labelledby="config-tab-meteogram"
        data-testid="config-tab-panel-meteogram"
      >
        <div className="spinner" />
        <p>Loading meteogram configurations...</p>
      </div>
    );
  }

  const deletable = selected ? canDeleteLayout(layouts, selected.id) : false;

  return (
    <div
      className="config-view meteogram-layouts-panel"
      id="config-tab-panel"
      role="tabpanel"
      aria-labelledby="config-tab-meteogram"
      data-testid="config-tab-panel-meteogram"
    >
      <div className="config-sidebar card">
        <div className="sidebar-header">
          <button
            type="button"
            className="btn btn-secondary btn-icon-only layout-delete-btn"
            onClick={handleDelete}
            disabled={!deletable}
            aria-label="Delete selected meteogram configuration"
            title={
              selected?.fixed
                ? "The Normal mode entry cannot be deleted"
                : deletable
                  ? "Delete selected meteogram configuration"
                  : "The last power mode layout cannot be deleted"
            }
          >
            <Trash2 size={16} />
          </button>
          <div className="sidebar-header-actions">
            <button
              type="button"
              className="btn btn-secondary btn-icon-only layout-duplicate-btn"
              onClick={handleDuplicate}
              disabled={!selected}
              aria-label="Duplicate selected meteogram configuration"
              title="Duplicate selected meteogram configuration"
            >
              <Copy size={16} />
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm layout-add-btn"
              onClick={handleCreate}
              aria-label="Create new meteogram configuration"
              title="Create new meteogram configuration"
            >
              +
            </button>
          </div>
        </div>

        <div
          className="config-list"
          data-has-multiple={layouts.length >= 2}
          data-testid="layout-list"
        >
          {layouts.map((layout, idx) => {
            const isSelected = layout.id === selectedId;
            return (
              <div
                key={layout.id}
                className={`config-item-card ${isSelected ? "active" : ""} ${dragOverIdx === idx ? "drag-over" : ""}`}
                data-testid={`layout-item-${layout.id}`}
                onClick={() => selectLayout(layout.id)}
                onDragOver={(e) => {
                  if (idx === 0) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragOverIdx !== idx) setDragOverIdx(idx);
                }}
                onDragLeave={() => setDragOverIdx(null)}
                onDrop={(e) => handleDrop(e, idx)}
              >
                <div className="config-item-content">
                  {layout.fixed ? (
                    <div
                      className="config-drag-handle layout-fixed-icon"
                      title="Always first"
                      aria-label="Always first"
                    >
                      <Lock size={14} />
                    </div>
                  ) : (
                    <div
                      className="config-drag-handle"
                      draggable
                      onDragStart={(e) => {
                        draggedIdxRef.current = idx;
                        e.dataTransfer.setData("text/plain", String(idx));
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        draggedIdxRef.current = null;
                        setDragOverIdx(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      title="Drag to reorder"
                      aria-label="Drag to reorder"
                    >
                      <GripVertical size={16} />
                    </div>
                  )}
                  <div className="config-item-text">
                    <div className="config-item-title">{layout.name}</div>
                    <div className="config-item-sub">
                      {layout.fixed
                        ? "Normal mode, Auto and configurations without a layout"
                        : `${configs.filter((c) => c.layout_id === layout.id).length} configurations`}
                      {layout.error ? " • invalid" : ""}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="config-editor-main">
        <div className="editor-card card layout-detail-card">
          {error && (
            <div className="layout-error" role="alert">
              {error}
            </div>
          )}
          {selected && (
            <>
              <div className="form-group">
                <label className="form-label" htmlFor="layout-name-input">
                  Meteogram configuration name
                </label>
                <LayoutNameInput
                  key={`${selected.id}:${selected.name}`}
                  name={selected.name}
                  disabled={selected.fixed}
                  onCommit={commitName}
                />
              </div>
              <p className="layout-note">
                {selected.fixed
                  ? "Drawn in normal mode, for the Auto entry and for every model chain configuration without its own layout. Power mode always adds the model headers. It cannot be renamed or deleted."
                  : "Choose it for a model chain configuration in the Model chains tab."}
              </p>
              {selected.error && (
                <p className="layout-warning" role="alert">
                  This stored layout is invalid and is drawn as the built-in
                  default: {selected.error}
                </p>
              )}
              <div className="layout-actions">
                {selected.builtin_id && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm layout-reset-btn"
                    onClick={handleReset}
                  >
                    <RotateCcw size={14} /> Reset to default
                  </button>
                )}
              </div>
              {editError && (
                <p
                  className="layout-error"
                  role="alert"
                  data-testid="layout-edit-error"
                >
                  Not saved: {editError}
                </p>
              )}
              {editedLayout && renderPreview && (
                <div className="layout-preview" data-testid="layout-preview">
                  {renderPreview(editedLayout, getEntryFallbackId(selected))}
                </div>
              )}
              {editedLayout && (
                <LayoutEditor
                  key={selected.id}
                  layout={editedLayout}
                  onChange={handleLayoutEdit}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
