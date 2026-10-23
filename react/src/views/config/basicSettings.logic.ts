import type { AppSettings, ArchiveStats } from "../../types";

/** Retention choices of the forecast archive (system.md §9.3). */
export type RetentionChoice = "off" | "7" | "30" | "90" | "365" | "forever";

export const RETENTION_OPTIONS: { value: RetentionChoice; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "365 days" },
  { value: "forever", label: "Forever" },
];

/** Off whenever archiving is disabled; the stored retention is kept then. */
export function getRetentionChoice(
  settings: Pick<AppSettings, "archive_enabled" | "archive_retention_days">,
): RetentionChoice {
  if (!settings.archive_enabled) return "off";
  const days = settings.archive_retention_days;
  if (days === null) return "forever";
  const choice = String(days) as RetentionChoice;
  return RETENTION_OPTIONS.some((option) => option.value === choice)
    ? choice
    : "forever";
}

/** Settings change for a choice; "off" leaves the retention untouched. */
export function settingsForRetention(
  choice: RetentionChoice,
): Partial<AppSettings> {
  if (choice === "off") return { archive_enabled: false };
  return {
    archive_enabled: true,
    archive_retention_days: choice === "forever" ? null : Number(choice),
  };
}

/** Turning an enabled archive off asks first (with "Delete archived data"). */
export function needsDisableConfirmation(
  current: RetentionChoice,
  next: RetentionChoice,
): boolean {
  return current !== "off" && next === "off";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function formatArchiveStats(stats: ArchiveStats): string {
  if (stats.fetches === 0 && stats.bytes === 0) return "Archive is empty";
  const forecasts = `${stats.fetches} archived forecast${stats.fetches === 1 ? "" : "s"}`;
  return `${forecasts}, about ${formatBytes(stats.bytes)}`;
}
