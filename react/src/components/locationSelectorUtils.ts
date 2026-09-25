/**
 * Utilities for LocationSelector component: keyboard navigation and coordinate formatting.
 */

/**
 * Calculates the next highlighted index when navigating suggestions with arrow keys.
 */
export function calculateNextHighlightedIndex(
  currentIndex: number,
  listLength: number,
  direction: "up" | "down",
): number {
  if (listLength <= 0) return -1;
  if (direction === "down") {
    return currentIndex < listLength - 1 ? currentIndex + 1 : 0;
  }
  return currentIndex > 0 ? currentIndex - 1 : listLength - 1;
}

/**
 * Formats latitude and longitude coordinates with hemisphere indicators and 4 decimal places.
 */
export function formatCoordinates(lat: number, lng: number): string {
  const latStr = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}`;
  const lngStr = `${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? "E" : "W"}`;
  return `${latStr} · ${lngStr}`;
}

/**
 * Resolves effective elevation prioritizing location object metadata over dynamically fetched elevation.
 */
export function getEffectiveElevation(
  locationElevation?: number | null,
  fetchedElevation?: number | null,
): number | undefined {
  if (locationElevation !== undefined && locationElevation !== null) {
    return locationElevation;
  }
  if (fetchedElevation !== null && fetchedElevation !== undefined) {
    return fetchedElevation;
  }
  return undefined;
}

export interface LocationSelectorKeyHandlerParams<T> {
  showDropdown: boolean;
  highlightedIndex: number;
  suggestions: T[];
  searchTerm: string;
  onSelectSuggestion: (item: T) => void;
  onResolveAndSelect: (term: string) => void;
  setShowDropdown: (show: boolean) => void;
  setHighlightedIndex: (index: number | ((prev: number) => number)) => void;
}

/**
 * Handles keyboard navigation (Enter, Escape, ArrowDown, ArrowUp) for LocationSelector.
 */
export function resolveLocationSelectorKeyDown<T>(
  e: { key: string; preventDefault: () => void; stopPropagation: () => void },
  params: LocationSelectorKeyHandlerParams<T>,
): void {
  if (e.key === "Enter") {
    e.preventDefault();
    e.stopPropagation();

    if (
      params.showDropdown &&
      params.highlightedIndex >= 0 &&
      params.highlightedIndex < params.suggestions.length
    ) {
      params.onSelectSuggestion(params.suggestions[params.highlightedIndex]);
    } else if (params.showDropdown && params.suggestions.length > 0) {
      params.onSelectSuggestion(params.suggestions[0]);
    } else {
      void params.onResolveAndSelect(params.searchTerm);
    }
    return;
  }

  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    params.setShowDropdown(false);
    return;
  }

  if (!params.showDropdown) {
    if (e.key === "ArrowDown") {
      params.setShowDropdown(true);
    }
    return;
  }

  if (e.key === "ArrowDown") {
    e.preventDefault();
    params.setHighlightedIndex((prev) =>
      calculateNextHighlightedIndex(prev, params.suggestions.length, "down"),
    );
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    params.setHighlightedIndex((prev) =>
      calculateNextHighlightedIndex(prev, params.suggestions.length, "up"),
    );
  }
}
