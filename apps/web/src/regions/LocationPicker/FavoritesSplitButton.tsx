// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Favourites as a split button (REQ-450): the main part marks or unmarks the current place, the arrow opens a menu
 * of the favourites. Keyboard as in the WAI-ARIA menu button pattern: Enter, Space or arrow down on the arrow opens
 * the menu at the first entry (arrow up at the last), arrows, Home and End move, Escape closes and returns to the
 * arrow, Tab closes.
 * A favourite picked on the map has a pencil on the right of its entry (REQ-489; arrow right reaches it, arrow left
 * goes back, F2 on the entry does the same): it swaps the label for a text field; Enter or leaving the field saves,
 * Escape cancels, an empty name is not taken.
 * The highlight follows the focus, and the pointer moves the focus: over an entry to that entry, over a pencil to that
 * pencil, so no other entry stays highlighted (REQ-508). While a name is being typed the pointer moves nothing.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { Place } from "../../config/index.ts";
import { useT } from "../../i18n/index.ts";
import { isMapPointFavorite, ownName, samePlace, type Favorite } from "../../state/index.ts";
import { Icon } from "./Icon.tsx";

export interface FavoritesSplitButtonProps {
  /** The selected place, marked by the main part and highlighted in the menu. */
  place: Place;
  favorites: readonly Favorite[];
  isFavorite: boolean;
  /** Marks or unmarks `place`. */
  onToggle: () => void;
  /** A favourite was chosen from the menu. */
  onSelect: (favorite: Favorite) => void;
  /** A map-point favourite got a new (trimmed, not empty) name. */
  onRename: (favorite: Favorite, name: string) => void;
  /** Text of a favourite's entry; one without own name is shown by its coordinates (REQ-536). */
  labelOf: (favorite: Favorite) => string;
}

