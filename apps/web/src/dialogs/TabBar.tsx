// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import "./Tabs.css";

/** Id of the tab button `id` in a tab bar with the base id `baseId`. */
export const tabId = (baseId: string, id: string) => `${baseId}-tab-${id}`;

/** Id of the panel of the tab `id` in a tab bar with the base id `baseId`. */
export const tabPanelId = (baseId: string, id: string) => `${baseId}-panel-${id}`;

/**
 * Tab the keys of the WAI-ARIA tabs pattern move to from the tab at `index` of `count` tabs: the arrow keys to the next
 * or previous one (wrapping around), Home and End to the first and last; `undefined` for other keys.
 */
export function tabKeyTarget(key: string, index: number, count: number): number | undefined {
  const last = count - 1;
  switch (key) {
    case "ArrowRight":
      return index >= last ? 0 : index + 1;
    case "ArrowLeft":
      return index <= 0 ? last : index - 1;
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return undefined;
  }
}

export interface TabBarProps<T extends string> {
  /** The tabs, in display order. */
  tabs: readonly T[];
  selected: T;
  onSelect: (tab: T) => void;
  /** Accessible name of the tab list. */
  label: string;
  /** Base of the ids of the tabs and their panels (`tabId`, `tabPanelId`). */
  baseId: string;
  /** Text (or content) of a tab. */
  renderLabel: (tab: T) => ReactNode;
  /** Further class of the tab list, besides `tabs`. */
  className?: string;
  /** Gets the button of the selected tab (e.g. to focus it when the dialog opens). */
  selectedRef?: { current: HTMLButtonElement | null };
}

/**
 * Tab list of the WAI-ARIA tabs pattern (info popup REQ-434, settings popup REQ-686): only the selected tab is in the
 * Tab order; the arrow keys, Home and End move between the tabs and select them, Tab moves on into the panel. A tab
 * selected out of sight in a bar that scrolls sideways (settings on a phone, REQ-686) is scrolled into view.
 */
export function TabBar<T extends string>({
  tabs,
  selected,
  onSelect,
  label,
  baseId,
  renderLabel,
  className,
  selectedRef,
}: TabBarProps<T>) {
  const buttons = useRef<Partial<Record<string, HTMLButtonElement | null>>>({});

  useLayoutEffect(() => {
    const button = buttons.current[selected];
    const bar = button?.parentElement;
    if (!button || !bar || bar.scrollWidth <= bar.clientWidth) return;
    // Only the bar scrolls, never the dialog or the page (as `scrollIntoView` would).
    const tabBox = button.getBoundingClientRect();
    const barBox = bar.getBoundingClientRect();
    if (tabBox.left < barBox.left) bar.scrollLeft -= barBox.left - tabBox.left;
    else if (tabBox.right > barBox.right) bar.scrollLeft += tabBox.right - barBox.right;
  }, [selected]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = tabKeyTarget(event.key, tabs.indexOf(selected), tabs.length);
    if (target === undefined) return;
    event.preventDefault();
    const next = tabs[target];
    if (next === undefined) return;
    buttons.current[next]?.focus();
    onSelect(next);
  }

  return (
    <div
      className={className ? `tabs ${className}` : "tabs"}
      role="tablist"
      aria-label={label}
      onKeyDown={handleKeyDown}
    >
      {tabs.map((id) => {
        const isSelected = id === selected;
        return (
          <button
            key={id}
            ref={(el) => {
              buttons.current[id] = el;
              if (isSelected && selectedRef) selectedRef.current = el;
            }}
            type="button"
            role="tab"
            id={tabId(baseId, id)}
            className="tabs__tab"
            aria-selected={isSelected}
            aria-controls={tabPanelId(baseId, id)}
            tabIndex={isSelected ? 0 : -1}
            data-tab={id}
            onClick={() => onSelect(id)}
          >
            {renderLabel(id)}
          </button>
        );
      })}
    </div>
  );
}
