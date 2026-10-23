import type { ModelHorizonInfo } from "../../types";
import { formatModelRunTime } from "./modelChainBuilderUtils";

const HOUR_MS = 3_600_000;

function hoursBetween(from: string, to: string): number | null {
  const diff = Date.parse(to) - Date.parse(from);
  return Number.isFinite(diff) ? Math.round(diff / HOUR_MS) : null;
}

function addHours(timestamp: string, hours: number): string {
  return new Date(Date.parse(timestamp) + hours * HOUR_MS).toISOString();
}

/** One run line of the info popover: start, run length and covered hours. */
export interface ModelRunLine {
  /** "06.10. 20:00", or a description when the run is unknown. */
  run: string;
  detail: string;
}

/** Run lines for the info popover: main run(s) and ensemble run(s). */
export interface ModelRunLines {
  main: ModelRunLine[];
  ensemble: { modelId: string; lines: ModelRunLine[] } | null;
}

const STALE_ENSEMBLE_AFTER_MS = 2 * 24 * 3600 * 1000;

/**
 * Open-Meteo's ensemble metadata can be stuck for days while the data keeps
 * coming (DWD EPS reported a 06.10. run on 19.10., with probabilities until
 * 24.10.). It is stale when its newest run ends before the forecast starts,
 * or started more than two days before the main run.
 */
export function isEnsembleMetadataStale(info: ModelHorizonInfo): boolean {
  const ensemble = info.ensemble;
  if (!ensemble?.run_init_time) return false;
  const start = info.forecast_start_time;
  if (
    ensemble.data_end_time &&
    start &&
    Date.parse(ensemble.data_end_time) < Date.parse(start)
  ) {
    return true;
  }
  const mainInit = info.run_segments[0]?.run_init_time ?? info.run_init_time;
  return Boolean(
    mainInit &&
      Date.parse(mainInit) - Date.parse(ensemble.run_init_time) >
        STALE_ENSEMBLE_AFTER_MS,
  );
}

/**
 * Starts of the runs whose part lies in the model's displayed slice, newest
 * first (card run line). Like the meteogram headers, run `i` covers the hours
 * from the previous run's `valid_until` to its own; the last run is open.
 */
export function displayedRunInitTimes(info: ModelHorizonInfo): string[] {
  const runs = info.run_segments;
  const start = info.forecast_start_time;
  const sliceStartMs =
    start && info.slice_start_hours != null
      ? Date.parse(addHours(start, info.slice_start_hours))
      : -Infinity;
  const sliceEndMs =
    start && info.slice_end_hours != null
      ? Date.parse(addHours(start, info.slice_end_hours))
      : Infinity;
  const edgeMs = (timestamp?: string | null) =>
    timestamp ? Date.parse(timestamp) : null;
  return runs
    .filter((run, idx) => {
      const fromMs = idx > 0 ? edgeMs(runs[idx - 1].valid_until) : null;
      const untilMs = idx < runs.length - 1 ? edgeMs(run.valid_until) : null;
      return (
        (fromMs === null || fromMs < sliceEndMs) &&
        (untilMs === null || untilMs > sliceStartMs)
      );
    })
    .map((run) => run.run_init_time)
    .filter(Boolean);
}

/**
 * Lines listing the runs a model's series is composed of in Meteogram View:
 * the main run(s) (newest first, split when Open-Meteo mixes runs) and the
 * ensemble run(s) behind the precipitation probability. Times are local.
 */
