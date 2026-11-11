// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Info button of a model with its popover (catalogue details): on each card of the model chain (`ModelSegment`) and,
 * while the weather chain is hidden, in the meteogram's model header (REQ-643, `ModelHeaderInfo`). On a phone the
 * details open as a dialog as big as the settings, with the close button at the top right (REQ-719).
 */
import type { ForecastResult, WeatherModel } from "@graupel/download";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import { useConfig } from "../../../config/index.ts";
import { Dialog } from "../../../dialogs/Dialog.tsx";
import { InfoIcon } from "../../../icons/index.ts";
import { useI18n, useT } from "../../../i18n/index.ts";
import { httpsUrl, type ModelMeta } from "../../../state/chain.ts";
import { useForecast } from "../../../state/forecast.ts";
import { usePhone } from "../../../state/phoneLandscape.ts";
import { readSideInsets } from "../../../state/safeArea.ts";
import {
  describeHorizon,
  describeRuns,
  modelHorizon,
  runTimeFormat,
  runTimeZone,
  type RunLine,
  type RunTexts,
} from "./modelRuns.ts";

const POPOVER_MARGIN_PX = 8;

export interface ModelInfoPopoverProps {
  id?: string;
  /**
   * Element whose visible box the popover stays inside as well as the window, e.g. a container that scrolls sideways
   * and would otherwise scroll further (REQ-643). Left out: the window alone.
   */
  bounds?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

/**
 * Info popover centred below its button, shifted so it stays inside the window whenever the window is wide enough; on
 * a phone in landscape also clear of the camera (REQ-618).
 */
export function ModelInfoPopover({ id, bounds, children }: ModelInfoPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      el.style.transform = "translateX(-50%)";
      const rect = el.getBoundingClientRect();
      const insets = readSideInsets();
      let start = insets.left + POPOVER_MARGIN_PX;
      let end = document.documentElement.clientWidth - insets.right - POPOVER_MARGIN_PX;
      const box = bounds?.current?.getBoundingClientRect();
      if (box) {
        start = Math.max(start, box.left + POPOVER_MARGIN_PX);
        end = Math.min(end, box.right - POPOVER_MARGIN_PX);
      }
      let shift = 0;
      if (rect.right > end) shift = end - rect.right;
      // The left edge wins when the window is narrower than the popover.
      if (rect.left + shift < start) shift = start - rect.left;
      el.style.transform = `translateX(calc(-50% + ${shift}px))`;
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [bounds]);

  return (
    <div ref={ref} id={id} className="model-info" role="group" data-testid="model-info-popover">
      {children}
    </div>
  );
}

/**
 * Link of the popover's title (REQ-687): opens in a new tab without access to this page; without a URL just the text.
 */
function TitleLink({ href, title, children }: { href: string | undefined; title: string; children: ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <a className="model-info__link" href={href} target="_blank" rel="noopener noreferrer" title={title}>
      {children}
    </a>
  );
}

/**
 * Title of the details (REQ-687): "model (publisher, coverage)", the model's name linked to its documentation and the
 * publisher to its homepage, each only with a URL from the catalogue. Atop the popover, in the heading row of the
 * phone's dialog (REQ-719).
 */
export function ModelInfoTitle({ meta }: { meta: ModelMeta }) {
  const t = useT();
  const coverage = meta.region ?? meta.geographical_coverage;
  const documentation = httpsUrl(meta.documentation_url);
  const homepage = httpsUrl(meta.provider_url);
  return (
    <span data-testid="model-info-title">
      <strong className="model-info__name">
        <TitleLink href={documentation} title={t("modelChain.documentationLink", { model: meta.name })}>
          {meta.name}
        </TitleLink>
      </strong>
      {meta.provider || coverage ? " (" : ""}
      {meta.provider ? (
        <span className="model-info__provider">
          <TitleLink href={homepage} title={t("modelChain.providerLink", { provider: meta.provider })}>
            {meta.provider}
          </TitleLink>
        </span>
      ) : null}
      {meta.provider && coverage ? ", " : ""}
      {coverage ?? ""}
      {meta.provider || coverage ? ")" : ""}
    </span>
  );
}

/** One run section of the popover: its title, then each run with its start in bold (REQ-687). */
function RunSection({ title, lines, testId }: { title: string; lines: RunLine[]; testId: string }) {
  return (
    <div className="model-info__runs" data-testid={testId}>
      <p className="model-info__runs-title">{title}</p>
      {lines.map((line, index) => (
        <p key={`${line.run}-${index}`} className="model-info__run">
          {index > 0 ? "+ " : ""}
          <strong>{line.run}</strong>
          {line.detail ? ` · ${line.detail}` : ""}
        </p>
      ))}
    </div>
  );
}

