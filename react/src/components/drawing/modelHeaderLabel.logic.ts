/**
 * Text of an orange model header (system.md §16.7): always the catalogue nickname
 * (`short_name`) when the model has one, else the full name. The font size
 * follows the header box width.
 */

/** Font size the header box width allows (viewBox units). */
export function getModelHeaderFontSize(boxWidth: number): number {
  if (boxWidth < 40) return 7;
  if (boxWidth < 70) return 8.5;
  return 10;
}

export interface ModelHeaderLabel {
  text: string;
  fontSize: number;
  /** The nickname is shown instead of the full name. */
  shortened: boolean;
}

export function chooseModelHeaderLabel(
  fullLabel: string,
  shortLabel: string | null | undefined,
  boxWidth: number,
): ModelHeaderLabel {
  const fontSize = getModelHeaderFontSize(boxWidth);
  return shortLabel
    ? { text: shortLabel, fontSize, shortened: shortLabel !== fullLabel }
    : { text: fullLabel, fontSize, shortened: false };
}
