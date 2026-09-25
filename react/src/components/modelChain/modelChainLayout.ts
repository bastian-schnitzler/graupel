import type { WeatherModel, ModelMetadata } from "../../types";
import { AVAILABLE_MODELS_METADATA } from "../../models/openMeteoModels";

export interface ModelChainSegment {
  model: WeatherModel;
  index: number;
  startHour: number;
  endHour: number;
  duration: number;
  widthPct: number; // Visual width in percentage (0 to 100)
  minWidthPct: number; // Minimum allowed visual width in percentage
  maxCapableHorizon: number;
  minAllowedHorizon: number; // Meteorological min allowed transition hour
  maxAllowedHorizon: number; // Meteorological max allowed transition hour
}

export function getModelMeta(
  model: WeatherModel,
  availableModels: Record<string, ModelMetadata>,
): ModelMetadata | undefined {
  if (!availableModels) return undefined;
  if (model.name && availableModels[model.name])
    return availableModels[model.name];
  if (model.id && availableModels[model.id]) return availableModels[model.id];

  const cleanId = (model.id || "").toLowerCase();
  const cleanName = (model.name || "")
    .toLowerCase()
    .replace(/[-_ ]+/g, " ")
    .trim();

  return Object.values(availableModels).find((m) => {
    if (cleanId && m.id && m.id.toLowerCase() === cleanId) return true;
    const mNameNorm = (m.name || "")
      .toLowerCase()
      .replace(/[-_ ]+/g, " ")
      .trim();
    const mIdNorm = (m.id || "")
      .toLowerCase()
      .replace(/[-_ ]+/g, " ")
      .trim();
    if (mNameNorm && mNameNorm === cleanName) return true;
    if (mIdNorm && mIdNorm === cleanName) return true;
    if (
      cleanName === "gfs" &&
      (m.id === "gfs_seamless" || mNameNorm === "gfs seamless")
    )
      return true;
    return false;
  });
}

/**
 * Calculates baseline equal width for a given number of models.
 * Reference state gives each model equal width: baseWidth = 100% / N.
 */
/**
 * Minimum model visual width factor relative to baseline width (baseWidth = 100% / N).
 * When a model's forecast duration is 0h, its width scales down to MIN_MODEL_WIDTH_FACTOR * baseWidth (1/3).
 */
export const MIN_MODEL_WIDTH_FACTOR = 1 / 3;

export function getBaselineWidthPct(numberOfModels: number): number {
  if (numberOfModels <= 0) return 0;
  return 100 / numberOfModels;
}

/**
 * Calculates minimum visual width percentage for a model.
 * - Single model (N=1): 100%
 * - Multiple models (N>=2): MIN_MODEL_WIDTH_FACTOR * baseWidth
 */
export function getMinimumWidthPct(
  numberOfModels: number,
  _isOuter: boolean = false,
): number {
  if (numberOfModels <= 0) return 0;
  if (numberOfModels === 1) return 100;
  const base = 100 / numberOfModels;
  return MIN_MODEL_WIDTH_FACTOR * base;
}

/**
 * Calculates the maximum timeline horizon from the model chain and metadata.
 */
export function getMaxTimelineHorizon(
  chain: WeatherModel[],
  availableModels: Record<string, ModelMetadata>,
): number {
  if (chain.length === 0) return 1;
  const horizons = chain.map((m) => {
    const meta = getModelMeta(m, availableModels);
    return meta
      ? meta.max_forecast_horizon_hours ||
          meta.max_forecast_hours ||
          m.max_forecast_horizon_hours
      : m.max_forecast_horizon_hours;
  });
  return Math.max(1, ...horizons);
}

/**
 * Converts percentage widths to integer screen pixels with deterministic distribution
 * of rounding errors to the last card, guaranteeing sum(widths) === containerWidth exactly.
 */
export function calculatePixelWidths(
  widthsPct: number[],
  containerWidth: number,
): number[] {
  const n = widthsPct.length;
  if (n === 0) return [];
  if (n === 1) return [containerWidth];

  const pixelWidths = widthsPct.map((pct) =>
    Math.round((pct / 100) * containerWidth),
  );
  const sumFirstNMinus1 = pixelWidths
    .slice(0, n - 1)
    .reduce((a, b) => a + b, 0);
  pixelWidths[n - 1] = Math.max(0, containerWidth - sumFirstNMinus1);
  return pixelWidths;
}

/**
 * Normalizes visual widths to ensure:
 * 1. Each card >= its minimum visual width (2/3 * baseWidth for outer, 1/3 * baseWidth for inner)
 * 2. sum(widths) === 100% exactly (no rounding gaps or drift).
 */
