// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
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

/** Tightest level of `data-fit` (Tabs.css, REQ-780): the lower bound of spacing and font; beyond it the bar scrolls. */
export const TAB_FIT_LEVELS = 5;

/**
 * Fits the tabs of `bar` in one row (REQ-780): from the roomiest level of `data-fit` (none) on, each level a little
 * tighter, until the tabs fit or the tightest level is reached (then the bar scrolls sideways). Returns the level.
 */
export function fitTabBar(bar: HTMLElement): number {
  let level = 0;
  delete bar.dataset.fit;
  while (bar.scrollWidth > bar.clientWidth && level < TAB_FIT_LEVELS) {
    level += 1;
    bar.dataset.fit = String(level);
  }
  return level;
}

/** Scrolls `bar` sideways, and only the bar (never the dialog or the page, as `scrollIntoView` would), to show `tab`. */
export function scrollTabIntoView(bar: HTMLElement, tab: HTMLElement) {
  if (bar.scrollWidth <= bar.clientWidth) return;
  const tabBox = tab.getBoundingClientRect();
  const barBox = bar.getBoundingClientRect();
  if (tabBox.left < barBox.left) bar.scrollLeft -= barBox.left - tabBox.left;
  else if (tabBox.right > barBox.right) bar.scrollLeft += tabBox.right - barBox.right;
}

/**
 * Scrolls everything that holds `panel` back to its top, up to the page (REQ-854): the panel itself and each of its
 * scrolling ancestors (a dialog's body). A tab chosen after scrolling far down in a longer one starts at its top, and a
 * shorter one is never left out of sight above. Sideways scrolling and the page itself stay as they are.
 */
export function scrollPanelToTop(panel: HTMLElement) {
  const page = panel.ownerDocument;
  for (let element: HTMLElement | null = panel; element; element = element.parentElement) {
    if (element === page.body || element === page.documentElement) return;
    if (element.scrollTop !== 0) element.scrollTop = 0;
  }
}

/** Fits the tabs of `bar` (`fitTabBar`) and keeps its selected tab in view. */
function refitTabBar(bar: HTMLElement) {
  fitTabBar(bar);
  const selected = bar.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  if (selected) scrollTabIntoView(bar, selected);
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
 * Tab order; the arrow keys, Home and End move between the tabs and select them, Tab moves on into the panel. The tabs
 * stay in one row (REQ-780): where they do not fit, spacing and font get smaller down to a lower bound (`fitTabBar`),
 * then the bar scrolls sideways and a tab selected out of sight is scrolled into view (REQ-686). A newly selected tab
 * shows its panel from the top (REQ-854); the selected tab is marked by its underline only, never a frame (REQ-859).
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

  const bar = useRef<HTMLDivElement>(null);

  // After a render that changed the labels (language, the domain's imprint label) or the selected tab (bold): not on
  // every render, so a bar swiped aside stays where it is while the popup's content changes.
  const fitted = useRef("");
  useLayoutEffect(() => {
    const element = bar.current;
    if (!element) return;
    const key = `${selected}\n${element.textContent}`;
    if (key === fitted.current) return;
    fitted.current = key;
    refitTabBar(element);
  });

  // A newly selected tab starts at its top (REQ-854), whoever selected it (a tab, a key, the popup's opener); after
  // the commit that showed its panel, before it is painted. Not when the bar first shows: the popup opens at its top.
  const shownTab = useRef(selected);
  useLayoutEffect(() => {
    if (shownTab.current === selected) return;
    shownTab.current = selected;
    const panel = bar.current?.ownerDocument.getElementById(tabPanelId(baseId, selected));
    if (panel) scrollPanelToTop(panel);
  }, [selected, baseId]);

  // When the bar or a tab changes size (the window, a late web font), in the next frame: fitting changes the sizes the
  // observer reports, which inside its callback would end in a loop error.
  const tabKey = tabs.join("\n");
  useEffect(() => {
    const element = bar.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => refitTabBar(element));
    });
    observer.observe(element);
    for (const tab of element.children) observer.observe(tab);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [tabKey]);

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
      ref={bar}
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
