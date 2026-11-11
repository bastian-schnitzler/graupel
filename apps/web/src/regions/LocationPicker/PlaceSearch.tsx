// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Search field of the location picker (REQ-433, REQ-455): place search with suggestions, the GPS button inside the field
 * on the left (only on button press, DEC-021) and an X to empty it on the right. Used in the place row and, on the
 * desktop, in the top-left corner of the full-screen map (REQ-641), each with its own state. Errors of the search and
 * the GPS show as cards (REQ-492). While another place's forecast loads, the place row's field on a phone and a tablet
 * shows a turning refresh symbol in place of the GPS symbol (REQ-751).
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { Place } from "../../config/index.ts";
import { useI18n, type MessageKey } from "../../i18n/index.ts";
import { MIN_QUERY_LENGTH, type PlaceSuggestion } from "../../services/geocoding.ts";
import { useErrorNotice, useNotices, type Notice } from "../../state/index.ts";
import type { LocationServices } from "./LocationPicker.tsx";
import { Icon } from "./Icon.tsx";
import { formatElevation, nextIndex } from "./format.ts";

/** Devices with a touch screen, where the field brings up an on-screen keyboard. */
const TOUCH_QUERY = "(pointer: coarse)";

type SearchState = "idle" | "searching" | "done" | "error";

const GPS_ERRORS: Record<number, MessageKey> = {
  1: "location.gps.denied",
  2: "location.gps.unavailable",
  3: "location.gps.timeout",
};

/**
 * The card for an error of the GPS (REQ-492), by the code of the Geolocation API: after a denial with where to allow
 * the position again in this browser (REQ-509). The GPS button and the start with GPS (REQ-760) show the same.
 */
export function gpsErrorNotice(code: number, locationHint: LocationServices["locationHint"]): Notice {
  const message = GPS_ERRORS[code] ?? "location.gps.unavailable";
  if (message !== "location.gps.denied") return { id: "location.gps", message };
  const hint = locationHint();
  return { id: "location.gps", message, detail: hint.key, ...(hint.params ? { params: hint.params } : {}) };
}

export interface PlaceSearchProps {
  /** Name of the shown place; the field shows it until the user types. */
  name: string;
  /**
   * Changes whenever a place is chosen (in the field, from the favourites or on the map): the field then shows `name`
   * again, even when the name stayed the same.
   */
  resetKey: unknown;
  services: Pick<LocationServices, "searchPlaces" | "geolocation" | "locationHint">;
  /** Pause after typing before searching, in milliseconds. */
  searchDelay: number;
  /** A suggestion was chosen. */
  onPick: (place: Place) => void;
  /** The GPS found the current position. */
  onLocate: (place: Place) => void;
  /**
   * The chosen place's forecast loads (REQ-751): a turning refresh symbol instead of the GPS symbol, standing still
   * with `prefers-reduced-motion`. The button keeps its function.
   */
  loading?: boolean;
}

