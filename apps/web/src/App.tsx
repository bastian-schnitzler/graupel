// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { NoticesProvider } from "./components/ErrorCards.tsx";
import { useConfig } from "./config/index.ts";
import { DialogsProvider } from "./dialogs/index.ts";
import { I18nProvider, useT } from "./i18n/index.ts";
import { AppLayout, useTopRowFits } from "./layout/index.ts";
import { DaySlider } from "./regions/DaySlider/index.ts";
import { Footer } from "./regions/Footer/index.ts";
import { HeaderContainer, PhoneMenu } from "./regions/Header/index.ts";
import { HistorySlider } from "./regions/History/index.ts";
import { LocationPicker } from "./regions/LocationPicker/index.ts";
import { MeteogramPanel } from "./regions/MeteogramPanel/index.ts";
import { ModelChain } from "./regions/ModelChain/index.ts";
import { SliderCaptionProvider } from "./state/sliderCaption.tsx";
import { FooterSlotProvider } from "./state/footerSlot.tsx";
import { usePhone } from "./state/phoneLandscape.ts";
import {
  ChainProvider,
  DaySelectionProvider,
  ForecastProvider,
  HistoryProvider,
  LocationProvider,
  useAppMode,
  useDaySlider,
  useTablet,
} from "./state/index.ts";

function PageTitle() {
  const t = useT();
  return <h1 className="visually-hidden">{t("app.title")}</h1>;
}

/** Day slider card (REQ-499), left out while the slider is switched off (settings or configuration, REQ-473). */
function DaySliderCard() {
  return useDaySlider().enabled ? <DaySlider /> : null;
}

/** Composes the page regions into the base layout; regions switched off in the configuration are left out. */
export function App() {
  const config = useConfig();
  // A phone has no header bar and no card around the place row: language, settings, info and the installation are in
  // the menu at the end of that row (REQ-575, REQ-580).
  const phone = usePhone();
  // A tablet has the phone's design (REQ-728) with the desktop's header bar beside the place row, without the menu, as
  // long as its buttons fit there side by side; else the phone's place row with the menu (REQ-731). That row looks as
  // on the desktop: in its card, the search field as wide as there (REQ-748).
  const tablet = useTablet();
  const [topRowFits, topRef] = useTopRowFits(tablet);
  const phoneTop = phone && !(tablet && topRowFits);
  // In the browser the place row stands at the page's top edge, below Safari's address bar; the installed app has no
  // such bar and keeps the page's top margin below the status bar (REQ-586). A tablet's row with the desktop's header
  // bar is the desktop's card (REQ-748) and keeps the margin as well.
  const mode = useAppMode();
  const flushTop = phoneTop && mode === "website";
  return (
    <I18nProvider languages={config.languages} fallbackLanguage={config.defaultLanguage}>
      <NoticesProvider>
        <DialogsProvider>
          <LocationProvider>
            <ChainProvider>
              <ForecastProvider>
                <DaySelectionProvider>
                  {/* The installed app archives each fetch and may show an archived one instead (REQ-684). */}
                  <HistoryProvider>
                    <PageTitle />
                    {/* The meteogram puts its copy and save buttons into the footer's row on a phone (REQ-541). */}
                    <FooterSlotProvider>
                      {/* On a phone it puts place and elevation between the day slider's grips (REQ-562). */}
                      <SliderCaptionProvider>
                        <AppLayout
                          location={<LocationPicker end={phoneTop ? <PhoneMenu /> : undefined} />}
                          header={phoneTop ? undefined : <HeaderContainer />}
                          topCard={!phoneTop}
                          topRow={tablet && !phoneTop}
                          topRef={topRef}
                          tablet={tablet}
                          flushTop={flushTop}
                          modelChain={config.modelChain ? <ModelChain /> : undefined}
                          historySlider={<HistorySlider />}
                          daySlider={<DaySliderCard />}
                          meteogram={<MeteogramPanel />}
                          footer={<Footer />}
                        />
                      </SliderCaptionProvider>
                    </FooterSlotProvider>
                  </HistoryProvider>
                </DaySelectionProvider>
              </ForecastProvider>
            </ChainProvider>
          </LocationProvider>
        </DialogsProvider>
      </NoticesProvider>
    </I18nProvider>
  );
}
