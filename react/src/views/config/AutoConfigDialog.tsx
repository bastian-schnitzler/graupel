import React, { useEffect, useMemo, useState } from "react";
import type {
  AutoChainEntry,
  AutoChainInfo,
  Location,
  RegionSummary,
} from "../../types";
import { apiService } from "../../services/apiService";
import {
  CHAIN_PREFIX,
  FROM_LOCATION,
  groupAutoChains,
  groupRegions,
} from "./autoConfigDialog.logic";

export interface AutoConfigDialogProps {
  /** Location of the Meteogram view; "from current location" resolves it. */
  currentLocation: Location;
  /**
   * Creates the configuration; `regionId` null = from current location, or
   * the chains of a chain entry (#198) as `chain`.
   */
  onCreate: (regionId: string | null, chain?: AutoChainInfo) => Promise<void>;
  onCancel: () => void;
}

/** "Start from auto configuration" (system.md §6.5). */
export const AutoConfigDialog: React.FC<AutoConfigDialogProps> = ({
  currentLocation,
  onCreate,
  onCancel,
}) => {
  const [regions, setRegions] = useState<RegionSummary[]>([]);
  const [chains, setChains] = useState<AutoChainEntry[]>([]);
  const [choice, setChoice] = useState<string>(FROM_LOCATION);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiService
      .listRegions()
      .then((list) => {
        if (active) setRegions(list);
      })
      .catch((e) => console.error("Failed to load regions:", e));
    apiService
      .listAutoChains()
      .then((list) => {
        if (active) setChains(list);
      })
      .catch((e) => console.error("Failed to load auto chains:", e));
    return () => {
      active = false;
    };
  }, []);

  const groups = useMemo(() => groupRegions(regions), [regions]);
  const chainGroups = useMemo(() => groupAutoChains(chains), [chains]);

  const handleCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      if (choice.startsWith(CHAIN_PREFIX)) {
        const id = choice.slice(CHAIN_PREFIX.length);
        const chain = chains.find((entry) => entry.id === id);
        if (!chain) throw new Error(`Unknown chain ${id}`);
        await onCreate(null, chain);
      } else {
        await onCreate(choice === FROM_LOCATION ? null : choice);
      }
    } catch (e) {
      console.error("Failed to create auto configuration:", e);
      setError("Could not create the configuration.");
      setBusy(false);
    }
  };

  return (
    <div className="settings-dialog-backdrop">
      <div
        className="card settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auto-config-dialog-title"
        data-testid="auto-config-dialog"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            if (!busy) onCancel();
          }
        }}
      >
        <h3 id="auto-config-dialog-title" className="settings-dialog-title">
          Start from auto configuration
        </h3>
        <p className="settings-note">
          Creates a new configuration with the main and cloud chain normal mode
          uses for a region or another area. Its location is the current
          location.
        </p>
        <select
          className="select-input"
          aria-label="Region"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          disabled={busy}
          autoFocus
        >
          <option value={FROM_LOCATION}>
            From current location ({currentLocation.name})
          </option>
          {groups.map(({ group, regions: list }) => (
            <optgroup key={group} label={group}>
              {list.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </optgroup>
          ))}
          {chainGroups.map(({ group, entries }) => (
            <optgroup key={group} label={group}>
              {entries.map((entry) => (
                <option key={entry.value} value={entry.value} title={entry.title}>
                  {entry.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {error && (
          <p className="layout-error" role="alert">
            {error}
          </p>
        )}
        <div className="layout-actions settings-dialog-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleCreate}
            disabled={busy}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
};