/** Name of a model as its header shows it: the short name, else the name. */
const headerName = (shortName: string | null | undefined, name: string) => shortName || name;

/**
 * The sentence on a replaced model (REQ-767), e.g. "AROME AT delivers no current data; replaced by ICON-D2": in the
 * details of the model that took the slice and of the model it replaces, null for any other. It is part of the details
 * only, never of the model header.
 */
export function replacementNote(
  chain: ForecastResult["chain"] | undefined,
  model: WeatherModel,
  t: ReturnType<typeof useT>,
): string | null {
  const entry =
    chain?.find((item) => item.replaces && item.model === model.name) ??
    chain?.find((item) => item.replaces?.model === model.name);
  if (!entry?.replaces) return null;
  return t("modelChain.replaced", {
    failed: headerName(entry.replaces.shortName, entry.replaces.model),
    model: headerName(entry.shortName, entry.model),
  });
}

/** Which chain a model's info belongs to: its run availability is looked up there first. */
export type ModelInfoChain = "main" | "cloud";

/**
 * Popover body (REQ-687): on top "model (publisher, coverage)" (`ModelInfoTitle`). Below the model's properties: grid spacing and
 * "Max (from now)", the hours its data reaches from now against the catalogue horizon (without a loaded forecast the
 * forecast length of the catalogue). Below them the main run and the ensemble run, each listed separately, and then
 * the explanation of the horizon. Times in the device's time zone, else in that of the domain's default place
 * (REQ-733); the run time in the model header stays UTC (REQ-682). Below the title, the note on a replaced model of
 * the weather chain (REQ-767, `replacementNote`).
 */