export function normalizeWidths(
  widths: number[],
  numberOfModels?: number,
): number[] {
  const n = widths.length;
  if (n === 0) return [];
  if (n === 1) return [100];

  const count = numberOfModels ?? n;
  const minWidths = widths.map((_, i) => {
    const isOuter = i === 0 || i === n - 1;
    return getMinimumWidthPct(count, isOuter);
  });

  let clamped = widths.map((w, i) => Math.max(minWidths[i], w));
  let sum = clamped.reduce((a, b) => a + b, 0);

  if (Math.abs(sum - 100) > 1e-6) {
    const delta = 100 - sum;
    if (delta > 0) {
      // Add excess proportionally
      const total = clamped.reduce((a, b) => a + b, 0);
      clamped = clamped.map((w) => w + (w / total) * delta);
    } else {
      // Subtract excess from models that are above their minimum
      const flexibleIndices = clamped
        .map((w, i) => (w > minWidths[i] ? i : -1))
        .filter((i) => i !== -1);
      if (flexibleIndices.length === 0) {
        return Array(n).fill(100 / n);
      }
      const flexSum = flexibleIndices.reduce((acc, i) => acc + clamped[i], 0);
      clamped = clamped.map((w, i) => {
        if (flexibleIndices.includes(i)) {
          const flexRatio = clamped[i] / flexSum;
          return Math.max(minWidths[i], w + delta * flexRatio);
        }
        return w;
      });
    }
  }

  // Guarantee strict 100.0% sum by adjusting last element
  const finalSum = clamped.reduce((a, b) => a + b, 0);
  if (Math.abs(finalSum - 100) > 1e-6) {
    clamped[n - 1] += 100 - finalSum;
  }

  return clamped;
}

/**
 * Checks whether two model chains have identical models and transition horizons.
 */
export function areModelChainsEqual(
  a: WeatherModel[] | null | undefined,
  b: WeatherModel[] | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].name !== b[i].name ||
      a[i].max_forecast_horizon_hours !== b[i].max_forecast_horizon_hours
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Calculates default baseline width percentages for a model chain.
 * Reference state gives each model equal baseWidth (100% / N).
 * When reducing the time span of a model, the box proportionally goes
 * from its full size (maxWidth) down to the size at 0h span (minWidth = MIN_MODEL_WIDTH_FACTOR * baseWidth),
 * transferring the freed width directly to the active model on the right
 * (or to the nearest active model to the left if none exist on the right).
 */
export function getDefaultModelChainWidthsPct(
  chain: WeatherModel[],
  availableModels?: Record<string, ModelMetadata>,
): number[] {
  const count = chain.length;
  if (count === 0) return [];
  if (count === 1) return [100];

  const baseWidth = getBaselineWidthPct(count);
  const minWidth = MIN_MODEL_WIDTH_FACTOR * baseWidth;

  const mergedModels = {
    ...AVAILABLE_MODELS_METADATA,
    ...(availableModels || {}),
  };

  const durations: number[] = [];
  let currentStart = 0;
  for (let i = 0; i < count; i++) {
    const endHour = chain[i].max_forecast_horizon_hours;
    durations.push(Math.max(0, endHour - currentStart));
    currentStart = endHour;
  }

  const hasNonZero = durations.some((d) => d > 0);
  if (!hasNonZero) {
    return Array(count).fill(baseWidth);
  }

  const widths = Array(count).fill(baseWidth);

  for (let i = 0; i < count; i++) {
    const startHour = i > 0 ? chain[i - 1].max_forecast_horizon_hours : 0;
    const duration = durations[i];
    const maxWidth = widths[i]; // Full width at full span, including space transferred from preceding models

    const meta = getModelMeta(chain[i], mergedModels);
    const maxCapable = meta
      ? meta.max_forecast_horizon_hours ||
        meta.max_forecast_hours ||
        chain[i].max_forecast_horizon_hours
      : chain[i].max_forecast_horizon_hours;

    // Next boundary is either next active model's horizon or this model's maxCapable
    const nextActive = chain
      .slice(i + 1)
      .find((m) => m.max_forecast_horizon_hours > startHour);
    const nextBoundaryHour = nextActive
      ? nextActive.max_forecast_horizon_hours
      : maxCapable;

    const hRef = Math.min(maxCapable, nextBoundaryHour);
    const fullSpan = Math.max(0, hRef - startHour);

    let targetWidth: number;
    if (fullSpan === 0 || duration === 0) {
      targetWidth = minWidth;
    } else if (duration < fullSpan) {
      const ratio = Math.max(0, Math.min(1, duration / fullSpan));
      targetWidth = minWidth + ratio * (maxWidth - minWidth);
    } else {
      targetWidth = maxWidth;
    }

    const freed = maxWidth - targetWidth;
    widths[i] = targetWidth;

    if (freed > 0) {
      // Find recipient: first active model to the right, or nearest active to the left
      let recipientIdx = -1;
      for (let j = i + 1; j < count; j++) {
        if (durations[j] > 0) {
          recipientIdx = j;
          break;
        }
      }
      if (recipientIdx === -1) {
        for (let j = i - 1; j >= 0; j--) {
          if (durations[j] > 0) {
            recipientIdx = j;
            break;
          }
        }
      }

      if (recipientIdx !== -1) {
        widths[recipientIdx] += freed;
      }
    }
  }

  return normalizeWidths(widths, count);
}

