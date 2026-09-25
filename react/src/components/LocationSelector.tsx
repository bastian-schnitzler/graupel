import React, { useState, useEffect, useRef, useCallback } from "react";
import type { Location } from "../types";
import { apiService } from "../services/apiService";
import { MapPin, X, RefreshCw } from "lucide-react";
import { FullscreenMapPicker } from "./FullscreenMapPicker";
import { HeaderMapPreview } from "./HeaderMapPreview";
import { handleMapAttributionClick } from "../maps/maptoolkit";
import {
  formatCoordinates,
  getEffectiveElevation,
  resolveLocationSelectorKeyDown,
} from "./locationSelectorUtils";

interface LocationSelectorProps {
  location: Location;
  onChange: (newLoc: Location) => void;
  onRefreshForecast?: () => void;
  loading?: boolean;
  currentView?: "meteogram" | "config";
  onNavigateView?: (view: "meteogram" | "config") => void;
  isFullscreenMapOpen?: boolean;
  onFullscreenMapChange?: (isOpen: boolean) => void;
}

export const LocationSelector: React.FC<LocationSelectorProps> = ({
  location,
  onChange,
  onRefreshForecast,
  loading = false,
  currentView = "meteogram",
  onNavigateView,
  isFullscreenMapOpen: propIsFullscreenMapOpen,
  onFullscreenMapChange,
}) => {
  const [searchTerm, setSearchTerm] = useState<string>(location.name || "");
  const [suggestions, setSuggestions] = useState<Location[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState<boolean>(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [fetchedElevation, setFetchedElevation] = useState<number | null>(null);

  const loadTopLocations = useCallback(async () => {
    try {
      const topLocs = await apiService.getMostUsedLocations(10);
      if (topLocs && topLocs.length > 0) {
        setSuggestions(topLocs);
        setHighlightedIndex(-1);
        setShowDropdown(true);
        setSearchError(null);
      } else {
        setSuggestions([]);
        setShowDropdown(false);
      }
    } catch {
      setSuggestions([]);
      setShowDropdown(false);
    }
  }, []);

  useEffect(() => {
    setFetchedElevation(null);
    if (location.elevation !== undefined && location.elevation !== null) {
      return;
    }
    if (
      typeof location.latitude === "number" &&
      typeof location.longitude === "number"
    ) {
      let isMounted = true;
      apiService
        .getElevationForCoords(location.latitude, location.longitude)
        .then((el) => {
          if (isMounted && typeof el === "number") {
            setFetchedElevation(el);
          }
        });
      return () => {
        isMounted = false;
      };
    }
  }, [location.latitude, location.longitude, location.elevation]);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRequestIdRef = useRef<number>(0);
  const isUserTypingRef = useRef<boolean>(false);

  useEffect(() => {
    isUserTypingRef.current = false;
    setSearchTerm(location.name);
  }, [location.name]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (
      !isUserTypingRef.current ||
      !searchTerm ||
      searchTerm.trim().length < 2
    ) {
      setSuggestions([]);
      if (searchTerm && searchTerm.trim().length > 0) {
        setSuggestions([]);
        setShowDropdown(false);
      }
      setIsSearching(false);
      setSearchError(null);
      setShowDropdown(false);
      return;
    }

    const currentRequestId = ++searchRequestIdRef.current;
    setIsSearching(true);
    setSearchError(null);
    setShowDropdown(true);

    const timer = setTimeout(async () => {
      try {
        const results = await apiService.searchLocations(searchTerm);
        if (searchRequestIdRef.current === currentRequestId) {
          setSuggestions(results);
          setHighlightedIndex(-1);
          setShowDropdown(true);
        }
      } catch (e: unknown) {
        if (searchRequestIdRef.current === currentRequestId) {
          setSearchError("Failed to load location suggestions");
          setSuggestions([]);
          setShowDropdown(true);
        }
      } finally {
        if (searchRequestIdRef.current === currentRequestId) {
          setIsSearching(false);
        }
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  const [internalIsFullscreenMapOpen, setInternalIsFullscreenMapOpen] =
    useState<boolean>(false);
  const isFullscreenMapOpen =
    propIsFullscreenMapOpen !== undefined
      ? propIsFullscreenMapOpen
      : internalIsFullscreenMapOpen;

  const setIsFullscreenMapOpen = (open: boolean) => {
    setInternalIsFullscreenMapOpen(open);
    onFullscreenMapChange?.(open);
  };
  const fullscreenMapOriginRef = useRef<"meteogram" | "config">("meteogram");

  // Map listeners retain their opening closure. Keep the displayed
  // location and view current for that listener across React rerenders.
  const displayedMapStateRef = useRef({ location, currentView });
  displayedMapStateRef.current = {
    location: {
      ...location,
      elevation: location.elevation ?? fetchedElevation ?? undefined,
    },
    currentView,
  };
  const fullscreenInitialLocationRef = useRef<Location | null>(null);

  const handleOpenFullscreenMap = () => {
    const displayed = displayedMapStateRef.current;
    const initialLocation = { ...displayed.location };
    fullscreenInitialLocationRef.current = initialLocation;
    fullscreenMapOriginRef.current = displayed.currentView;
    setIsFullscreenMapOpen(true);
  };

  const handleCloseFullscreenMap = () => {
    setIsFullscreenMapOpen(false);
    fullscreenInitialLocationRef.current = null;
    if (onNavigateView) {
      onNavigateView(fullscreenMapOriginRef.current);
    }
  };

  // ESC key listener for Fullscreen Map
  useEffect(() => {
    if (!isFullscreenMapOpen) return;

    const handleFullscreenKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        handleCloseFullscreenMap();
      }
    };

    window.addEventListener("keydown", handleFullscreenKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleFullscreenKeyDown, true);
    };
  }, [isFullscreenMapOpen]);

  const handleSelectSuggestion = (suggestedLoc: Location) => {
    isUserTypingRef.current = false;
    setSearchTerm(suggestedLoc.name);
    setShowDropdown(false);
    setSearchError(null);
    setHighlightedIndex(-1);
    void apiService.recordLocationSelection(suggestedLoc);
    onChange(suggestedLoc);
  };

  const handleResolveAndSelect = async (queryToResolve: string) => {
    if (!queryToResolve || queryToResolve.trim().length === 0) {
      return;
    }
    setIsSearching(true);
    setSearchError(null);
    try {
      const results = await apiService.searchLocations(queryToResolve.trim());
      if (results && results.length > 0) {
        handleSelectSuggestion(results[0]);
      } else {
        setSearchError(`No location found for "${queryToResolve.trim()}"`);
        setShowDropdown(true);
      }
    } catch {
      setSearchError("Location not found.");
      setShowDropdown(true);
    } finally {
      setIsSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    resolveLocationSelectorKeyDown(e, {
      showDropdown,
      highlightedIndex,
      suggestions,
      searchTerm,
      onSelectSuggestion: handleSelectSuggestion,
      onResolveAndSelect: handleResolveAndSelect,
      setShowDropdown,
      setHighlightedIndex,
    });
  };

  const effectiveElevation = getEffectiveElevation(
    location.elevation,
    fetchedElevation,
  );

  return (
    <div
      className="location-selector-widget"
      ref={containerRef}
      onClickCapture={handleMapAttributionClick}
    >
      <div
        className="map-wrapper"
        onClick={handleOpenFullscreenMap}
        style={{ cursor: "pointer" }}
      >
        <HeaderMapPreview
          location={location}
          onOpen={handleOpenFullscreenMap}
        />
      </div>

      {isFullscreenMapOpen && (
        <div
          className="fullscreen-map-modal"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9999,
            backgroundColor: "#000",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <FullscreenMapPicker
            initialLocation={fullscreenInitialLocationRef.current!}
            onCancel={handleCloseFullscreenMap}
            onAccept={(selected) => {
              handleCloseFullscreenMap();
              void apiService.recordLocationSelection(selected);
              onChange(selected);
            }}
          />
        </div>
      )}

      <div className="location-controls-row">
        <div className="search-autocomplete-container">
          <div className="search-input-wrapper">
            <MapPin size={15} className="location-pin-icon search-icon" />
            <input
              ref={inputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => {
                const val = e.target.value;
                setSearchTerm(val);
                if (val.trim().length === 0) {
                  isUserTypingRef.current = false;
                  void loadTopLocations();
                } else {
                  isUserTypingRef.current = true;
                }
              }}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                if (searchTerm.trim().length === 0) {
                  void loadTopLocations();
                } else if (
                  isUserTypingRef.current &&
                  (suggestions.length > 0 || searchError)
                ) {
                  setShowDropdown(true);
                }
              }}
              placeholder="Search location..."
              className="search-input text-input"
              aria-label="Search location"
            />
            {searchTerm && (
              <button
                type="button"
                className="clear-btn"
                onClick={() => {
                  isUserTypingRef.current = false;
                  setSearchTerm("");
                  setSuggestions([]);
                  setShowDropdown(false);
                  setSearchError(null);
                  void loadTopLocations();
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {showDropdown && (
            <ul className="autocomplete-dropdown" role="listbox">
              {isSearching && (
                <li className="dropdown-status">
                  <div className="spinner-inline-static" />
                  <span>Searching locations...</span>
                </li>
              )}

              {!isSearching && searchError && (
                <li className="dropdown-status error">
                  <span>{searchError}</span>
                </li>
              )}

              {!isSearching &&
                !searchError &&
                suggestions.length === 0 &&
                searchTerm.trim().length >= 2 && (
                  <li className="dropdown-status empty">
                    <span>No locations found</span>
                  </li>
                )}

              {!isSearching &&
                !searchError &&
                suggestions.map((loc, idx) => {
                  const isHighlighted = idx === highlightedIndex;
                  const locationSubParts = [loc.admin1, loc.country].filter(
                    Boolean,
                  );
                  return (
                    <li
                      key={`${loc.name}-${loc.latitude}-${loc.longitude}-${idx}`}
                      className={`dropdown-item ${isHighlighted ? "highlighted" : ""}`}
                      onClick={() => handleSelectSuggestion(loc)}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      role="option"
                      aria-selected={isHighlighted}
                    >
                      <div className="item-details">
                        <div className="item-title">
                          <strong>{loc.name}</strong>
                          {locationSubParts.length > 0 && (
                            <span> · {locationSubParts.join(", ")}</span>
                          )}
                        </div>
                        <div className="item-elevation">
                          {loc.elevation !== undefined && loc.elevation !== null
                            ? `${Math.round(loc.elevation)} m a.s.l.`
                            : "Elevation unavailable"}
                        </div>
                      </div>
                    </li>
                  );
                })}
            </ul>
          )}
        </div>

        {onRefreshForecast && (
          <button
            type="button"
            className="btn btn-primary refresh-forecast-btn"
            disabled={loading}
            onClick={onRefreshForecast}
            title="Refresh Forecast"
            aria-label="Refresh Forecast"
          >
            <RefreshCw size={15} className={loading ? "spinning" : ""} />
          </button>
        )}
      </div>

      <div className="coords-elevation-display">
        <span className="elevation-text">
          {effectiveElevation !== undefined && effectiveElevation !== null
            ? `${Math.round(effectiveElevation)} m a.s.l.`
            : "Elevation unavailable"}
        </span>
        <span className="coords-text">
          {formatCoordinates(location.latitude, location.longitude)}
        </span>
      </div>
    </div>
  );
};
