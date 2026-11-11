// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The choice of the history (REQ-684), the same in the desktop's clock menu and the phone's dialog: first the current
 * values, named by the date and time of their fetch in gold with a gold bar at the side (REQ-727; "current values"
 * only before the first fetch), then the earlier fetches of the place by date and time, at most 10 directly, the older
 * ones in fold-outs per month of this year and per year with fold-outs per month (`groupHistory`). Once the current
 * values are more than 20 minutes old (REQ-757) there is no gold entry: their fetch stands among the earlier ones,
 * without gold, and still chooses the current values. The fetch shown and the fold-outs holding it are marked and
 * open. Arrow up and down, Home and End move between the entries shown; arrow right opens a fold-out, arrow left closes
 * it or goes to the one holding the entry.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useI18n } from "../../i18n/index.ts";
import { ChevronRightIcon } from "../../icons/index.ts";
import type { ArchivedFetchInfo } from "../../services/fetchArchive.ts";
import { groupHistory, type HistoryNode } from "../../state/index.ts";
import { formatFetchTime, formatMonth } from "./format.ts";
import "./History.css";

export interface HistoryListProps {
  /** Earlier fetches of the place. */
  fetches: readonly ArchivedFetchInfo[];
  /** The fetch shown; `null`: the current values. */
  shown: ArchivedFetchInfo | null;
  /** Time the current values were fetched (REQ-727); without it the entry says "current values". */
  currentFetchedAt?: number | null;
  /** Whether the current values still count as current (REQ-757); otherwise they stand among the earlier fetches. */
  currentLive?: boolean;
  onShow: (fetch: ArchivedFetchInfo) => void;
  onCurrent: () => void;
  /** Focuses the marked entry when shown (a menu just opened). */
  autoFocus?: boolean;
  /** Time the months and years count from (tests); default now. */
  now?: number;
}

/** Id of the entry for current values older than 20 minutes among the earlier fetches (REQ-757); no archive id. */
const CURRENT_ID = "current";

const groupKey = (node: Exclude<HistoryNode, { kind: "fetch" }>) =>
  node.kind === "year" ? `${node.year}` : `${node.year}-${node.month}`;

/** Keys of the fold-outs on the way to the fetch `id`. */
function pathTo(nodes: readonly HistoryNode[], id: string): string[] | null {
  for (const node of nodes) {
    if (node.kind === "fetch") {
      if (node.fetch.id === id) return [];
      continue;
    }
    const inner = pathTo(node.children, id);
    if (inner) return [groupKey(node), ...inner];
  }
  return null;
}

/** The entries of the list that can be reached (not inside a closed fold-out). */
const reachable = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].filter((button) => !button.closest("[hidden]"));