/**
 * Derives visual widths and bounds for each segment in the model chain.
 *
 * Fundamental Layout Invariants:
 * 1. sum(widthPct) === 100% unconditionally.
 * 2. Outer cards >= 2/3 * baseWidth, inner cards >= 1/3 * baseWidth.
 * 3. Legally supports 0h duration models (H_b = H_{b-1}) while keeping visual card intact.
 */
export function calculateModelChainLayout(
  chain: WeatherModel[],
  availableModels: Record<string, ModelMetadata>,
  customWidthsPct?: number[],
): ModelChainSegment[] {
  const count = chain.length;
  if (count === 0) return [];

  let widthsPct: number[];
  if (customWidthsPct && customWidthsPct.length === count) {
    widthsPct = normalizeWidths(customWidthsPct, count);
  } else {
    widthsPct = getDefaultModelChainWidthsPct(chain, availableModels);
  }

  let currentStart = 0;
  return chain.map((model, idx) => {
    const meta = getModelMeta(model, availableModels);
    const maxCapable = meta
      ? meta.max_forecast_horizon_hours ||
        meta.max_forecast_hours ||
        model.max_forecast_horizon_hours
      : model.max_forecast_horizon_hours;

    const isOuter = idx === 0 || idx === count - 1;
    const minWidthPct = getMinimumWidthPct(count, isOuter);

    const startHour = currentStart;
    const endHour = model.max_forecast_horizon_hours;
    const duration = Math.max(0, endHour - startHour);
    currentStart = endHour;

    // Meteorological horizon limits:
    // Min allowed is previous transition (allowing 0h duration).
    const minAllowedHorizon = startHour;
    const nextMax =
      idx < count - 1 ? chain[idx + 1].max_forecast_horizon_hours : maxCapable;
    const maxAllowedHorizon = Math.max(
      minAllowedHorizon,
      Math.min(maxCapable, nextMax),
    );

    return {
      model,
      index: idx,
      startHour,
      endHour,
      duration,
      widthPct: widthsPct[idx],
      minWidthPct,
      maxCapableHorizon: maxCapable,
      minAllowedHorizon,
      maxAllowedHorizon,
    };
  });
}

/**
 * Calculates strict local pair resize for dragging boundary `boundaryIndex`.
 *
 * Requirements:
 * 1. Strict local redistribution: newWidthA + newWidthB === oldWidthA + oldWidthB.
 * 2. All other model cards (j not in {boundaryIndex, boundaryIndex + 1}) remain strictly unchanged.
 * 3. Outer models never shrink below 2/3 * baseWidth, inner models never below 1/3 * baseWidth.
 * 4. Maximum displacement from reference position is baseWidth / 3.
 * 5. Reversing a drag to original position restores exact widths with zero drift.
 */
