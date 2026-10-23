import { describe, expect, it } from "vitest";
import {
  formatArchiveStats,
  formatBytes,
  getRetentionChoice,
  needsDisableConfirmation,
  settingsForRetention,
} from "./basicSettings.logic";

describe("basic settings logic (spec §9.3)", () => {
  it("maps settings to the retention choice", () => {
    expect(
      getRetentionChoice({
        archive_enabled: false,
        archive_retention_days: 30,
      }),
    ).toBe("off");
    expect(
      getRetentionChoice({ archive_enabled: true, archive_retention_days: 30 }),
    ).toBe("30");
    expect(
      getRetentionChoice({
        archive_enabled: true,
        archive_retention_days: null,
      }),
    ).toBe("forever");
  });

  it("keeps the stored retention when switching off", () => {
    expect(settingsForRetention("off")).toEqual({ archive_enabled: false });
    expect(settingsForRetention("7")).toEqual({
      archive_enabled: true,
      archive_retention_days: 7,
    });
    expect(settingsForRetention("forever")).toEqual({
      archive_enabled: true,
      archive_retention_days: null,
    });
  });

  it("asks only when an enabled archive is switched off", () => {
    expect(needsDisableConfirmation("30", "off")).toBe(true);
    expect(needsDisableConfirmation("forever", "off")).toBe(true);
    expect(needsDisableConfirmation("off", "30")).toBe(false);
    expect(needsDisableConfirmation("30", "90")).toBe(false);
  });

  it("formats the archive size", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
    expect(formatArchiveStats({ fetches: 0, bytes: 0 })).toBe(
      "Archive is empty",
    );
    expect(formatArchiveStats({ fetches: 1, bytes: 2048 })).toBe(
      "1 archived forecast, about 2.0 KB",
    );
  });
});
