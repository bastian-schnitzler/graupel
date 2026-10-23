import React from "react";
import {
  DAY_RANGE_CHOICES,
  type DayRangeChoice,
} from "../../utils/meteogramZoom";

interface DayRangeButtonsProps {
  /** Highlighted choice (the visible range equals its span), if any. */
  active: DayRangeChoice | undefined;
  onChoose: (days: DayRangeChoice) => void;
  testId: string;
}

/**
 * Day-range buttons 4 / 7 / 10 / 14 days / All (system.md §16.1, #162). They sit
 * in the label row and are left out of the PNG export (`data-export-skip`).
 */
export const DayRangeButtons: React.FC<DayRangeButtonsProps> = ({
  active,
  onChoose,
  testId,
}) => (
  <div
    className="day-range-buttons"
    role="group"
    aria-label="Visible days"
    data-export-skip="true"
    data-testid={testId}
    // Double click toggles fullscreen on the chart container.
    onDoubleClick={(e) => e.stopPropagation()}
  >
    {DAY_RANGE_CHOICES.map((days) => {
      const label = days === null ? "All" : `${days}d`;
      return (
        <button
          key={label}
          type="button"
          className={`day-range-btn${active === days ? " active" : ""}`}
          aria-pressed={active === days}
          title={days === null ? "Whole forecast" : `${days} days`}
          onClick={() => onChoose(days)}
        >
          {label}
        </button>
      );
    })}
  </div>
);