export function FavoritesSplitButton({
  place,
  favorites,
  isFavorite,
  onToggle,
  onSelect,
  onRename,
  labelOf,
}: FavoritesSplitButtonProps) {
  const t = useT();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const pencilRefs = useRef<(HTMLElement | null)[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Index of the favourite being renamed, and the name typed so far.
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  // Read by the blur and pointer handlers, which may run after a re-render has ended the editing.
  const editingRef = useRef<number | null>(null);
  const draftRef = useRef("");
  // Entries of the menu: the favourites, or one disabled entry saying there are none.
  const count = Math.max(favorites.length, 1);

  // The active entry has the focus while the menu is open (roving focus); also again after renaming. A pencil the
  // pointer moved the focus to keeps it.
  useEffect(() => {
    if (!open || editing !== null) return;
    const index = Math.min(active, count - 1);
    if (pencilRefs.current[index] && document.activeElement === pencilRefs.current[index]) return;
    itemRefs.current[index]?.focus();
  }, [open, active, count, editing]);

  /** The pointer is over the entry or the pencil of row `index`: it gets the focus and with it the highlight. */
  const hover = (index: number, target: HTMLElement) => {
    if (editingRef.current !== null) return;
    setActive(index);
    target.focus();
  };

  const startEditing = (index: number) => {
    const favorite = favorites[index];
    if (!favorite) return;
    editingRef.current = index;
    // A point without own name starts with an empty field (REQ-536).
    const name = ownName(favorite) ?? "";
    draftRef.current = name;
    setActive(index);
    setEditing(index);
    setDraft(name);
    setInvalid(false);
  };

  /** Ends the renaming; with `save` a non-empty name is stored (an empty one when leaving the field: cancelled). */
  const finishEditing = (save: boolean) => {
    const index = editingRef.current;
    if (index === null) return;
    const favorite = favorites[index];
    const name = draftRef.current.trim();
    editingRef.current = null;
    setEditing(null);
    setInvalid(false);
    if (save && favorite && name !== "" && name !== favorite.name) onRename(favorite, name);
  };
  const finishRef = useRef(finishEditing);
  useEffect(() => {
    finishRef.current = finishEditing;
  });

  // A press outside saves a running rename and closes the menu.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      finishRef.current(true);
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const openAt = (index: number) => {
    setActive(index);
    setOpen(true);
  };

  const close = (returnFocus: boolean) => {
    finishEditing(true);
    setOpen(false);
    if (returnFocus) arrowRef.current?.focus();
  };

  const onArrowKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openAt(event.key === "ArrowDown" ? 0 : count - 1);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const moves: Record<string, () => number> = {
      ArrowDown: () => (active + 1) % count,
      ArrowUp: () => (active - 1 + count) % count,
      Home: () => 0,
      End: () => count - 1,
    };
    const move = moves[event.key];
    const target = event.target as HTMLElement;
    const row = itemRefs.current.indexOf(target);
    const pencilRow = pencilRefs.current.indexOf(target);
    if (event.key === "ArrowRight" && row >= 0 && pencilRefs.current[row]) {
      event.preventDefault();
      pencilRefs.current[row]?.focus();
    } else if (event.key === "ArrowLeft" && pencilRow >= 0) {
      event.preventDefault();
      itemRefs.current[pencilRow]?.focus();
    } else if (event.key === "F2" && (row >= 0 || pencilRow >= 0) && pencilRefs.current[row >= 0 ? row : pencilRow]) {
      event.preventDefault();
      startEditing(row >= 0 ? row : pencilRow);
    } else if (move) {
      event.preventDefault();
      const next = move();
      setActive(next);
      // From a pencil the focus goes to the entry even when the row stays the same.
      itemRefs.current[next]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  const onEditKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (draftRef.current.trim() === "") setInvalid(true);
      else finishEditing(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finishEditing(false);
    } else if (event.key !== "Tab") {
      // Typing (arrows, Home, End too) stays in the field; Tab leaves it and closes the menu.
      event.stopPropagation();
    }
  };

  const toggleLabel = t(isFavorite ? "location.favorites.remove" : "location.favorites.add", { name: place.name });

  return (
    <div className="split-button location__favorites" ref={rootRef}>
      <button
        type="button"
        className="button split-button__main location__star"
        aria-pressed={isFavorite}
        aria-label={toggleLabel}
        title={toggleLabel}
        onClick={onToggle}
      >
        <Icon name={isFavorite ? "starFilled" : "star"} />
      </button>
      <button
        ref={arrowRef}
        type="button"
        className="button split-button__arrow"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t("location.favorites.menu")}
        title={t("location.favorites.menu")}
        onClick={() => (open ? close(false) : openAt(0))}
        onKeyDown={onArrowKeyDown}
      >
        <Icon name="chevronDown" />
      </button>
      <ul
        id={menuId}
        className="split-button__menu"
        role="menu"
        aria-label={t("location.favorites.title")}
        hidden={!open}
        onKeyDown={onMenuKeyDown}
      >
        {favorites.length === 0 ? (
          <li role="none">
            <span
              ref={(node) => {
                itemRefs.current[0] = node;
              }}
              className="split-button__item split-button__item--empty"
              role="menuitem"
              aria-disabled="true"
              tabIndex={-1}
            >
              {t("location.favorites.empty")}
            </span>
          </li>
        ) : (
          favorites.map((favorite, index) => {
            const mapPoint = isMapPointFavorite(favorite);
            const label = labelOf(favorite);
            return (
              <li key={`${favorite.lat},${favorite.lon}`} role="none" className="split-button__row">
                {editing === index ? (
                  <input
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    className="split-button__rename"
                    type="text"
                    autoFocus
                    spellCheck={false}
                    autoComplete="off"
                    maxLength={80}
                    aria-label={t("location.favorites.nameLabel")}
                    aria-invalid={invalid || undefined}
                    value={draft}
                    onChange={(event) => {
                      draftRef.current = event.target.value;
                      setDraft(event.target.value);
                      if (event.target.value.trim() !== "") setInvalid(false);
                    }}
                    onKeyDown={onEditKeyDown}
                    onBlur={() => finishEditing(true)}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                ) : (
                  <button
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    type="button"
                    className="split-button__item"
                    role="menuitem"
                    tabIndex={-1}
                    aria-current={samePlace(favorite, place) ? "true" : undefined}
                    onMouseEnter={(event) => hover(index, event.currentTarget)}
                    onClick={() => {
                      close(true);
                      onSelect(favorite);
                    }}
                  >
                    {label}
                  </button>
                )}
                {mapPoint && editing !== index && (
                  <button
                    ref={(node) => {
                      pencilRefs.current[index] = node;
                    }}
                    type="button"
                    className="split-button__pencil"
                    role="menuitem"
                    tabIndex={-1}
                    aria-label={t("location.favorites.rename", { name: label })}
                    title={t("location.favorites.rename", { name: label })}
                    onMouseEnter={(event) => hover(index, event.currentTarget)}
                    onClick={() => startEditing(index)}
                  >
                    <Icon name="pencil" />
                  </button>
                )}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
