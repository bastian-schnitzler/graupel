// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import type { ReactNode, Ref } from "react";
import "./AppLayout.css";

/** Slots of the base layout, one per page region. A slot left empty is not rendered. */
export interface AppLayoutProps {
  location?: ReactNode;
  header?: ReactNode;
  modelChain?: ReactNode;
  /** The phone's history slider, directly above the day slider (REQ-685). */
  historySlider?: ReactNode;
  /** Day slider card between the model chain and the meteogram (REQ-499). */
  daySlider?: ReactNode;
  meteogram?: ReactNode;
  footer?: ReactNode;
  /** Place and header bar in a card; false leaves the card out, as on a phone (REQ-580). Default true. */
  topCard?: boolean;
  /**
   * Place row at the page's top edge, without the page's top margin, as on a phone in the browser: Safari leaves room
   * below its address bar itself (REQ-586). Default false.
   */
  flushTop?: boolean;
  /**
   * Tablet (REQ-728): the phone's design also where the page is wider than a phone's (`app--tablet`, which the
   * stylesheets' phone rules ask for besides the width), and held in landscape the phone's upright view over the page's
   * whole width (REQ-750). Default false.
   */
  tablet?: boolean;
  /** Place row and the desktop's header bar side by side whatever the width, as on a tablet (REQ-731). Default false. */
  topRow?: boolean;
  /** Ref of the top row (place and header bar), which the tablet measures (REQ-731). */
  topRef?: Ref<HTMLDivElement>;
}

/**
 * Responsive page frame: stacked on narrow screens (header bar above the place); on wide screens location left and header right in one card,
 * followed by model chain, day slider and meteogram at full width, each its own card (on phones without a card, REQ-529), and the footer.
 */
export function AppLayout({
  location,
  header,
  modelChain,
  historySlider,
  daySlider,
  meteogram,
  footer,
  topCard = true,
  flushTop = false,
  tablet = false,
  topRow = false,
  topRef,
}: AppLayoutProps) {
  const topClass = ["app__top", ...(topCard ? [] : ["app__top--bare"]), ...(topRow ? ["app__top--row"] : [])].join(" ");
  return (
    <div className={tablet ? "app app--tablet" : "app"}>
      <div className={flushTop ? "app__inner app__inner--flush-top" : "app__inner"}>
        {(location != null || header != null) && (
          // One card for place and header bar, without a seam between them (REQ-450).
          <div ref={topRef} className={topClass}>
            {location != null && <div className="app__location">{location}</div>}
            {header != null && <div className="app__header">{header}</div>}
          </div>
        )}
        <main className="app__main">
          {modelChain}
          {historySlider}
          {daySlider}
          {meteogram}
        </main>
        {footer != null && <div className="app__footer">{footer}</div>}
      </div>
    </div>
  );
}