export function HistoryList({
  fetches,
  shown,
  currentFetchedAt = null,
  currentLive = true,
  onShow,
  onCurrent,
  autoFocus = false,
  now,
}: HistoryListProps) {
  const { t, locale } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  // Months and years count from the moment the list opened.
  const [openedAt] = useState(() => now ?? Date.now());
  // Current values older than 20 minutes stand among the earlier fetches (REQ-757).
  const staleCurrent = useMemo<ArchivedFetchInfo | null>(
    () =>
      currentFetchedAt !== null && !currentLive ? { id: CURRENT_ID, point: "", fetchedAt: currentFetchedAt } : null,
    [currentFetchedAt, currentLive],
  );
  const nodes = useMemo(
    () => groupHistory(staleCurrent ? [staleCurrent, ...fetches] : fetches, openedAt),
    [staleCurrent, fetches, openedAt],
  );
  const currentYear = new Date(openedAt).getFullYear();
  // Fold-outs open: those holding the fetch shown, then whatever is opened.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(shown ? (pathTo(nodes, shown.id) ?? []) : []));

  useEffect(() => {
    if (!autoFocus || !root.current) return;
    const marked = root.current.querySelector<HTMLButtonElement>('button[aria-current="true"]');
    (marked ?? reachable(root.current)[0])?.focus({ preventScroll: true });
    marked?.scrollIntoView?.({ block: "nearest" });
  }, [autoFocus]);

  const toggle = (key: string, next?: boolean) =>
    setOpen((current) => {
      const opened = new Set(current);
      if (next ?? !opened.has(key)) opened.add(key);
      else opened.delete(key);
      return opened;
    });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!root.current || !(event.target instanceof HTMLButtonElement)) return;
    const buttons = reachable(root.current);
    const index = buttons.indexOf(event.target);
    const key = event.target.dataset.group;
    let target: HTMLButtonElement | undefined;
    if (event.key === "ArrowDown") target = buttons[(index + 1) % buttons.length];
    else if (event.key === "ArrowUp") target = buttons[(index - 1 + buttons.length) % buttons.length];
    else if (event.key === "Home") target = buttons[0];
    else if (event.key === "End") target = buttons.at(-1);
    else if (event.key === "ArrowRight" && key !== undefined) {
      event.preventDefault();
      toggle(key, true);
      return;
    } else if (event.key === "ArrowLeft") {
      if (key !== undefined && open.has(key)) {
        event.preventDefault();
        toggle(key, false);
        return;
      }
      // To the fold-out holding the entry.
      const list = event.target.closest("li")?.parentElement?.closest("li");
      target = list?.querySelector<HTMLButtonElement>(":scope > button") ?? undefined;
    } else return;
    event.preventDefault();
    target?.focus();
  };

  const render = (node: HistoryNode, inYear: boolean): ReactNode => {
    if (node.kind === "fetch") {
      // The fetch of the current values, no longer current (REQ-757): marked with them, it chooses them.
      const isCurrent = node.fetch.id === CURRENT_ID;
      const current = isCurrent ? shown === null : shown?.id === node.fetch.id;
      return (
        <li key={node.fetch.id}>
          <button
            type="button"
            className="history-list__item"
            aria-current={current ? "true" : undefined}
            data-testid="history-fetch"
            onClick={() => (isCurrent ? onCurrent() : onShow(node.fetch))}
          >
            {formatFetchTime(node.fetch.fetchedAt, locale)}
          </button>
        </li>
      );
    }
    const key = groupKey(node);
    const expanded = open.has(key);
    const label =
      node.kind === "year"
        ? String(node.year)
        : formatMonth(node.year, node.month, locale, !inYear && node.year !== currentYear);
    return (
      <li key={key}>
        <button
          type="button"
          className="history-list__item history-list__group"
          aria-expanded={expanded}
          data-group={key}
          data-testid="history-group"
          onClick={() => toggle(key)}
        >
          <ChevronRightIcon className="icon history-list__chevron" />
          {label}
        </button>
        <ul className="history-list__items history-list__items--nested" hidden={!expanded}>
          {node.children.map((child) => render(child, node.kind === "year"))}
        </ul>
      </li>
    );
  };

  // The current values by the date and time of their fetch (REQ-727).
  const currentTime = currentFetchedAt === null ? null : formatFetchTime(currentFetchedAt, locale);

  return (
    <div className="history-list" ref={root} onKeyDown={onKeyDown} data-testid="history-list">
      <ul className="history-list__items">
        {!staleCurrent && (
          <li>
            <button
              type="button"
              className="history-list__item history-list__current"
              aria-current={shown === null ? "true" : undefined}
              data-testid="history-current"
              aria-label={currentTime === null ? undefined : `${t("history.current")}: ${currentTime}`}
              onClick={onCurrent}
            >
              {currentTime ?? t("history.current")}
            </button>
          </li>
        )}
        {!staleCurrent && <li className="history-list__divider" role="separator" />}
        {nodes.map((node) => render(node, false))}
      </ul>
    </div>
  );
}
