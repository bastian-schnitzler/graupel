// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Model chains of the selected place (REQ-435): the weather and the
 * cloud chain, each its own card at the width of the other cards, between the place and the meteogram (REQ-482).
 * They show the auto chain of the place (`createResolver` of `@graupel/download`) with the time span of the data each
 * model delivered (REQ-448).
 *
 * Hidden by default (REQ-445), each card switched on separately in the settings popup (REQ-503,
 * `useChainCardsVisible`); a card switched off is not there at all (REQ-471). Hiding a card is display only: both
 * chains are still loaded and the cloud chain still feeds the meteogram's cloud area. The
 * website cannot edit the chains (REQ-480): no models are added or removed. Only the boundaries between the models
 * can be moved, like in the desktop app (REQ-481); the meteogram then loads the moved chain. A double-click (on
 * phones a double-tap) puts one boundary back where the auto chain has it, the other moved ones stay (REQ-498). While a
 * boundary is dragged, the meteogram follows it at every hour step from the data in memory (REQ-504). A newly
 * loaded place starts again from its auto chain (`ChainProvider`).
 */
import type { WeatherModel } from "@graupel/download";
import { useMemo } from "react";
import { useT } from "../../i18n/index.ts";
import { deliveredSpans, useChainSelection, useErrorNotice, useForecast, useChainCardsVisible } from "../../state/index.ts";
import { boundaryLimits, displayedChain, mergeMovedChain, resetBoundary, sameBoundaries } from "./chain/chainBoundaries.ts";
import { ModelChainRow } from "./chain/ModelChainRow.tsx";
import "./ModelChain.css";

export function ModelChain() {
  const t = useT();
  const cards = useChainCardsVisible();
  const shown = cards.weather || cards.cloud;
  const { models, cloudModels, resolved, status, available, setChain, setAuto } = useChainSelection();
  const forecast = useForecast();
  useErrorNotice("modelChain", shown && status === "error" ? "modelChain.error" : null);

  // With the forecast of this chain loaded: the delivered spans, and each boundary where the model's run ends.
  const result = forecast.status === "ready" ? forecast.result : undefined;
  const view = useMemo(() => {
    const main = displayedChain(models, result?.availability);
    const cloud = displayedChain(cloudModels, result?.cloudAvailability);
    return {
      main,
      cloud,
      mainLimits: boundaryLimits(available, models, result?.availability),
      cloudLimits: boundaryLimits(available, cloudModels, result?.cloudAvailability),
      mainSpans: result ? deliveredSpans(result, "main") : undefined,
      cloudSpans: result ? deliveredSpans(result, "cloud") : undefined,
    };
  }, [models, cloudModels, available, result]);

  // Both switched off: no card at all, not even an empty frame (REQ-471).
  if (!shown) return null;

  if (status !== "ready") {
    return (
      <section className="region model-chain-status" data-region="model-chain" aria-label={t("region.modelChain.title")}>
        {/* A load failure leaves the card empty; the message is a card in the corner (REQ-492). */}
        {status === "loading" && (
          <p className="model-chain-status__text" role="status">
            {t("modelChain.loading")}
          </p>
        )}
      </section>
    );
  }

  const moveMain = (moved: WeatherModel[]) => setChain(mergeMovedChain(models, view.main, moved));
  const moveCloud = (moved: WeatherModel[]) => setChain(models, mergeMovedChain(cloudModels, view.cloud, moved));
  // REQ-504: the chain as the release would hand it on, while the boundary is still dragged.
  const previewMain = (moved: WeatherModel[] | null) =>
    forecast.setPreview(moved && { models: mergeMovedChain(models, view.main, moved), cloudModels, moving: "main" });
  const previewCloud = (moved: WeatherModel[] | null) =>
    forecast.setPreview(
      moved && { models, cloudModels: mergeMovedChain(cloudModels, view.cloud, moved), moving: "cloud" },
    );
  // REQ-498: one boundary back to the auto chain; when no moved boundary is left, back to auto mode.
  const autoMain = resolved?.main_model_chain ?? [];
  const autoCloud = resolved?.cloud_model_chain ?? [];
  const backToAuto = (main: WeatherModel[], cloud: WeatherModel[]) =>
    sameBoundaries(main, autoMain) && sameBoundaries(cloud, autoCloud);
  const resetMain = (index: number) => {
    const main = resetBoundary(models, autoMain, index);
    if (sameBoundaries(main, models)) return;
    if (backToAuto(main, cloudModels)) setAuto();
    else setChain(main);
  };
  const resetCloud = (index: number) => {
    const cloud = resetBoundary(cloudModels, autoCloud, index);
    if (sameBoundaries(cloud, cloudModels)) return;
    if (backToAuto(models, cloud)) setAuto();
    else setChain(models, cloud);
  };

  return (
    <section className="model-chains" data-region="model-chain" aria-label={t("region.modelChain.title")}>
      {cards.weather && (
        <ModelChainRow
          borderLabel={t("modelChain.main")}
          label={t("modelChain.mainLabel")}
          modelChain={view.main}
          availableModels={available}
          limits={view.mainLimits}
          onCommit={moveMain}
          onReset={resetMain}
          onPreview={previewMain}
          {...(view.mainSpans ? { spans: view.mainSpans } : {})}
          showTotalHours={false}
          emptyMessage={t("modelChain.emptyView")}
        />
      )}
      {cards.cloud && (
        <ModelChainRow
          borderLabel={t("modelChain.cloud")}
          label={t("modelChain.cloudLabel")}
          testIdPrefix="cloud-"
          kind="cloud"
          modelChain={view.cloud}
          availableModels={available}
          limits={view.cloudLimits}
          onCommit={moveCloud}
          onReset={resetCloud}
          onPreview={previewCloud}
          {...(view.cloudSpans ? { spans: view.cloudSpans } : {})}
          showTotalHours={false}
          emptyMessage={t("modelChain.cloudEmptyView")}
        />
      )}
    </section>
  );
}
