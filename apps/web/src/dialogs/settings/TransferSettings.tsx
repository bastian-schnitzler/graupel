// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useConfig } from "../../config/index.ts";
import { readStoredLanguage, useI18n, type MessageKey } from "../../i18n/index.ts";
import { DownloadIcon, UploadIcon } from "../../icons/index.ts";
import {
  cloudChainChoice,
  daySliderChoice,
  daysChoice,
  downloadTextFile,
  modelHeadersChoice,
  readArchiveDays,
  readDewPoint,
  readHistorySlider,
  readLegend,
  readRelativeHumidity,
  readScaleToVisibleRange,
  readSettingsFile,
  readStoredColorMode,
  readStoredFavorites,
  readStoredMapProvider,
  replaceFavorites,
  serializeSettingsFile,
  setArchiveDays,
  setColorMode,
  setDewPoint,
  setHistorySlider,
  setLegend,
  setMapProvider,
  setModelChainVisible,
  setRelativeHumidity,
  setScaleToVisibleRange,
  settingsFileName,
  startLocationChoice,
  useNotices,
  weatherChainChoice,
  type SettingsFileError,
} from "../../state/index.ts";

/** Outcome shown in the popup; a refused file shows an error card instead (REQ-492). */
export type TransferStatus = { kind: "imported" } | null;

const ERROR_TEXTS: Readonly<Record<SettingsFileError, MessageKey>> = {
  invalid: "settings.transfer.error.invalid",
  newer: "settings.transfer.error.newer",
  content: "settings.transfer.error.content",
};

export interface SettingsTransfer {
  status: TransferStatus;
  exportFile: () => void;
  importFile: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
}

/**
 * Export and import of the settings popup (REQ-429): saves the language choice, the colour mode, whether the weather
 * and the cloud chain card are shown, the map provider, the start place, the model headers, the day slider with its
 * days, the dew point option (REQ-593), the relative humidity option (REQ-650), whether the axes follow the zoom
 * (REQ-656), whether the meteogram shows its legend (REQ-639), the days the archive of the installed app keeps and
 * whether its history slider is shown on a phone (REQ-686) and the favourites as a JSON file and loads them back. A
 * refused file changes nothing and shows why in an error card (REQ-492). The buttons sit in the heading row (REQ-469),
 * the success message in the body.
 */
export function useSettingsTransfer(): SettingsTransfer {
  const { setLanguage } = useI18n();
  const config = useConfig();
  const [status, setStatus] = useState<TransferStatus>(null);
  const { notify, dismiss } = useNotices();
  // A refusal belongs to this popup; its card goes when the popup closes.
  useEffect(() => () => dismiss("settings.transfer"), [dismiss]);

  const exportFile = () => {
    const text = serializeSettingsFile({
      settings: {
        language: readStoredLanguage(),
        colorMode: readStoredColorMode(),
        showWeatherChain: weatherChainChoice.read(),
        showCloudChain: cloudChainChoice.read(),
        map: readStoredMapProvider(),
        startLocation: startLocationChoice.read(),
        modelHeaders: modelHeadersChoice.read(),
        daySlider: daySliderChoice.read(),
        days: daysChoice.read(),
        dewPoint: readDewPoint(),
        relativeHumidity: readRelativeHumidity(),
        scaleToVisibleRange: readScaleToVisibleRange(),
        legend: readLegend(),
        archiveDays: readArchiveDays(),
        historySlider: readHistorySlider(),
      },
      favorites: readStoredFavorites() ?? config.favorites.presets,
    });
    downloadTextFile(text, settingsFileName());
    setStatus(null);
    dismiss("settings.transfer");
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const target = event.currentTarget;
    const file = target.files?.[0];
    // Cleared so that choosing the same file again fires another change.
    target.value = "";
    if (!file) return;
    const result = await readSettingsFile(file);
    if (!result.ok) {
      setStatus(null);
      notify({ id: "settings.transfer", message: ERROR_TEXTS[result.error] });
      return;
    }
    const { settings, favorites } = result.value;
    if (favorites) replaceFavorites(favorites);
    if (settings.language !== undefined) setLanguage(settings.language);
    if (settings.colorMode !== undefined) setColorMode(settings.colorMode);
    // A file from before REQ-503 has one switch for both cards; the separate switches of a newer file win.
    if (settings.showModelChain !== undefined) setModelChainVisible(settings.showModelChain);
    if (settings.showWeatherChain !== undefined) weatherChainChoice.set(settings.showWeatherChain);
    if (settings.showCloudChain !== undefined) cloudChainChoice.set(settings.showCloudChain);
    if (settings.map !== undefined) setMapProvider(settings.map);
    if (settings.startLocation !== undefined) startLocationChoice.set(settings.startLocation);
    if (settings.modelHeaders !== undefined) modelHeadersChoice.set(settings.modelHeaders);
    if (settings.daySlider !== undefined) daySliderChoice.set(settings.daySlider);
    if (settings.days !== undefined) daysChoice.set(settings.days);
    if (settings.dewPoint !== undefined) setDewPoint(settings.dewPoint);
    if (settings.relativeHumidity !== undefined) setRelativeHumidity(settings.relativeHumidity);
    if (settings.scaleToVisibleRange !== undefined) setScaleToVisibleRange(settings.scaleToVisibleRange);
    if (settings.legend !== undefined) setLegend(settings.legend);
    if (settings.archiveDays !== undefined) setArchiveDays(settings.archiveDays);
    if (settings.historySlider !== undefined) setHistorySlider(settings.historySlider);
    dismiss("settings.transfer");
    setStatus({ kind: "imported" });
  };

  return { status, exportFile, importFile };
}

/** Icon buttons for export and import in the heading row of the settings popup (REQ-469). */
export function TransferButtons({ transfer }: { transfer: SettingsTransfer }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const exportLabel = t("settings.transfer.export");
  const importLabel = t("settings.transfer.import");
  return (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label={exportLabel}
        title={exportLabel}
        onClick={transfer.exportFile}
      >
        <DownloadIcon />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={importLabel}
        title={`${importLabel}. ${t("settings.transfer.importHint")}`}
        onClick={() => input.current?.click()}
      >
        <UploadIcon />
      </button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        data-testid="settings-import-file"
        onChange={(event) => void transfer.importFile(event)}
      />
    </>
  );
}

/** Message of a successful import; the live region stays in the page so that screen readers announce a change. */
export function TransferMessages({ status }: { status: TransferStatus }) {
  const { t } = useI18n();
  return (
    <div className="settings__transfer">
      <p className="settings__status" role="status">
        {status?.kind === "imported" ? t("settings.transfer.imported") : ""}
      </p>
    </div>
  );
}
