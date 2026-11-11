// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Runs and horizon of a model for its info popover (REQ-687): the
 * line "Max (from now)" (hours left from now / catalogue horizon), the main run(s) and the ensemble run listed
 * separately, and the explanation of the horizon below them. Taken from the run availability of the loaded forecast
 * (`ForecastResult.availability` of `@graupel/download`); without a loaded forecast there is none of it.
 */
import type { EnsembleRunInfo, ModelAvailability, RunSegment } from "@graupel/download";
import type { Translate } from "../../../i18n/index.ts";

const HOUR_MS = 3_600_000;
/** Ensemble metadata whose newest run started this long before the main run is stuck. */
const STALE_ENSEMBLE_AFTER_MS = 2 * 24 * HOUR_MS;

/** What the popover needs to describe a model's runs and horizon. */
export interface ModelHorizon {
  /** Catalogue horizon: length of the model's longest run. */
  catalogueHours: number;
  /** Hours the data reaches from `start` (the "Max (from now)" value), at most the catalogue horizon. */
  availableHours: number;
  /** True when the latest run ends before the catalogue horizon. */
  limitedByRun: boolean;
  /** The forecast's "now" (full hour, UTC). */
  start: string;
  /** Runs the series is composed of, newest first (only those with a start). */
  runs: RunSegment[];
  /** Start of the newest main run when no run segments are known. */
  runInit: string | null;
  ensemble: EnsembleRunInfo | null;
  /** Exclusive end of the last precipitation probability sample. */
  probabilityUntil: string | null;
}

/** The horizon of a model from its run availability; null without availability. */
export function modelHorizon(
  catalogueHours: number,
  availability: ModelAvailability | undefined,
  start: string | undefined,
): ModelHorizon | null {
  if (!availability || !start) return null;
  const delivered = availability.available_hours;
  const availableHours = typeof delivered === "number" ? Math.max(0, Math.min(catalogueHours, delivered)) : catalogueHours;
  return {
    catalogueHours,
    availableHours,
    limitedByRun: typeof delivered === "number" && delivered < catalogueHours,
    start,
    runs: (availability.run_segments ?? []).filter((run) => !!run.run_init_time),
    runInit: availability.last_run_init_time ?? null,
    ensemble: availability.ensemble ?? null,
    probabilityUntil: availability.probability_valid_until ?? null,
  };
}

/** Texts of the popover: `t` of the page's language and the time format of the run times' zone (REQ-733). */
export interface RunTexts {
  t: Translate;
  /** Date and time, e.g. "08.11., 19:00"; "?" for an unknown time. */
  time: (timestamp: string | null | undefined) => string;
}

/** One run in the popover: its start in bold and what it covers. */
export interface RunLine {
  run: string;
  detail: string;
}

export interface RunLines {
  main: RunLine[];
  ensemble: { modelId: string; lines: RunLine[] } | null;
}

const addHours = (timestamp: string, hours: number) => new Date(Date.parse(timestamp) + hours * HOUR_MS).toISOString();
const hoursBetween = (from: string, to: string) => {
  const diff = Date.parse(to) - Date.parse(from);
  return Number.isFinite(diff) ? Math.round(diff / HOUR_MS) : null;
};

/** Where the data ends: `start` plus the hours it delivers. */
const dataEnd = (info: ModelHorizon) => addHours(info.start, info.availableHours);

/**
 * Open-Meteo's ensemble metadata can be stuck for days while the data keeps coming: stale when its newest run ends
 * before the forecast starts or started more than two days before the main run.
 */
export function isEnsembleStale(info: ModelHorizon): boolean {
  const ensemble = info.ensemble;
  if (!ensemble?.run_init_time) return false;
  if (ensemble.data_end_time && Date.parse(ensemble.data_end_time) < Date.parse(info.start)) return true;
  const mainInit = info.runs[0]?.run_init_time ?? info.runInit;
  return !!mainInit && Date.parse(mainInit) - Date.parse(ensemble.run_init_time) > STALE_ENSEMBLE_AFTER_MS;
}