export function describeModelRuns(
  info: ModelHorizonInfo,
  timeZone?: string,
): ModelRunLines {
  const fmt = (timestamp?: string | null) =>
    formatModelRunTime(timestamp, timeZone) ?? "?";
  const start = info.forecast_start_time;
  const dataEnd = start ? addHours(start, info.available_hours) : null;
  const runs = info.run_segments.filter((run) => run.run_init_time);

  const main: ModelRunLine[] = runs.map((run, idx) => {
    const length =
      run.run_length_hours != null ? `${run.run_length_hours}h run, ` : "";
    const until = run.valid_until ?? dataEnd;
    const span =
      idx === 0 ? `until ${fmt(until)}` : `${fmt(run.valid_from)} – ${fmt(until)}`;
    return { run: fmt(run.run_init_time), detail: `${length}${span}` };
  });
  if (main.length === 0 && info.run_init_time) {
    main.push({
      run: fmt(info.run_init_time),
      detail: dataEnd ? `until ${fmt(dataEnd)}` : "",
    });
  }

  const ensembleInfo = info.ensemble;
  let ensemble: ModelRunLines["ensemble"] = null;
  if (ensembleInfo && isEnsembleMetadataStale(info)) {
    // The data still tells how far the probability reaches.
    const probabilityEnd = info.probability_valid_until;
    ensemble = {
      modelId: ensembleInfo.model_id,
      lines: [
        {
          run: "run unknown",
          detail:
            (probabilityEnd ? `until ${fmt(probabilityEnd)}; ` : "") +
            `Open-Meteo's run metadata is outdated (last ${fmt(ensembleInfo.run_init_time)})`,
        },
      ],
    };
  } else if (ensembleInfo) {
    const lines: ModelRunLine[] = [];
    const newestEnd = ensembleInfo.data_end_time;
    const probabilityEnd = info.probability_valid_until;
    const available = ensembleInfo.run_availability_time
      ? `available ${fmt(ensembleInfo.run_availability_time)}, `
      : "";
    lines.push({
      run: fmt(ensembleInfo.run_init_time),
      detail: `${available}until ${fmt(newestEnd)}`,
    });
    // Like the main series, later hours can come from earlier, longer runs.
    if (
      newestEnd &&
      probabilityEnd &&
      Date.parse(probabilityEnd) > Date.parse(newestEnd)
    ) {
      lines.push({
        run: "earlier run(s)",
        detail: `${fmt(newestEnd)} – ${fmt(probabilityEnd)}`,
      });
    }
    ensemble = { modelId: ensembleInfo.model_id, lines };
  }
  return { main, ensemble };
}

/**
 * Paragraphs explaining where a model's "Max" horizon in Meteogram View comes
 * from: catalogue horizon vs. hours the run(s) still deliver from now, why a
 * second (older) run completes a series, and why the precipitation
 * probability curve stops early ("|"). Times are local.
 */
export function describeModelHorizon(
  info: ModelHorizonInfo,
  timeZone?: string,
): string[] {
  return [
    ...describeMainHorizon(info, timeZone),
    ...describeProbabilityStop(info, timeZone),
  ];
}

