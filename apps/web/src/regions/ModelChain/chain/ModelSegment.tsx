// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * One card of the model chain: model, hours of its slice, catalogue details in an
 * info popover (`ModelInfoButton`).
 */
import type { WeatherModel } from "@graupel/download";
import { useCallback } from "react";
import { useT } from "../../../i18n/index.ts";
import type { HourSpan } from "../../../state/chain.ts";
import type { ChainKind, ChainShade } from "../../../state/chainColors.ts";
import { usePhone } from "../../../state/phoneLandscape.ts";
import { modelLabel } from "./chainUtils.ts";
import { ModelInfoButton } from "./ModelInfo.tsx";
import type { ModelChainSegment } from "./modelChainLayout.ts";

export interface ModelSegmentProps {
  segment: ModelChainSegment;
  meta: WeatherModel;
  /** Shade of the model in its chain (REQ-443): top bar and range badge. */
  shade: ChainShade;
  showTotalHours?: boolean;
  /**
   * Time span of the data the model delivered (REQ-448), shown instead of the planned slice; null: the model
   * delivered nothing. Left out: the planned slice.
   */
  delivered?: HourSpan | null;
  /** Prefix of the test ids, e.g. "cloud-". */
  testIdPrefix?: string;
  activeTooltip: string | null;
  onToggleTooltip: (modelName: string) => void;
  /** Chain of the card (default main): the info popover lists the model's runs from there (REQ-687). */
  kind?: ChainKind;
}

export function ModelSegment({
  segment,
  meta,
  shade,
  showTotalHours = true,
  delivered,
  testIdPrefix = "",
  activeTooltip,
  onToggleTooltip,
  kind = "main",
}: ModelSegmentProps) {
  const t = useT();
  const phone = usePhone();
  const { model } = segment;
  const label = modelLabel({ ...meta, ...model });
  const key = model.id ?? model.name;
  // The delivered span when known, else the planned slice.
  const shownSpan = delivered === undefined ? { start: segment.startHour, end: segment.endHour } : delivered;
  const spanKind = delivered === undefined ? "planned" : delivered ? "delivered" : "none";
  const duration = shownSpan ? shownSpan.end - shownSpan.start : 0;
  // Without data the card says so; on a phone, where the card is narrow, "0 h" (REQ-609). The title names the slice.
  const empty = phone ? t("modelChain.hours", { hours: 0 }) : t("modelChain.noData");
  const range = shownSpan ? t("modelChain.range", { start: shownSpan.start, end: shownSpan.end }) : empty;
  const title = shownSpan
    ? t("modelChain.cardTitle", { model: meta.name, range, hours: duration })
    : t("modelChain.cardTitleNoData", {
        model: meta.name,
        range: t("modelChain.range", { start: segment.startHour, end: segment.endHour }),
      });
  const open = activeTooltip === key;
  const toggle = useCallback(() => onToggleTooltip(key), [onToggleTooltip, key]);
  return (
    <div
      data-testid={`${testIdPrefix}model-card-${key}`}
      className="model-card"
      style={{ borderTopColor: shade.color }}
      data-chain-color={shade.color}
      data-model={model.name}
      title={title}
    >
      <div className="model-card__top">
        <span className="model-card__name">{label}</span>
        <ModelInfoButton
          className="model-card__info"
          meta={meta}
          model={model}
          open={open}
          onToggle={toggle}
          chain={kind}
        />
      </div>
      <div
        className="model-card__range"
        data-testid={`${testIdPrefix}model-range-${key}`}
        data-span={spanKind}
        style={{ color: shade.text, backgroundColor: shade.color }}
      >
        {range}
        {showTotalHours && shownSpan ? ` (${t("modelChain.hours", { hours: duration })})` : ""}
      </div>
    </div>
  );
}