/** The main run(s), newest first (split when Open-Meteo mixes runs), and the ensemble behind the probability. */
export function describeRuns(info: ModelHorizon, { t, time }: RunTexts): RunLines {
  const end = dataEnd(info);
  const main: RunLine[] = info.runs.map((run, index) => {
    const until = run.valid_until ?? end;
    const span =
      index === 0
        ? t("modelChain.runs.until", { time: time(until) })
        : t("modelChain.runs.span", { from: time(run.valid_from), until: time(until) });
    const length = run.run_length_hours != null ? t("modelChain.runs.length", { hours: run.run_length_hours }) : null;
    return { run: time(run.run_init_time), detail: [length, span].filter(Boolean).join(", ") };
  });
  if (main.length === 0 && info.runInit) {
    main.push({ run: time(info.runInit), detail: t("modelChain.runs.until", { time: time(end) }) });
  }

  const source = info.ensemble;
  let ensemble: RunLines["ensemble"] = null;
  if (source && isEnsembleStale(info)) {
    // The data still tells how far the probability reaches.
    const parts = [
      info.probabilityUntil ? t("modelChain.runs.until", { time: time(info.probabilityUntil) }) : null,
      t("modelChain.runs.stale", { time: time(source.run_init_time) }),
    ];
    ensemble = {
      modelId: source.model_id,
      lines: [{ run: t("modelChain.runs.unknown"), detail: parts.filter(Boolean).join("; ") }],
    };
  } else if (source?.run_init_time) {
    const newestEnd = source.data_end_time ?? null;
    const parts = [
      source.run_availability_time ? t("modelChain.runs.available", { time: time(source.run_availability_time) }) : null,
      t("modelChain.runs.until", { time: time(newestEnd ?? info.probabilityUntil) }),
    ];
    const lines: RunLine[] = [{ run: time(source.run_init_time), detail: parts.filter(Boolean).join(", ") }];
    // Like the main series, later hours can come from earlier, longer runs.
    if (newestEnd && info.probabilityUntil && Date.parse(info.probabilityUntil) > Date.parse(newestEnd)) {
      lines.push({
        run: t("modelChain.runs.earlier"),
        detail: t("modelChain.runs.span", { from: time(newestEnd), until: time(info.probabilityUntil) }),
      });
    }
    ensemble = { modelId: source.model_id, lines };
  }
  return { main, ensemble };
}

/**
 * Paragraphs explaining the line "Max (from now)": catalogue horizon against the hours the run(s) still deliver from
 * now, and why an older run completes a series.
 */
export function describeHorizon(info: ModelHorizon, { t, time }: RunTexts): string[] {
  const { catalogueHours: catalogue, availableHours: available, start } = info;
  const paragraphs = [t("modelChain.horizon.intro", { available, catalogue })];
  const end = dataEnd(info);
  const [newest, ...earlier] = info.runs;

  if (newest && earlier.length > 0) {
    const newestEnd = newest.valid_until ?? end;
    paragraphs.push(
      t("modelChain.horizon.mixed", {
        run: time(newest.run_init_time),
        end: time(newestEnd),
        hours: hoursBetween(start, newestEnd) ?? "?",
      }),
    );
    for (const run of earlier) {
      paragraphs.push(
        t("modelChain.horizon.earlier", {
          run: time(run.run_init_time),
          from: time(run.valid_from),
          until: time(run.valid_until ?? end),
        }),
      );
    }
    paragraphs.push(t("modelChain.horizon.together", { available, now: time(start) }));
    return paragraphs;
  }

  if (!info.limitedByRun) {
    paragraphs.push(t("modelChain.horizon.full"));
    return paragraphs;
  }

  const init = newest?.run_init_time ?? info.runInit;
  if (!init) {
    paragraphs.push(t("modelChain.horizon.limitedNoRun", { available }));
    return paragraphs;
  }
  const values = { run: time(init), age: hoursBetween(init, start) ?? "?", now: time(start), end: time(end), available };
  paragraphs.push(
    newest?.run_length_hours != null
      ? t("modelChain.horizon.limited", { ...values, length: newest.run_length_hours })
      : t("modelChain.horizon.limitedNoLength", values),
  );
  return paragraphs;
}

/** `zone` when the browser can format times in it; the unknown zone ("Etc/Unknown") counts as none (REQ-733). */
function usableZone(zone: string | null | undefined): string | undefined {
  if (!zone || zone === "Etc/Unknown") return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}

/** The device's time zone (`Intl` `resolvedOptions().timeZone`), undefined when it cannot be determined (REQ-733). */
export function deviceRunTimeZone(): string | undefined {
  try {
    return usableZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return undefined;
  }
}

/**
 * Time zone of the run times in the model info (REQ-733): the device's, else the zone of the domain's default place
 * (`timeZone` of the configuration); undefined when neither is usable. `deviceZone` (null: none) is for tests.
 */
export function runTimeZone(domainZone: string | undefined, deviceZone: string | null | undefined = deviceRunTimeZone()) {
  return usableZone(deviceZone) ?? usableZone(domainZone);
}

/** Date and time in the given time zone and the page's language, e.g. "08.11., 19:00". */
export function runTimeFormat(locale: string, timeZone: string | undefined): RunTexts["time"] {
  let format: Intl.DateTimeFormat;
  const options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  try {
    format = new Intl.DateTimeFormat(locale, { ...options, timeZone });
  } catch {
    format = new Intl.DateTimeFormat(locale, options);
  }
  return (timestamp) => {
    if (!timestamp) return "?";
    const ms = Date.parse(timestamp);
    return Number.isFinite(ms) ? format.format(ms) : "?";
  };
}
