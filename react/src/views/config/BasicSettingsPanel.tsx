import React, { useCallback, useEffect, useState } from "react";
import { ExternalLink, FolderOpen } from "lucide-react";
import type {
  AppSettings,
  ArchiveStats,
  DataDirCopyParts,
  DataDirInfo,
} from "../../types";
import { apiService } from "../../services/apiService";
import {
  RETENTION_OPTIONS,
  formatArchiveStats,
  getRetentionChoice,
  needsDisableConfirmation,
  settingsForRetention,
  type RetentionChoice,
} from "./basicSettings.logic";

export interface BasicSettingsPanelProps {
  /** Called after the app switched to a new data folder. */
  onDataDirChanged?: () => void;
}

type BasicState = [AppSettings, DataDirInfo | null, ArchiveStats | null];

function fetchBasicState(): Promise<BasicState> {
  return Promise.all([
    apiService.getSettings(),
    apiService.getDataDir(),
    apiService.getArchiveStats(),
  ]);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const SettingSwitch: React.FC<{
  id: string;
  checked: boolean;
  label: string;
  description: string;
  onChange: (checked: boolean) => void;
}> = ({ id, checked, label, description, onChange }) => (
  <div className="settings-switch-row">
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-describedby={`${id}-description`}
      className={`settings-switch ${checked ? "active" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-switch-track" aria-hidden="true" />
      <span className="settings-switch-label">{label}</span>
    </button>
    <p id={`${id}-description`} className="settings-note">
      {description}
    </p>
  </div>
);

/** Modal with OK / Cancel; Escape cancels without leaving the Config view. */
const SettingsDialog: React.FC<{
  id: string;
  title: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}> = ({ id, title, confirmLabel, busy, onConfirm, onCancel, children }) => (
  <div className="settings-dialog-backdrop">
    <div
      className="card settings-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      data-testid={id}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          if (!busy) onCancel();
        }
      }}
    >
      <h3 id={`${id}-title`} className="settings-dialog-title">
        {title}
      </h3>
      {children}
      <div className="layout-actions settings-dialog-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onCancel}
          disabled={busy}
          autoFocus
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={onConfirm}
          disabled={busy}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
);

/**
 * Config → Basic tab (system.md §7, §8.2, §9.3, #140): data folder with a live
 * switch to a new folder, and the forecast archive retention with its size.
 */
export const BasicSettingsPanel: React.FC<BasicSettingsPanelProps> = ({
  onDataDirChanged,
}) => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [dataDir, setDataDir] = useState<DataDirInfo | null>(null);
  const [stats, setStats] = useState<ArchiveStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingFolder, setPendingFolder] = useState<string | null>(null);
  const [copyParts, setCopyParts] = useState<DataDirCopyParts>({
    configuration: true,
    meteogram: true,
  });
  const [pendingDisable, setPendingDisable] = useState(false);
  const [deleteArchived, setDeleteArchived] = useState(false);

  const applyState = useCallback(
    ([nextSettings, nextDataDir, nextStats]: BasicState) => {
      setSettings(nextSettings);
      setDataDir(nextDataDir);
      setStats(nextStats);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    fetchBasicState()
      .then((state) => {
        if (!cancelled) applyState(state);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [applyState]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const handleChooseFolder = () =>
    run(async () => {
      const folder = await apiService.chooseDataDir();
      if (!folder) return;
      setCopyParts({ configuration: true, meteogram: true });
      setPendingFolder(folder);
    });

  const handleOpenFolder = () => run(() => apiService.openDataDir());

  const handleConfirmFolder = () =>
    run(async () => {
      if (!pendingFolder) return;
      try {
        await apiService.changeDataDir(pendingFolder, copyParts);
      } finally {
        setPendingFolder(null);
      }
      applyState(await fetchBasicState());
      onDataDirChanged?.();
    });

  const retention = settings ? getRetentionChoice(settings) : "off";

  const storeRetention = async (choice: RetentionChoice) => {
    setSettings(await apiService.updateSettings(settingsForRetention(choice)));
    setStats(await apiService.getArchiveStats());
  };

  const handleRetentionChange = (choice: RetentionChoice) => {
    if (choice === retention) return;
    if (needsDisableConfirmation(retention, choice)) {
      setDeleteArchived(false);
      setPendingDisable(true);
      return;
    }
    void run(() => storeRetention(choice));
  };

  const handleConfirmDisable = () =>
    run(async () => {
      try {
        if (deleteArchived) await apiService.deleteArchive();
        await storeRetention("off");
      } finally {
        setPendingDisable(false);
      }
    });

  return (
    <div
      className="basic-settings-panel"
      id="config-tab-panel"
      role="tabpanel"
      aria-labelledby="config-tab-basic"
      data-testid="config-tab-panel-basic"
    >
      {error && (
        <p className="layout-error" role="alert">
          {error}
        </p>
      )}

      <section
        className="card layout-detail-card"
        aria-labelledby="data-folder-title"
      >
        <h3 id="data-folder-title" className="layout-section-title">
          Data folder
        </h3>
        {dataDir ? (
          <>
            <p className="settings-path" data-testid="data-dir-path">
              {dataDir.data_dir}
            </p>
            <p className="settings-note">
              {dataDir.is_default
                ? "Default folder of this computer."
                : `Default folder: ${dataDir.default_data_dir}`}{" "}
              Holds the database with configurations, settings and the forecast
              archive.
            </p>
            <div className="layout-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleChooseFolder}
                disabled={busy}
              >
                <FolderOpen size={14} />
                Choose folder…
              </button>
              {apiService.canOpenDataDir() && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleOpenFolder}
                  disabled={busy}
                  title="Show the data folder in the file manager"
                >
                  <ExternalLink size={14} />
                  Open folder
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="settings-note">
            The data folder can only be changed in the desktop app.
          </p>
        )}
      </section>

      <section
        className="card layout-detail-card"
        aria-labelledby="archive-title"
      >
        <h3 id="archive-title" className="layout-section-title">
          Forecast archive
        </h3>
        <label className="settings-field" htmlFor="archive-retention-select">
          <span>Keep archived forecasts</span>
          <select
            id="archive-retention-select"
            className="select-input"
            value={retention}
            disabled={!settings || busy}
            onChange={(e) =>
              handleRetentionChange(e.target.value as RetentionChoice)
            }
          >
            {RETENTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="settings-note">
          {retention === "off"
            ? "Off: forecasts are not stored on disk."
            : retention === "forever"
              ? "Every fetched forecast is stored and kept."
              : "Every fetched forecast is stored; older ones are deleted at start and once a day."}
        </p>
        {stats && (
          <p className="settings-note" data-testid="archive-size">
            {formatArchiveStats(stats)}
          </p>
        )}
      </section>

      {pendingFolder && (
        <SettingsDialog
          id="data-dir-dialog"
          title="Use new data folder"
          confirmLabel="Use folder"
          busy={busy}
          onConfirm={handleConfirmFolder}
          onCancel={() => setPendingFolder(null)}
        >
          <p className="settings-path">{pendingFolder}</p>
          <p className="settings-note">
            A new database is created there and the app switches to it at once.
            The current database stays in {dataDir?.data_dir}.
          </p>
          <SettingSwitch
            id="copy-configuration-switch"
            checked={copyParts.configuration}
            label="Configuration data"
            description="Model chain configurations, meteogram configurations, app settings and most-searched locations."
            onChange={(configuration) =>
              setCopyParts((prev) => ({ ...prev, configuration }))
            }
          />
          <SettingSwitch
            id="copy-meteogram-switch"
            checked={copyParts.meteogram}
            label="Meteogram data"
            description="Forecast archive, raw API responses and model run availability."
            onChange={(meteogram) =>
              setCopyParts((prev) => ({ ...prev, meteogram }))
            }
          />
        </SettingsDialog>
      )}

      {pendingDisable && (
        <SettingsDialog
          id="archive-disable-dialog"
          title="Turn off the forecast archive"
          confirmLabel="OK"
          busy={busy}
          onConfirm={handleConfirmDisable}
          onCancel={() => setPendingDisable(false)}
        >
          <p className="settings-note">
            New forecasts are no longer stored. Archived forecasts are kept
            unless you delete them now.
          </p>
          <SettingSwitch
            id="delete-archive-switch"
            checked={deleteArchived}
            label="Delete archived data"
            description="Removes all archived forecasts, raw API responses and run availability."
            onChange={setDeleteArchived}
          />
        </SettingsDialog>
      )}
    </div>
  );
};
