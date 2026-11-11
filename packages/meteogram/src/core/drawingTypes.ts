// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/** Shared shapes of computed drawing items (viewBox units). */

export interface PanelBounds {
  top: number;
  height: number;
  left: number;
  width: number;
}

/** One visible day of the day header, clamped to the plot. */
export interface DayGroupRenderItem {
  dayKey: string;
  firstX: number;
  rightX: number;
  blockWidth: number;
  isEven: boolean;
  isBoundaryVisible: boolean;
  boundaryX: number;
  dateLabel: string;
  weekdayLabel: string;
}

/** 12:00 local noon marker of a day. */
export interface NoonPositionItem {
  dayKey: string;
  x: number;
}
