// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useConfig } from "../../config/index.ts";
import { infoTabLabel, useInfoDialog, type InfoTab } from "../../dialogs/index.ts";
import { useT } from "../../i18n/index.ts";
import { useAppMode } from "../../state/appMode.ts";
import { inIphoneSafari } from "../../state/browser.ts";
import { useFooterSlotRef } from "../../state/footerSlot.tsx";
import { usePhone } from "../../state/phoneLandscape.ts";
import "./Footer.css";

/** Footer links in display order: Info, imprint, data information (privacy), each opening its info tab. */
const LINKS: readonly InfoTab[] = ["about", "imprint", "privacy"];

/**
 * Footer (REQ-426, REQ-449): links to the info popup, opened at the matching tab; right-aligned, no card. At the start
 * of the row a slot, left-aligned, takes the meteogram's copy and save buttons on a phone (REQ-541). On a phone the row
 * leaves out "Info" (REQ-546). There the links take the size of the chart's source line and the buttons stand right
 * (REQ-550). Since REQ-582 the phone's row holds only the buttons, at its end: info, imprint and privacy are in the menu
 * at the end of the place row (REQ-580). The phone's row stands closer to the chart (REQ-577). In Safari on the iPhone
 * the page leaves room below the row for Safari's bottom bar (REQ-581); other browsers and the installed app have no
 * such bar and end with the row (REQ-611).
 */
export function Footer() {
  const t = useT();
  const { legal } = useConfig();
  const info = useInfoDialog();
  const slotRef = useFooterSlotRef();
  const phone = usePhone();
  const safariBar = useAppMode() === "website" && inIphoneSafari();
  // "Info" in the footer is the about tab and the short "Privacy" the privacy tab (REQ-484: the tab itself names the
  // full privacy policy); the imprint carries the label of its tab.
  const label = (tab: InfoTab) => {
    if (tab === "about") return t("footer.info");
    if (tab === "privacy") return t("footer.privacy");
    return infoTabLabel(tab, legal.imprint, t);
  };
  const slot = <div key="slot" className="footer__start" ref={slotRef} data-testid="footer-slot" />;
  return (
    <footer
      className={phone ? `region footer footer--phone${safariBar ? " footer--safari" : ""}` : "region footer"}
      data-region="footer"
      aria-labelledby="region-footer-title"
    >
      <h2 className="visually-hidden" id="region-footer-title">
        {t("region.footer.title")}
      </h2>
      <div className={phone ? "footer__row footer__row--phone" : "footer__row"}>
        {slot}
        {!phone && (
          <nav className="footer__nav" aria-labelledby="region-footer-title">
            <ul className="footer__links">
              {LINKS.map((tab) => (
                <li key={tab}>
                  <button type="button" className="footer__link" data-info-tab={tab} onClick={() => info.open(tab)}>
                    {label(tab)}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </footer>
  );
}