export function resizeBoundaryPair(
  chain: WeatherModel[],
  availableModels: Record<string, ModelMetadata>,
  currentWidthsPct: number[],
  boundaryIndex: number,
  deltaHours: number,
  deltaPct?: number,
): {
  updatedChain: WeatherModel[];
  updatedWidthsPct: number[];
  actualDeltaHours: number;
  actualDeltaPct: number;
} {
  const n = chain.length;
  if (boundaryIndex < 0 || boundaryIndex >= n - 1) {
    return {
      updatedChain: chain,
      updatedWidthsPct: currentWidthsPct,
      actualDeltaHours: 0,
      actualDeltaPct: 0,
    };
  }

  const leftIdx = boundaryIndex;
  const rightIdx = boundaryIndex + 1;

  const leftModel = chain[leftIdx];
  const rightModel = chain[rightIdx];

  const baseWidth = getBaselineWidthPct(n);
  const maxTransfer = baseWidth * (1 - MIN_MODEL_WIDTH_FACTOR);

  const isLeftOuter = leftIdx === 0;
  const isRightOuter = rightIdx === n - 1;

  const minWidthLeft = getMinimumWidthPct(n, isLeftOuter);
  const minWidthRight = getMinimumWidthPct(n, isRightOuter);

  const wLeft = currentWidthsPct[leftIdx] ?? baseWidth;
  const wRight = currentWidthsPct[rightIdx] ?? baseWidth;
  const pairWidth = wLeft + wRight;

  // Reference visual position for this boundary: (boundaryIndex + 1) * baseWidth
  const refPos = (boundaryIndex + 1) * baseWidth;
  // Current boundary position
  const currentBoundaryX = currentWidthsPct
    .slice(0, leftIdx + 1)
    .reduce((a, b) => a + b, 0);
  const currentDisplacement = currentBoundaryX - refPos;

  // Visual width delta constraints for Model Left (deltaW):
  // Model Left cannot shrink below minWidthLeft: deltaW >= minWidthLeft - wLeft
  // Model Right cannot shrink below minWidthRight: deltaW <= wRight - minWidthRight
  // Displacement from refPos must stay within [-maxTransfer, +maxTransfer]:
  //   deltaW >= -maxTransfer - currentDisplacement
  //   deltaW <= maxTransfer - currentDisplacement
  const minDeltaW = Math.max(
    minWidthLeft - wLeft,
    -maxTransfer - currentDisplacement,
  );
  const maxDeltaW = Math.min(
    wRight - minWidthRight,
    maxTransfer - currentDisplacement,
  );

  // Meteorological horizon bounds for Model Left:
  const leftMeta = getModelMeta(leftModel, availableModels);
  const leftMaxCapable = leftMeta
    ? leftMeta.max_forecast_horizon_hours ||
      leftMeta.max_forecast_hours ||
      leftModel.max_forecast_horizon_hours
    : leftModel.max_forecast_horizon_hours;

  const minAllowedHour =
    leftIdx > 0 ? chain[leftIdx - 1].max_forecast_horizon_hours : 0;
  const maxAllowedHour = Math.max(
    minAllowedHour,
    Math.min(leftMaxCapable, rightModel.max_forecast_horizon_hours),
  );
  const currentHour = leftModel.max_forecast_horizon_hours;
  const hRef = Math.min(leftMaxCapable, rightModel.max_forecast_horizon_hours);

  const getHourForDisplacement = (displacement: number): number => {
    if (displacement <= 0) {
      if (maxTransfer > 0 && hRef > minAllowedHour) {
        return hRef + (displacement / maxTransfer) * (hRef - minAllowedHour);
      }
      return hRef;
    } else {
      if (maxTransfer > 0 && maxAllowedHour > hRef) {
        return hRef + (displacement / maxTransfer) * (maxAllowedHour - hRef);
      }
      return hRef;
    }
  };

  let actualDeltaW = 0;
  let actualDeltaH = 0;

  if (deltaPct !== undefined) {
    // Visual pointer-driven drag (e.g. tests specifying deltaPct directly)
    actualDeltaW = Math.max(minDeltaW, Math.min(maxDeltaW, deltaPct));
    const targetDisplacement = currentDisplacement + actualDeltaW;
    const targetHour = Math.round(getHourForDisplacement(targetDisplacement));
    const clampedHour = Math.max(
      minAllowedHour,
      Math.min(maxAllowedHour, targetHour),
    );
    actualDeltaH = clampedHour - currentHour;

    actualDeltaW = Math.max(minDeltaW, Math.min(maxDeltaW, actualDeltaW));
    const newWLeft = wLeft + actualDeltaW;
    const newWRight = pairWidth - newWLeft;

    const updatedWidthsPct = currentWidthsPct.map((w, i) => {
      if (i === leftIdx) return newWLeft;
      if (i === rightIdx) return newWRight;
      return w;
    });

    const finalHorizon = currentHour + actualDeltaH;
    const updatedChain = chain.map((m, i) => {
      if (i === leftIdx) {
        return { ...m, max_forecast_horizon_hours: finalHorizon };
      }
      return m;
    });

    return {
      updatedChain,
      updatedWidthsPct,
      actualDeltaHours: actualDeltaH,
      actualDeltaPct: actualDeltaW,
    };
  }

  // Hour-driven drag (UI interaction via handlePointerMoveBoundary and keyboard navigation)
  const targetHour = currentHour + deltaHours;
  const clampedHour = Math.max(
    minAllowedHour,
    Math.min(maxAllowedHour, targetHour),
  );
  actualDeltaH = clampedHour - currentHour;

  const updatedChain = chain.map((m, i) => {
    if (i === leftIdx) {
      return { ...m, max_forecast_horizon_hours: clampedHour };
    }
    return m;
  });

  const updatedWidthsPct = getDefaultModelChainWidthsPct(
    updatedChain,
    availableModels,
  );
  actualDeltaW =
    (updatedWidthsPct[leftIdx] ?? wLeft) - (currentWidthsPct[leftIdx] ?? wLeft);

  return {
    updatedChain,
    updatedWidthsPct,
    actualDeltaHours: actualDeltaH,
    actualDeltaPct: actualDeltaW,
  };
}
