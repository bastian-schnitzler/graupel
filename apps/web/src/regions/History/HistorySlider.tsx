// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useMemo, useState, type CSSProperties } from "react";
import { useI18n, useT } from "../../i18n/index.ts";
import { usePhone } from "../../state/phoneLandscape.ts";
import {
  HISTORY_SLIDER_DAYS,
  deviceTimeZone,
  historyDays,
  markedHistoryDay,
  useHistory,
  useHistorySlider,
} from "../../state/index.ts";
import { withoutTrailingDot } from "../DaySlider/dayNumbers.ts";
import { weekdayLettersFormat } from "../DaySlider/weekdayLetters.ts";
import { formatFetchTime } from "./format.ts";
import "./HistorySlider.css";

/**
 * The phone's history slider (REQ-685): shown only on a phone, with the setting switched on (REQ-686, archive tab), in
 * the installed app and once the place has earlier fetches (REQ-684). A strip like the phone's day slider with
 * `HISTORY_SLIDER_DAYS` equal fields: today on the very right, standing for the current values, before it the earlier
 * days with archived fetches, each once (at most the last 15). With fewer days the strip still spans the whole width
 * and only the fields next to today are filled. There are no grips: a tap on a day shows that day's last fetch, a tap
 * on today the current values, each with the scroll rule of the history menu (`useHistory`). Exactly one day is
 * marked, in purple so it stands apart from the day slider's selection: the day of the fetch shown; today is gold.
 * It stands directly above the day slider.
 */
export function HistorySlider() {
  const phone = usePhone();
  const enabled = useHistorySlider();
  const history = useHistory();
  if (!phone || !enabled || !history.available || history.fetches.length === 0) return null;
  // Built anew with each fetch (the fetch shown before becomes the newest earlier one), so today follows the clock.
  return <HistoryStrip key={history.fetches[0]?.id} />;
}

function HistoryStrip() {
  const t = useT();
  const { locale } = useI18n();
  const { fetches, shown, show, showCurrent } = useHistory();
  const [timeZone] = useState(deviceTimeZone);
  const [now] = useState(() => Date.now());
  const days = useMemo(() => historyDays(fetches, now, timeZone), [fetches, now, timeZone]);
  const marked = markedHistoryDay(days, shown, timeZone);
  const labels = useMemo(() => {
    const weekday = weekdayLettersFormat(locale, timeZone);
    const dayOfMonth = new Intl.DateTimeFormat(locale, { day: "numeric", timeZone });
    const full = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone });
    return days.map((day) => ({
      weekday: weekday(day.time),
      // Without a dot in every language, as on the day slider (REQ-629).
      day: withoutTrailingDot(dayOfMonth.format(day.time)),
      label: `${full.format(day.time)}: ${
        day.fetch ? t("history.shown", { time: formatFetchTime(day.fetch.fetchedAt, locale) }) : t("history.current")
      }`,
    }));
  }, [days, locale, timeZone, t]);
  // The days stand at the right end, today last; the fields before them stay empty.
  const offset = HISTORY_SLIDER_DAYS - days.length;
  return (
    <section className="history-slider" data-testid="history-slider" aria-label={t("history.slider")}>
      <div
        className="history-slider__track"
        role="group"
        aria-label={t("history.slider")}
        style={{ "--history-fields": HISTORY_SLIDER_DAYS } as CSSProperties}
      >
        {days.map((day, index) => {
          const today = day.fetch === null;
          const isMarked = index === marked;
          return (
            <button
              key={day.key}
              type="button"
              className={[
                "history-day",
                today && "history-day--today",
                isMarked && "history-day--marked",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ gridColumn: offset + index + 1 }}
              aria-pressed={isMarked}
              aria-current={today ? "date" : undefined}
              aria-label={labels[index]?.label}
              data-testid="history-slider-day"
              data-day={day.key}
              onClick={() => {
                if (!day.fetch) showCurrent();
                else if (shown?.id !== day.fetch.id) void show(day.fetch.id);
              }}
            >
              <span className="history-day__weekday">{labels[index]?.weekday}</span>
              <span className="history-day__date">{labels[index]?.day}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