export function ModelInfoContent({
  meta,
  model,
  chain = "main",
  title = true,
}: {
  meta: ModelMeta;
  model: WeatherModel;
  chain?: ModelInfoChain;
  /** Whether the title is shown on top; the phone's dialog has it in its heading row instead (REQ-719). */
  title?: boolean;
}) {
  const t = useT();
  const { locale } = useI18n();
  const { result } = useForecast();
  const { timeZone } = useConfig();
  const number = (value: number) => value.toLocaleString(locale);
  const resolution = meta.spatial_resolution_km ?? meta.spatial_resolution;
  const capability = meta.max_forecast_horizon_hours || meta.max_forecast_hours || model.max_forecast_horizon_hours;
  const [first, second] = chain === "cloud" ? ["cloudAvailability", "availability"] as const : ["availability", "cloudAvailability"] as const;
  const availability = result?.[first]?.[model.name] ?? result?.[second]?.[model.name];
  const horizon = modelHorizon(capability, availability, result?.timeline.now);
  // REQ-733: the device's time zone, else that of the domain's default place.
  const texts: RunTexts = { t, time: runTimeFormat(locale, runTimeZone(timeZone)) };
  const runs = horizon ? describeRuns(horizon, texts) : null;
  const note = chain === "main" ? replacementNote(result?.chain, model, t) : null;
  const specs: [string, string][] = [
    ...(resolution ? [[t("modelChain.spec.resolution"), t("modelChain.spec.km", { value: number(resolution) })] as [string, string]] : []),
    horizon
      ? [
          t("modelChain.spec.maxFromNow"),
          t("modelChain.spec.maxValue", {
            available: number(horizon.availableHours),
            catalogue: number(horizon.catalogueHours),
          }),
        ]
      : [t("modelChain.spec.horizon"), t("modelChain.hours", { hours: number(capability) })],
  ];
  return (
    <>
      {title ? (
        <p className="model-info__title">
          <ModelInfoTitle meta={meta} />
        </p>
      ) : null}
      {note && (
        <p className="model-info__replaced" data-testid="model-info-replaced">
          {note}
        </p>
      )}
      <dl className="model-info__specs" data-testid="model-info-specs">
        {specs.map(([key, value]) => (
          <div key={key} className="model-info__spec">
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {runs && runs.main.length > 0 && (
        <RunSection title={t("modelChain.runs.main")} lines={runs.main} testId="model-info-main-runs" />
      )}
      {runs?.ensemble && (
        <RunSection
          title={t("modelChain.runs.ensemble", { model: runs.ensemble.modelId })}
          lines={runs.ensemble.lines}
          testId="model-info-ensemble-runs"
        />
      )}
      {horizon && (
        <div className="model-info__explanation" data-testid="model-info-explanation">
          {describeHorizon(horizon, texts).map((text) => (
            <p key={text}>{text}</p>
          ))}
        </div>
      )}
    </>
  );
}

export interface ModelInfoButtonProps {
  /** Catalogue entry of the model (name, provider, specs, links). */
  meta: ModelMeta;
  /** The model as the chain has it (horizon without a catalogue entry). */
  model: WeatherModel;
  open: boolean;
  /** Opens or closes the popover; also called to close it on a press outside or on Escape. */
  onToggle: () => void;
  /** Class and style of the element that holds button and popover (the popover is placed below it). */
  className: string;
  style?: CSSProperties;
  /** Size of the icon in pixels (default 16). */
  iconSize?: number;
  bounds?: RefObject<HTMLElement | null>;
  /** Test id of the button. */
  testId?: string;
  /** Chain of the model (default main): its runs are taken from there (REQ-687). */
  chain?: ModelInfoChain;
}

/** Events inside the phone's dialog stay there: React passes them on along its tree, past the portal (REQ-719). */
const stop = (event: SyntheticEvent) => event.stopPropagation();

/**
 * The details on a phone (REQ-719): a dialog as big as the settings (`dialog--tall`), the title in its heading row and
 * the close button at the top right. It is placed in the document's body, so neither the card's or chart's styles nor
 * their handlers of presses and keys reach it. Escape, the close button and a press on the backdrop close it.
 */
function ModelInfoDialog({
  meta,
  model,
  chain,
  onClose,
}: {
  meta: ModelMeta;
  model: WeatherModel;
  chain: ModelInfoChain;
  onClose: () => void;
}) {
  return createPortal(
    <div
      className="model-info-dialog__host"
      onClick={stop}
      onDoubleClick={stop}
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onTouchStart={stop}
      onTouchMove={stop}
      onTouchEnd={stop}
      onMouseDown={stop}
      onKeyDown={stop}
    >
      <Dialog
        title={<ModelInfoTitle meta={meta} />}
        onClose={onClose}
        className="model-info-dialog dialog--tall"
        testId="model-info-popover"
      >
        <div className="model-info-dialog__content">
          <ModelInfoContent meta={meta} model={model} chain={chain} title={false} />
        </div>
      </Dialog>
    </div>,
    document.body,
  );
}

/**
 * The info button and, while open, its popover. REQ-463: a press outside the button and its popover closes the
 * popover; Escape closes it and gives the focus back to the button. Pressing another model's info button closes this
 * one and opens that one. In the full-screen meteogram Escape closes the popover before the view (REQ-643). On a phone
 * a dialog instead of the popover (REQ-719).
 */
export function ModelInfoButton({
  meta,
  model,
  open,
  onToggle,
  className,
  style,
  iconSize = 16,
  bounds,
  testId,
  chain = "main",
}: ModelInfoButtonProps) {
  const t = useT();
  const popoverId = useId();
  const infoRef = useRef<HTMLDivElement>(null);
  const infoButtonRef = useRef<HTMLButtonElement>(null);
  const phone = usePhone();
  useEffect(() => {
    // The phone's dialog closes itself (Escape, close button, backdrop).
    if (!open || phone) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!infoRef.current?.contains(event.target as Node)) onToggle();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onToggle();
      infoButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, phone, onToggle]);
  // Escape inside button or popover closes only the popover, not a dialog around it (the full-screen meteogram).
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!open || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onToggle();
    infoButtonRef.current?.focus();
  };
  return (
    <div className={className} style={style} ref={infoRef} data-model={model.name} onKeyDown={onKeyDown}>
      <button
        ref={infoButtonRef}
        type="button"
        className="icon-button"
        onClick={onToggle}
        aria-label={t("modelChain.info", { model: meta.name })}
        aria-expanded={open}
        aria-controls={open && !phone ? popoverId : undefined}
        aria-haspopup={phone ? "dialog" : undefined}
        data-testid={testId}
      >
        <InfoIcon width={iconSize} height={iconSize} />
      </button>
      {open && phone && <ModelInfoDialog meta={meta} model={model} chain={chain} onClose={onToggle} />}
      {open && !phone && (
        <ModelInfoPopover id={popoverId} {...(bounds ? { bounds } : {})}>
          <ModelInfoContent meta={meta} model={model} chain={chain} />
        </ModelInfoPopover>
      )}
    </div>
  );
}