export function PlaceSearch({
  name,
  resetKey,
  services,
  searchDelay,
  onPick,
  onLocate,
  loading = false,
}: PlaceSearchProps) {
  const { t, language, locale } = useI18n();
  const { geolocation, locationHint } = services;

  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  // Search field: shows the place name until the user types; a newly chosen place shows its name again.
  const [query, setQuery] = useState(name);
  const [typing, setTyping] = useState(false);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [shown, setShown] = useState({ name, resetKey });
  if (name !== shown.name || !Object.is(resetKey, shown.resetKey)) {
    const chosen = !Object.is(resetKey, shown.resetKey);
    setShown({ name, resetKey });
    setQuery(name);
    if (chosen) {
      setTyping(false);
      setOpen(false);
      setActive(-1);
      setSuggestions([]);
      setSearchState("idle");
    }
  }

  const [locating, setLocating] = useState(false);
  const { notify, dismiss } = useNotices();

  // The latest search service, read by the effect without re-running it.
  const searchRef = useRef(services.searchPlaces);
  useEffect(() => {
    searchRef.current = services.searchPlaces;
  });

  // Debounced search while typing; a newer query cancels the older one.
  useEffect(() => {
    if (!typing || query.trim().length < MIN_QUERY_LENGTH) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchRef
        .current(query, { language, signal: controller.signal })
        .then((results) => {
          if (controller.signal.aborted) return;
          setSuggestions(results);
          setActive(-1);
          setSearchState("done");
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setSuggestions([]);
          setSearchState("error");
        });
    }, searchDelay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, typing, language, searchDelay]);

  // A failed search shows a card until the next search starts (REQ-492).
  useErrorNotice("location.search", searchState === "error" ? "location.search.error" : null);

  /** Ends the search; the parent shows the chosen place (`name`, `resetKey`). */
  const finish = () => {
    // With an on-screen keyboard the field lets go of the focus, so the keyboard closes (REQ-560).
    if (typeof window.matchMedia === "function" && window.matchMedia(TOUCH_QUERY).matches) inputRef.current?.blur();
    setTyping(false);
    setOpen(false);
    setActive(-1);
    setSuggestions([]);
    setSearchState("idle");
  };

  const pick = (next: Place) => {
    finish();
    onPick(next);
  };

  const onQueryChange = (value: string) => {
    setQuery(value);
    setTyping(true);
    setActive(-1);
    if (value.trim().length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setSearchState("idle");
      setOpen(false);
    } else {
      setSearchState("searching");
      setOpen(true);
    }
  };

  const resetQuery = () => {
    setQuery(name);
    setTyping(false);
    setOpen(false);
    setActive(-1);
  };

  // The X empties the field for a new search; the place stays selected until another one is chosen.
  const clearQuery = () => {
    setQuery("");
    setTyping(true);
    setSuggestions([]);
    setSearchState("idle");
    setOpen(false);
    setActive(-1);
    inputRef.current?.focus();
  };

  // Leaving an empty field shows the selected place again.
  const onBlur = () => {
    setOpen(false);
    if (query.trim() === "") resetQuery();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        if (!open) {
          if (suggestions.length > 0 || searchState !== "idle") setOpen(true);
          return;
        }
        setActive((current) => nextIndex(current, suggestions.length, event.key === "ArrowDown" ? "down" : "up"));
        return;
      }
      case "Enter": {
        if (!typing) return;
        event.preventDefault();
        const choice = suggestions[active >= 0 ? active : 0];
        if (open && choice) pick(choice);
        return;
      }
      case "Escape": {
        // Closes the list, then shows the place again; only then Escape is left to others, such as the full-screen map
        // that closes on it (REQ-641).
        if (open) setOpen(false);
        else if (typing || query !== name) resetQuery();
        else return;
        event.preventDefault();
        return;
      }
    }
  };

  const locate = () => {
    if (!geolocation) {
      notify({ id: "location.gps", message: "location.gps.unsupported" });
      return;
    }
    dismiss("location.gps");
    setLocating(true);
    geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        finish();
        onLocate({
          name: t("location.gps.placeName"),
          lat: Number(position.coords.latitude.toFixed(4)),
          lon: Number(position.coords.longitude.toFixed(4)),
        });
      },
      (error) => {
        setLocating(false);
        notify(gpsErrorNotice(error.code, locationHint));
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
  };

  // A failed search has nothing to list; its message is a card.
  const listOpen = open && typing && searchState !== "error";
  const statusKey: MessageKey | null =
    searchState === "searching"
      ? "location.search.searching"
      : searchState === "done" && suggestions.length === 0
        ? "location.search.noResults"
        : null;
  const activeId = listOpen && active >= 0 && active < suggestions.length ? optionId(active) : undefined;

  const gpsLabel = t(locating ? "location.gps.locating" : "location.gps.button");
  const clearLabel = t("location.search.clear");

  return (
    <div className="location__search">
      <div className="location__field">
        <button
          type="button"
          className="location__field-button location__gps"
          onClick={locate}
          disabled={locating}
          aria-busy={locating}
          aria-label={gpsLabel}
          title={gpsLabel}
          data-loading={loading ? "" : undefined}
        >
          {loading ? <Icon name="refresh" className="location__loading-icon" /> : <Icon name="gps" />}
        </button>
        <label className="visually-hidden" htmlFor={inputId}>
          {t("location.search.label")}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className="location__input"
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-activedescendant={activeId}
          placeholder={t("location.search.placeholder")}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={onBlur}
        />
        {query !== "" && (
          <button
            type="button"
            className="location__field-button location__clear"
            onMouseDown={(event) => event.preventDefault()}
            onClick={clearQuery}
            aria-label={clearLabel}
            title={clearLabel}
          >
            <Icon name="close" />
          </button>
        )}
      </div>
      <div className="location__popup" hidden={!listOpen}>
        {statusKey && (
          <p className="location__status" role="status">
            {t(statusKey)}
          </p>
        )}
        <ul id={listId} className="location__suggestions" role="listbox" aria-label={t("location.search.suggestions")}>
          {searchState === "done" &&
            suggestions.map((suggestion, index) => {
              const region = [suggestion.admin1, suggestion.country].filter(Boolean).join(", ");
              return (
                <li
                  key={`${suggestion.lat},${suggestion.lon},${index}`}
                  id={optionId(index)}
                  className="location__option"
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(suggestion)}
                >
                  <span className="location__option-name">{suggestion.name}</span>
                  {region && <span className="location__option-region">{region}</span>}
                  {suggestion.elevation !== undefined && (
                    <span className="location__option-elevation">{formatElevation(suggestion.elevation, locale, t)}</span>
                  )}
                </li>
              );
            })}
        </ul>
      </div>
    </div>
  );
}
