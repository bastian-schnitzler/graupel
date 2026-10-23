import React, { useEffect, useRef, useState } from "react";
import { History } from "lucide-react";
import type { ArchivedFetchSummary, Location } from "../../types";
import { apiService } from "../../services/apiService";
import { formatModelRunTime } from "../modelChain/modelChainBuilderUtils";
import {
  formatArchivedChain,
  formatConfigVersion,
} from "../../utils/historicForecast";

interface HistoryMenuProps {
  /** Meteogram location; fetches within ~1 km are listed. */
  location: Location;
  onSelect: (fetch: ArchivedFetchSummary) => void;
  disabled?: boolean;
}

/**
 * "History" button of the Meteogram view (power mode, system.md §10): lists the
 * archived fetches near the location, newest first.
 */
export const HistoryMenu: React.FC<HistoryMenuProps> = ({
  location,
  onSelect,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [fetches, setFetches] = useState<ArchivedFetchSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handleToggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setFetches(null);
    setError(null);
    const requestId = ++requestIdRef.current;
    apiService
      .listArchivedForecasts(location)
      .then((list) => {
        if (requestIdRef.current === requestId) setFetches(list);
      })
      .catch((e: unknown) => {
        console.error("Failed to list archived forecasts:", e);
        if (requestIdRef.current === requestId) {
          setError("Archived forecasts could not be loaded");
        }
      });
  };

  return (
    <div className="history-menu" ref={containerRef}>
      <button
        type="button"
        className="config-reset-btn history-btn-header"
        onClick={handleToggle}
        disabled={disabled}
        aria-expanded={open}
        title="History: archived forecasts near this location"
        aria-label="History"
        data-testid="history-button"
      >
        <History size={16} />
      </button>
      {open && (
        <div className="history-dropdown" data-testid="history-dropdown">
          {error ? (
            <div className="history-status error">{error}</div>
          ) : fetches === null ? (
            <div className="history-status">Loading archived forecasts…</div>
          ) : fetches.length === 0 ? (
            <div className="history-status" data-testid="history-empty">
              No archived forecasts near this location. The archive is
              switched on in Config → Basic.
            </div>
          ) : (
            <ul className="history-list" role="listbox" aria-label="Archived forecasts">
              {fetches.map((fetch) => {
                const version = formatConfigVersion(fetch.config_version);
                return (
                  <li
                    key={fetch.id}
                    role="option"
                    aria-selected={false}
                    className="history-item"
                    onClick={() => {
                      setOpen(false);
                      onSelect(fetch);
                    }}
                    data-testid={`history-item-${fetch.id}`}
                  >
                    <div className="history-item-title">
                      <strong>{formatModelRunTime(fetch.fetched_at) ?? "?"}</strong>
                      {` · ${formatArchivedChain(fetch)}`}
                    </div>
                    {version && (
                      <div className="history-item-version">{version}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