function describeMainHorizon(
  info: ModelHorizonInfo,
  timeZone?: string,
): string[] {
  const fmt = (timestamp?: string | null) =>
    formatModelRunTime(timestamp, timeZone) ?? "?";
  const {
    catalogue_hours: catalogue,
    available_hours: available,
    forecast_start_time: start,
  } = info;
  const runs = info.run_segments.filter((run) => run.run_init_time);
  const paragraphs = [
    `Catalogue horizon ${catalogue}h: the length of the model's longest run.`,
  ];
  const dataEnd = start ? addHours(start, available) : null;
  const newest = runs[0];

  if (runs.length > 1 && start) {
    const newestEnd = newest.valid_until ?? dataEnd;
    const newestHours = newestEnd ? hoursBetween(start, newestEnd) : null;
    paragraphs.push(
      `Open-Meteo keeps one continuous series per model: a new run only ` +
        `overwrites the hours it computes. The latest run (${fmt(newest.run_init_time)}` +
        `${newest.run_length_hours != null ? `, ${newest.run_length_hours}h long` : ""}) ` +
        `is shorter than what earlier runs still have, so it only covers ` +
        `until ${fmt(newestEnd)}` +
        `${newestHours != null ? ` (${newestHours}h from now)` : ""}.`,
    );
    runs.slice(1).forEach((run) => {
      const until = run.valid_until ?? dataEnd;
      paragraphs.push(
        `The earlier run ${fmt(run.run_init_time)}` +
          `${run.run_length_hours != null ? ` (${run.run_length_hours}h long)` : ""} ` +
          `reaches further, so its hours from ${fmt(run.valid_from)} until ` +
          `${fmt(until)} complete the picture.`,
      );
    });
    paragraphs.push(`Together they deliver ${available}h from now (${fmt(start)}).`);
    return paragraphs;
  }

  if (!info.limited_by_run) {
    paragraphs.push(
      available === catalogue
        ? `The data reaches the full catalogue horizon from now, so Max equals it.`
        : `The data covers all hours this chain needs (${available}h from now).`,
    );
    return paragraphs;
  }

  if (newest && start) {
    const age = hoursBetween(newest.run_init_time, start);
    paragraphs.push(
      `The latest run started ${fmt(newest.run_init_time)}` +
        `${newest.run_length_hours != null ? ` and is ${newest.run_length_hours}h long` : ""}` +
        `${age != null ? `; it started ${age}h before the current hour (${fmt(start)})` : ""}, ` +
        `so its data ends ${fmt(dataEnd)}: only ${available}h are left from now.`,
    );
  } else {
    paragraphs.push(
      `The latest run started before the current hour, so only ` +
        `${available}h of it are left from now.`,
    );
  }
  return paragraphs;
}

/**
 * Explains a precipitation probability that ends inside the model's slice,
 * where the chart draws a "|" stop marker.
 */
function describeProbabilityStop(
  info: ModelHorizonInfo,
  timeZone?: string,
): string[] {
  const fmt = (timestamp?: string | null) =>
    formatModelRunTime(timestamp, timeZone) ?? "?";
  const start = info.forecast_start_time;
  const probabilityEnd = info.probability_valid_until;
  if (!start || !probabilityEnd || info.slice_end_hours == null) return [];
  const sliceEnd = addHours(start, info.slice_end_hours);
  const sliceStart = addHours(start, info.slice_start_hours ?? 0);
  if (Date.parse(probabilityEnd) >= Date.parse(sliceEnd)) return [];

  const ensemble = info.ensemble;
  const source = ensemble
    ? `the ensemble ${ensemble.model_id} (many runs with slightly different ` +
      `starting conditions; the probability is the share of members with ` +
      `precipitation)`
    : "the model's ensemble";
  const missing = hoursBetween(probabilityEnd, sliceEnd);
  const paragraphs = [
    Date.parse(probabilityEnd) <= Date.parse(sliceStart)
      ? `Precipitation probability comes from ${source}. It ends ` +
        `${fmt(probabilityEnd)}, before this model's slice starts, so the ` +
        `slice shows no probability.`
      : `Precipitation probability comes from ${source}. It ends ` +
        `${fmt(probabilityEnd)}, ${missing}h before the end of this model's ` +
        `slice, so its curve stops there with "|".`,
  ];

  // Ensembles take longer to compute: right after a new main run the
  // probability still comes from the previous, earlier-ending ensemble run.
  const mainInit = info.run_segments[0]?.run_init_time ?? info.run_init_time;
  if (
    ensemble?.run_init_time &&
    !isEnsembleMetadataStale(info) &&
    mainInit &&
    Date.parse(ensemble.run_init_time) < Date.parse(mainInit) &&
    (!ensemble.data_end_time ||
      Date.parse(probabilityEnd) <= Date.parse(ensemble.data_end_time))
  ) {
    paragraphs.push(
      `The ensemble of the latest main run (${fmt(mainInit)}) is not ` +
        `published yet: ensembles take longer to compute. The probability ` +
        `still comes from the ensemble run ${fmt(ensemble.run_init_time)}, ` +
        `which ends earlier.`,
    );
  } else if (ensemble) {
    paragraphs.push(
      `The ensemble run is shorter than the main run, so the probability ` +
        `ends before the other variables.`,
    );
  }
  return paragraphs;
}
