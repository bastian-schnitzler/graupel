// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The desktop's history (REQ-684): beside the favourites a split button with a clock, only in the installed app and
 * once the place has an earlier fetch. Beside the clock stands the day and month of the fetch shown (REQ-726), the
 * current values' as well as an archived one's. With the current values the clock is gold, while they are at most 20
 * minutes old (REQ-757); with an archived fetch the main part goes back to the current values. The arrow (and the main
 * part with the current values) opens the choice below it (`HistoryList`). Escape closes it and returns to the arrow,
 * as do a choice, a press beside it and Tab.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../i18n/index.ts";
import { ChevronDownIcon, ClockIcon } from "../../icons/index.ts";
import { useHistory } from "../../state/index.ts";
import { HistoryList } from "./HistoryList.tsx";
import { formatFetchDay, formatFetchTime } from "./format.ts";

export function HistorySplitButton() {
  const { t, locale } = useI18n();
  const history = useHistory();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  if (!history.available || (history.fetches.length === 0 && !history.shown)) return null;
  const { shown, currentFetchedAt, currentLive } = history;
  // The fetch shown: the archived one or the current values (REQ-726).
  const shownAt = shown ? shown.fetchedAt : currentFetchedAt;

  // Opening checks again whether the current values are still current (REQ-757).
  const toggle = () => {
    if (!open) history.checkCurrent();
    setOpen(!open);
  };

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) arrow.current?.focus();
  };

  const mainLabel = shown ? t("history.showCurrent") : t("history.menu");
  const shownLabel = shownAt !== null ? t("history.shown", { time: formatFetchTime(shownAt, locale) }) : null;

  return (
    <div className="split-button location__history" ref={root} data-testid="history-button">
      <button
        type="button"
        className={`button split-button__main location__history-main${
          !shown && currentLive ? " location__history-main--current" : ""
        }`}
        aria-label={shownLabel ? `${shownLabel}. ${mainLabel}` : mainLabel}
        title={shownLabel ? `${shownLabel}\n${mainLabel}` : mainLabel}
        aria-haspopup={shown ? undefined : "true"}
        aria-expanded={shown ? undefined : open}
        aria-controls={shown ? undefined : panelId}
        data-testid="history-main"
        onClick={() => {
          if (shown) history.showCurrent();
          else toggle();
        }}
      >
        <ClockIcon className="icon location__history-clock" width="18" height="18" strokeWidth="1.8" />
        {shownAt !== null && (
          <span className="location__history-day" data-testid="history-day">
            {formatFetchDay(shownAt, locale)}
          </span>
        )}
      </button>
      <button
        ref={arrow}
        type="button"
        className="button split-button__arrow"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t("history.menu")}
        title={t("history.menu")}
        data-testid="history-arrow"
        onClick={toggle}
      >
        <ChevronDownIcon className="icon" width="18" height="18" strokeWidth="1.8" />
      </button>
      <div
        id={panelId}
        className="history-menu"
        role="group"
        aria-label={t("history.title")}
        hidden={!open}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close(true);
          } else if (event.key === "Tab") setOpen(false);
        }}
      >
        {open && (
          <HistoryList
            fetches={history.fetches}
            shown={shown}
            currentFetchedAt={currentFetchedAt}
            currentLive={currentLive}
            autoFocus
            onCurrent={() => {
              close(true);
              history.showCurrent();
            }}
            onShow={(fetch) => {
              close(true);
              void history.show(fetch.id);
            }}
          />
        )}
      </div>
    </div>
  );
}
