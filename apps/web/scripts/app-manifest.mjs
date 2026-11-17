// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Description and screenshots of the web app manifest (REQ-807). Edge and Chrome on the desktop show their own install
 * dialog; with only name and icon in the manifest it says little more than the name (Edge fills it with general points
 * about apps). With `description` and at least one screenshot with `form_factor: "wide"` both show their richer dialog
 * with our text and pictures; Chrome on Android does the same with "narrow" screenshots.
 *
 * What the browsers ask of the screenshots (Chromium's richer install UI): PNG or JPEG, width and height each 320 to
 * 3840 px, the longer side at most 2.3 times the shorter, all screenshots of one form factor with the same aspect
 * ratio, "wide" ones wider than high and "narrow" ones higher than wide; the desktop shows at most 8, Android at
 * most 5.
 * The description is cut after a few lines, so it stays short. `sizes` must name the real size of each picture.
 *
 * One build serves all domains, and the manifest is a static file, so it cannot follow the language a visitor picks
 * on the page. It is written in the language of the domain instead (`defaultLanguage` of its config.json): the build
 * keeps the English manifest (public/manifest.webmanifest, like the default config), and the copy of the site for a
 * domain replaces it with `localizedManifest` of the domain's language. The texts say what the reasons at the top of the
 * install dialog say (REQ-806). Screenshots exist in the languages of the domains (SCREENSHOT_LANGUAGES); other
 * languages use the English ones.
 *
 * The screenshots are made from the app with fake weather at a fixed time (e2e/manifest-screenshots.gen.ts).
 */

/** Folder of the screenshots in the site, outside the folders Apache maps elsewhere (RESERVED_FOLDERS). */
export const SCREENSHOT_FOLDER = "app-screenshots/";

/**
 * The screenshots per language: "wide" for the desktop, "narrow" for phones. `viewport` in CSS pixels, the picture is
 * `scale` times as large.
 */
export const SCREENSHOTS = [
  { name: "wide", form_factor: "wide", viewport: { width: 1280, height: 800 }, scale: 1, mobile: false },
  { name: "narrow", form_factor: "narrow", viewport: { width: 390, height: 844 }, scale: 2, mobile: true },
];

/** Languages with their own screenshots: those of the domains (defaultLanguage of apps/web/domains/*). */
export const SCREENSHOT_LANGUAGES = ["en", "de", "fr", "it"];

/** Language of the manifest when the domain's language has no text. */
export const MANIFEST_FALLBACK_LANGUAGE = "en";

/** Description and screenshot labels per language of the site (the 8 languages of src/i18n). */
export const MANIFEST_TEXT = {
  en: {
    description:
      "Weather forecasts as meteograms. Weather data you fetch stays in the history: view it offline or compare it with newer data. A better view on phone and tablet, without the browser’s address and navigation bars.",
    wide: "Meteogram with the forecast of several weather models",
    narrow: "Meteogram on the phone",
  },
  de: {
    description:
      "Wettervorhersagen als Meteogramme. Abgerufene Wetterdaten bleiben in der Historie: Du kannst sie offline ansehen oder mit neueren Daten vergleichen. Bessere Darstellung auf Telefon und Tablet, ohne Adress- und Navigationsleiste des Browsers.",
    wide: "Meteogramm mit der Vorhersage mehrerer Wettermodelle",
    narrow: "Meteogramm auf dem Telefon",
  },
  fr: {
    description:
      "Prévisions météo sous forme de météogrammes. Les données météo récupérées restent dans l’historique : vous pouvez les consulter hors ligne ou les comparer à des données plus récentes. Un meilleur affichage sur téléphone et tablette, sans les barres d’adresse et de navigation du navigateur.",
    wide: "Météogramme avec les prévisions de plusieurs modèles météo",
    narrow: "Météogramme sur le téléphone",
  },
  it: {
    description:
      "Previsioni del tempo come meteogrammi. I dati meteorologici scaricati restano nella cronologia: puoi vederli offline o confrontarli con dati più recenti. Una visualizzazione migliore su telefono e tablet, senza la barra degli indirizzi e di navigazione del browser.",
    wide: "Meteogramma con le previsioni di più modelli meteorologici",
    narrow: "Meteogramma sul telefono",
  },
  sl: {
    description:
      "Vremenske napovedi v obliki meteogramov. Pridobljeni vremenski podatki ostanejo v zgodovini: ogledate si jih lahko brez povezave ali jih primerjate z novejšimi. Boljši prikaz na telefonu in tablici, brez naslovne in navigacijske vrstice brskalnika.",
    wide: "Meteogram z napovedjo več vremenskih modelov",
    narrow: "Meteogram na telefonu",
  },
  cs: {
    description:
      "Předpovědi počasí jako meteogramy. Stažená data o počasí zůstávají v historii: můžete si je prohlédnout offline nebo je porovnat s novějšími daty. Lepší zobrazení na telefonu a tabletu, bez adresního řádku a navigační lišty prohlížeče.",
    wide: "Meteogram s předpovědí několika meteorologických modelů",
    narrow: "Meteogram na telefonu",
  },
  nl: {
    description:
      "Weersverwachtingen als meteogrammen. Opgehaalde weergegevens blijven in de geschiedenis: je kunt ze offline bekijken of met nieuwere gegevens vergelijken. Een betere weergave op telefoon en tablet, zonder de adres- en navigatiebalk van de browser.",
    wide: "Meteogram met de verwachting van meerdere weermodellen",
    narrow: "Meteogram op de telefoon",
  },
  da: {
    description:
      "Vejrudsigter som meteogrammer. Hentede vejrdata bliver i historikken: Du kan se dem offline eller sammenligne dem med nyere data. En bedre visning på telefon og tablet uden browserens adresselinje og navigationsbjælke.",
    wide: "Meteogram med udsigten fra flere vejrmodeller",
    narrow: "Meteogram på telefonen",
  },
};

/** The language whose texts a manifest for `language` gets: itself if there are texts for it, else English. */
export function manifestLanguage(language) {
  return Object.hasOwn(MANIFEST_TEXT, language) ? language : MANIFEST_FALLBACK_LANGUAGE;
}

/** Path of a screenshot in the site, relative to the manifest of the build. */
export const screenshotPath = (name, language) => `${SCREENSHOT_FOLDER}${name}-${language}.png`;

/** The manifest's `screenshots` for `language`: the pictures of that language or the English ones, labelled in it. */
export function manifestScreenshots(language) {
  const text = MANIFEST_TEXT[manifestLanguage(language)];
  const pictures = SCREENSHOT_LANGUAGES.includes(language) ? language : MANIFEST_FALLBACK_LANGUAGE;
  return SCREENSHOTS.map(({ name, form_factor, viewport, scale }) => ({
    src: screenshotPath(name, pictures),
    sizes: `${viewport.width * scale}x${viewport.height * scale}`,
    type: "image/png",
    form_factor,
    label: text[name],
  }));
}

/**
 * The manifest `text` (JSON) in `language`: `lang`, `description` and `screenshots` set, everything else as it is.
 * Returns JSON with two spaces and a final line break.
 */
export function localizedManifest(text, language) {
  const manifest = JSON.parse(text);
  const chosen = manifestLanguage(language);
  manifest.lang = chosen;
  manifest.description = MANIFEST_TEXT[chosen].description;
  manifest.screenshots = manifestScreenshots(chosen);
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
