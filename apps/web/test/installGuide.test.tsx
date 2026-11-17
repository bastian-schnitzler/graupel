// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Install steps with pictures by device, browser and version (REQ-775), from a table of real user agent strings like
 * locationHint.test.ts; browsers that cannot install at all keep the hint without pictures (REQ-658).
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstallDialog } from "../src/dialogs/index.ts";
import { InstallPicture, labelLines } from "../src/dialogs/install/InstallPicture.tsx";
import { I18nProvider, LANGUAGES, MESSAGES, translate, type Language } from "../src/i18n/index.ts";
import type { NavigatorLike } from "../src/state/browser.ts";
import {
  installGuide,
  type InstallDevice,
  type InstallGuide,
  type InstallGuideId,
  type InstallHint,
  type InstallNote,
  type InstallPicture as PictureName,
} from "../src/state/index.ts";

afterEach(cleanup);

type Expected =
  | { guide: InstallGuideId; device: InstallDevice; first: PictureName; note?: InstallNote }
  | { hint: InstallHint };

/** Real user agents of the browsers in question (the iPad's Safari asks for desktop pages with a Mac's). */
const CASES: readonly [string, NavigatorLike, Expected][] = [
  [
    "iPhone Safari, iOS 17",
    {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    },
    { guide: "iphoneSafari", device: "iphone", first: "safariBarBottom" },
  ],
  [
    "iPhone Safari, iOS 18",
    {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    },
    { guide: "iphoneSafari", device: "iphone", first: "safariBarBottom" },
  ],
  [
    "iPhone Safari, iOS 26 (OS frozen at 18_6, real version in Version/)",
    {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    },
    { guide: "iphoneSafari26", device: "iphone", first: "safariShareOrMore" },
  ],
  [
    "iPhone Safari, iOS 26.2 (OS frozen at 18_7)",
    {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    },
    { guide: "iphoneSafari26", device: "iphone", first: "safariShareOrMore" },
  ],
  [
    "iPhone Chrome, iOS 18",
    {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    },
    { guide: "iosChrome", device: "iphone", first: "addressShare" },
  ],
  [
    "iPhone Chrome, iOS 16.2 (before other browsers could add to the home screen)",
    {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/108.0.5359.112 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    },
    { hint: "iosSafari" },
  ],
  [
    "iPhone Chrome, iOS 16.4",
    {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/112.0.5615.46 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    },
    { guide: "iosChrome", device: "iphone", first: "addressShare" },
  ],
  [
    "iPhone Chrome, iOS 26",
    {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.7444.128 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    },
    { guide: "iosChrome", device: "iphone", first: "addressShare" },
  ],
  [
    "iPhone Edge, iOS 26",
    {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/142.0.3595.66 Version/26.0 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    },
    { guide: "iosEdge", device: "iphone", first: "addressShare" },
  ],
  [
    "iPhone Firefox, iOS 26",
    {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/145.0 Mobile/15E148 Safari/605.1.15",
      maxTouchPoints: 5,
    },
    { guide: "iosFirefox", device: "iphone", first: "firefoxMenu" },
  ],
  [
    "iPhone Edge, iOS 17",
    {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/126.0.2592.56 Version/17.0 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    },
    { guide: "iosEdge", device: "iphone", first: "addressShare" },
  ],
  [
    "iPhone Firefox, iOS 17",
    {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
      maxTouchPoints: 5,
    },
    { guide: "iosFirefox", device: "iphone", first: "firefoxMenu" },
  ],
  [
    "iPhone Opera",
    {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1 OPT/4.8.0",
      maxTouchPoints: 5,
    },
    { hint: "ios" },
  ],
  [
    "iPadOS Safari 18, desktop user agent with touch screen",
    {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      maxTouchPoints: 5,
    },
    { guide: "ipadSafari", device: "ipad", first: "safariBarTop" },
  ],
  [
    "iPadOS Safari 26, desktop user agent with touch screen",
    {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
      maxTouchPoints: 5,
    },
    { guide: "ipadSafari", device: "ipad", first: "safariBarTop", note: "ipad26" },
  ],
  [
    "iPad Safari, iPadOS 16 mobile user agent",
    {
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    },
    { guide: "ipadSafari", device: "ipad", first: "safariBarTop" },
  ],
  [
    "iPad Chrome",
    {
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    },
    { guide: "iosChrome", device: "ipad", first: "addressShare" },
  ],
  [
    "iPad Chrome, iPadOS 26",
    {
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.7444.128 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    },
    { guide: "iosChrome", device: "ipad", first: "addressShare" },
  ],
  [
    "iPad Firefox",
    {
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
      maxTouchPoints: 5,
    },
    { guide: "iosFirefox", device: "ipad", first: "firefoxMenu" },
  ],
  [
    "Mac Safari 18",
    {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      maxTouchPoints: 0,
    },
    { guide: "macSafari", device: "mac", first: "macMenuBar", note: "mac" },
  ],
  [
    "Mac Safari 26",
    {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
      maxTouchPoints: 0,
    },
    { guide: "macSafari", device: "mac", first: "macMenuBar", note: "mac" },
  ],
  [
    "Mac Safari 16 (no Add to Dock before macOS Sonoma)",
    {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
      maxTouchPoints: 0,
    },
    { hint: "macosUpdate" },
  ],
  [
    "Mac Firefox",
    { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:128.0) Gecko/20100101 Firefox/128.0", maxTouchPoints: 0 },
    { hint: "macosOther" },
  ],
  [
    "Android Samsung Internet",
    {
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
      maxTouchPoints: 5,
    },
    { guide: "androidSamsung", device: "android", first: "samsungMenu" },
  ],
  [
    "Android Samsung Internet, reduced user agent",
    {
      userAgent:
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
      maxTouchPoints: 5,
    },
    { guide: "androidSamsung", device: "android", first: "samsungMenu" },
  ],
  [
    "Android Firefox",
    { userAgent: "Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0", maxTouchPoints: 5 },
    { guide: "androidFirefox", device: "android", first: "androidMenu" },
  ],
  [
    "Android Firefox 145, phone",
    { userAgent: "Mozilla/5.0 (Android 15; Mobile; rv:145.0) Gecko/145.0 Firefox/145.0", maxTouchPoints: 5 },
    { guide: "androidFirefox", device: "android", first: "androidMenu" },
  ],
  [
    "Android Firefox 145, tablet",
    { userAgent: "Mozilla/5.0 (Android 14; Tablet; rv:145.0) Gecko/145.0 Firefox/145.0", maxTouchPoints: 10 },
    { guide: "androidFirefox", device: "android", first: "androidMenu" },
  ],
  [
    "Android Chrome without install prompt",
    {
      userAgent:
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
      maxTouchPoints: 5,
    },
    { hint: "android" },
  ],
  [
    "Windows Firefox",
    { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0", maxTouchPoints: 0 },
    { hint: "desktop" },
  ],
  [
    "Linux Firefox",
    { userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0", maxTouchPoints: 0 },
    { hint: "desktop" },
  ],
];

describe("install guide by user agent (REQ-775)", () => {
  it.each(CASES)("%s", (_name, nav, expected) => {
    const guide = installGuide(nav);
    if ("hint" in expected) {
      // REQ-658: no pictures, only the hint.
      expect(guide).toEqual({ kind: "hint", hint: expected.hint });
      return;
    }
    expect(guide.kind).toBe("steps");
    if (guide.kind !== "steps") return;
    expect(guide.guide).toBe(expected.guide);
    expect(guide.device).toBe(expected.device);
    // Safari from iOS 26 on the iPhone has the extra step "Show More" (REQ-844), Firefox on Android "More" (REQ-847).
    expect(guide.steps).toHaveLength(expected.guide === "iphoneSafari26" || expected.guide === "androidFirefox" ? 4 : 3);
    expect(guide.steps[0]).toBe(expected.first);
    expect(guide.note).toBe(expected.note);
  });

  it("ends with Add to Home Screen and the home screen on the iPhone and iPad, Add to Dock and the Dock on the Mac", () => {
    for (const [, nav, expected] of CASES) {
      const guide = installGuide(nav);
      if (guide.kind !== "steps") continue;
      if ("device" in expected && (expected.device === "iphone" || expected.device === "ipad")) {
        expect(guide.steps.slice(-2)).toEqual(["shareSheet", "homeScreen"]);
      }
    }
    const mac = installGuide({ userAgent: CASES.find(([name]) => name === "Mac Safari 18")![1].userAgent, maxTouchPoints: 0 });
    expect(mac.kind === "steps" && mac.steps).toEqual(["macMenuBar", "macFileMenu", "dock"]);
  });
});

const steps = (nav: NavigatorLike) => installGuide(nav) as Extract<InstallGuide, { kind: "steps" }>;
const chrome = steps(CASES.find(([name]) => name === "iPhone Chrome, iOS 18")![1]);

function renderDialog(guide: InstallGuide, language: Language = "en", onInstall?: () => void) {
  return render(
    <I18nProvider languages={[...LANGUAGES]} fallbackLanguage="en" browserLanguages={[language]}>
      <InstallDialog guide={guide} onClose={() => {}} onInstall={onInstall} />
    </I18nProvider>,
  );
}

const mac = steps(CASES.find(([name]) => name === "Mac Safari 18")![1]);

/** The heading "Why install?" that REQ-843 removed, as it read in each language. */
const OLD_HEADINGS: Readonly<Record<Language, string>> = {
  de: "Warum installieren?",
  en: "Why install?",
  fr: "Pourquoi installer ?",
  it: "Perché installare?",
  sl: "Zakaj namestiti?",
  cs: "Proč instalovat?",
  nl: "Waarom installeren?",
  da: "Hvorfor installere?",
};

/**
 * Why install (REQ-806): both points first in the dialog's body, before what follows them; since REQ-843 a list
 * without heading, the dialog's title the only heading.
 */
function expectReasons(language: Language, following: string) {
  const dialog = screen.getByRole("dialog", { name: translate(language, "install.title") });
  const section = within(dialog).getByTestId("install-why");
  expect(section.tagName).toBe("UL");
  expect(within(dialog).getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
    translate(language, "install.title"),
  ]);
  expect(dialog.textContent).not.toContain(OLD_HEADINGS[language]);
  expect(within(section).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    translate(language, "install.why.history"),
    translate(language, "install.why.display"),
  ]);
  expect(section.parentElement?.firstElementChild).toBe(section);
  const next = dialog.querySelector(following)!;
  expect(next).toBeTruthy();
  expect(section.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  return dialog;
}

describe("why install (REQ-806), without heading (REQ-843)", () => {
  it.each(LANGUAGES)("comes before the steps with pictures in %s", (language) => {
    renderDialog(chrome, language);
    expectReasons(language, "[data-guide]");
    cleanup();
    renderDialog(mac, language);
    expectReasons(language, "[data-guide]");
  });

  it.each(LANGUAGES)("comes before the hint without pictures in %s (REQ-658)", (language) => {
    renderDialog({ kind: "hint", hint: "desktop" }, language);
    expectReasons(language, '[data-platform="desktop"]');
  });

  it.each(LANGUAGES)("comes before the button of the browser's own prompt in %s", (language) => {
    const onInstall = vi.fn();
    renderDialog({ kind: "hint", hint: "desktop" }, language, onInstall);
    const dialog = expectReasons(language, "[data-prompt]");
    // With the browser's own prompt neither steps nor hint, only its button.
    expect(dialog.querySelector("[data-guide], [data-platform]")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: translate(language, "install.start") }));
    expect(onInstall).toHaveBeenCalledOnce();
  });

  it.each(LANGUAGES)("has its own short texts in %s", (language) => {
    for (const key of ["install.why.history", "install.why.display", "install.start"] as const) {
      const text = translate(language, key);
      expect(text.length).toBeGreaterThan(0);
      if (language !== "en") expect(text).not.toBe(translate("en", key));
    }
    // The history kept offline and compared, and the page without the browser's address and navigation bars (REQ-852):
    // two short points.
    expect(translate(language, "install.why.history").length).toBeLessThan(150);
    expect(translate(language, "install.why.display").length).toBeLessThan(120);
  });
});

/** The second reason as Bastian worded it (REQ-852), in every language. */
const DISPLAY_REASON: Readonly<Record<Language, string>> = {
  de: "Bessere Darstellung auf Telefon und Tablet, ohne Adress- und Navigationsleiste des Browsers.",
  en: "A better view on phone and tablet, without the browser’s address and navigation bars.",
  fr: "Un meilleur affichage sur téléphone et tablette, sans les barres d’adresse et de navigation du navigateur.",
  it: "Una visualizzazione migliore su telefono e tablet, senza la barra degli indirizzi e di navigazione del browser.",
  sl: "Boljši prikaz na telefonu in tablici, brez naslovne in navigacijske vrstice brskalnika.",
  cs: "Lepší zobrazení na telefonu a tabletu, bez adresního řádku a navigační lišty prohlížeče.",
  nl: "Een betere weergave op telefoon en tablet, zonder de adres- en navigatiebalk van de browser.",
  da: "En bedre visning på telefon og tablet uden browserens adresselinje og navigationsbjælke.",
};

describe("install dialog wording (REQ-852)", () => {
  it.each(LANGUAGES)("the second reason names the browser's address and navigation bars in %s", (language) => {
    expect(translate(language, "install.why.display")).toBe(DISPLAY_REASON[language]);
    renderDialog(chrome, language);
    expect(within(screen.getByTestId("install-why")).getAllByRole("listitem")[1]?.textContent).toBe(DISPLAY_REASON[language]);
  });

  // DEC-179: no hint "Show More", neither as a note nor as a footnote. Since REQ-844 Safari on the iPhone from iOS 26 has
  // "Show More" as a step of its own; every other guide, iOS 26 included, shows its steps without a mark or extra line.
  it.each(LANGUAGES)("shows no footnote and no superscript number in any guide in %s (DEC-179)", (language) => {
    for (const [name, nav] of CASES) {
      const guide = installGuide(nav);
      if (guide.kind !== "steps") continue;
      const { unmount } = renderDialog(guide, language);
      const dialog = screen.getByRole("dialog", { name: translate(language, "install.title") });
      expect(dialog.querySelector("sup"), name).toBeNull();
      expect(dialog.querySelector(".install-dialog__footnote, [data-footnote], [data-footnote-ref]"), name).toBeNull();
      expect(dialog.querySelector(".install-steps [aria-describedby]"), name).toBeNull();
      // Only the iPhone's Safari from iOS 26 names "Show More", in its step 2 and that step's picture.
      if (guide.guide !== "iphoneSafari26") {
        expect(dialog.textContent, name).not.toContain(translate(language, "install.ui.showMore"));
      }
      unmount();
    }
  });

  it("has no text for a hint “Show More” in any language (DEC-179)", () => {
    for (const language of LANGUAGES) {
      expect(Object.keys(MESSAGES[language]).filter((key) => key.startsWith("install.footnote.")), language).toEqual([]);
    }
  });
});

describe("install dialog with pictures (REQ-775)", () => {
  it.each(LANGUAGES)("Chrome on the iPhone in %s: three steps with pictures, no word of Safari", (language) => {
    renderDialog(chrome, language);
    const dialog = screen.getByRole("dialog", { name: translate(language, "install.title") });
    expect(dialog.querySelectorAll("li svg[data-picture]")).toHaveLength(3);
    expect(dialog.querySelectorAll("[data-hit]").length).toBeGreaterThanOrEqual(3);
    expect(dialog.textContent).toContain("Chrome");
    expect(dialog.textContent).toContain("iPhone");
    expect(dialog.textContent).not.toContain("Safari");
    // The menu entry in the picture is named in the page's language.
    expect(dialog.querySelector('[data-picture="shareSheet"]')?.textContent?.replace(/\s/g, "")).toBe(
      translate(language, "install.ui.addToHome").replace(/\s/g, ""),
    );
  });

  it.each(LANGUAGES)("every step has its text and every picture its labels in %s", (language) => {
    const pictures = new Set<string>();
    for (const [, nav] of CASES) {
      const guide = installGuide(nav);
      if (guide.kind !== "steps") continue;
      const { unmount } = renderDialog(guide, language);
      const items = [...document.querySelectorAll(".install-steps > li")];
      expect(items).toHaveLength(guide.steps.length);
      for (const [index, item] of items.entries()) {
        const picture = guide.steps[index]!;
        pictures.add(picture);
        expect(item.querySelector(`svg[data-picture="${picture}"]`)).toBeTruthy();
        expect(item.querySelector("[data-hit]")).toBeTruthy();
        expect(item.querySelector(".install-step__text")?.textContent).toBe(translate(language, `install.step.${picture}`));
      }
      if (guide.note) expect(screen.getByText(translate(language, `install.note.${guide.note}`))).toBeTruthy();
      unmount();
    }
    expect(pictures.size).toBe(17);
  });

  it("names the Mac's menu and entry in the page's language", () => {
    const { unmount } = render(
      <I18nProvider languages={["de"]} fallbackLanguage="de" browserLanguages={["de"]}>
        <InstallPicture picture="macFileMenu" device="mac" />
      </I18nProvider>,
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("Ablage");
    expect(text.replace(/\s/g, "")).toContain("ZumDockhinzufügen…");
    unmount();
  });

  it("keeps the hint without pictures for a browser that cannot install (REQ-658)", () => {
    renderDialog({ kind: "hint", hint: "desktop" });
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("svg[data-picture]")).toBeNull();
    expect(dialog.querySelector('[data-platform="desktop"]')?.textContent).toBe(translate("en", "install.desktop"));
  });
});

describe("Safari from iOS 26 on the iPhone: Share in the bar first, then “…” (REQ-808)", () => {
  const ios26 = steps(CASES.find(([name]) => name.startsWith("iPhone Safari, iOS 26 "))![1]);
  const ios18 = steps(CASES.find(([name]) => name === "iPhone Safari, iOS 18")![1]);

  it.each(LANGUAGES)("step 1 names Share in the bar first and “…” second, no note below the steps (REQ-844), in %s", (language) => {
    expect(ios26.steps[0]).toBe("safariShareOrMore");
    renderDialog(ios26, language);
    const first = document.querySelector(".install-steps > li .install-step__text")?.textContent ?? "";
    expect(first).toBe(translate(language, "install.step.safariShareOrMore"));
    const share = translate(language, "install.ui.share");
    expect(first).toContain(share);
    expect(first).toContain("…");
    expect(first.indexOf(share)).toBeLessThan(first.indexOf("…"));
    // The note "look under More" gave way to the step "Show More" (REQ-844).
    expect(ios26.note).toBeUndefined();
    expect(document.querySelector(".install-dialog__note")).toBeNull();
  });

  it("highlights Share in the toolbar at the bottom and the compact bar's “…” as a smaller second hint", () => {
    renderDialog(ios26);
    const picture = document.querySelector('svg[data-picture="safariShareOrMore"]')!;
    const hits = picture.querySelectorAll("[data-hit]");
    expect(hits).toHaveLength(1);
    // Share: the middle of the five buttons, in the toolbar at the bottom of the screen (125 units high).
    expect(Number(hits[0]!.getAttribute("cx"))).toBe(50);
    expect(Number(hits[0]!.getAttribute("cy"))).toBeGreaterThan(105);
    const hint = picture.querySelector("[data-compact-bar] [data-hint]")!;
    expect(hint.getAttribute("class")).toContain("ip-hit--second");
    expect(Number(hint.getAttribute("r"))).toBeLessThanOrEqual(Number(hits[0]!.getAttribute("r")));
    // No menu with Share any more: the label is not in the picture.
    expect(picture.textContent).toBe("");
  });

  it("leaves Safari up to iOS 18 and on the iPad as they are", () => {
    expect(ios18.steps).toEqual(["safariBarBottom", "shareSheet", "homeScreen"]);
    expect(ios18.note).toBeUndefined();
    const ipad = steps(CASES.find(([name]) => name === "iPadOS Safari 26, desktop user agent with touch screen")![1]);
    expect(ipad.steps[0]).toBe("safariBarTop");
    expect(ipad.note).toBe("ipad26");
  });
});

describe("Safari from iOS 26 on the iPhone: “Show More” before “Add to Home Screen” (REQ-844)", () => {
  const ios26 = steps(CASES.find(([name]) => name.startsWith("iPhone Safari, iOS 26 "))![1]);
  const ios262 = steps(CASES.find(([name]) => name.startsWith("iPhone Safari, iOS 26.2"))![1]);

  it("has the steps Share, Show More, Add to Home Screen and the home screen in this order", () => {
    expect(ios26.steps).toEqual(["safariShareOrMore", "shareSheetMore", "shareSheet", "homeScreen"]);
    expect(ios262.steps).toEqual(ios26.steps);
  });

  it("adds the step only there: Safari up to iOS 18, on the iPad and the other browsers keep their share sheet", () => {
    for (const [name, nav] of CASES) {
      const guide = installGuide(nav);
      if (guide.kind !== "steps" || guide.guide === "iphoneSafari26") continue;
      expect(guide.steps, name).not.toContain("shareSheetMore");
    }
  });

  it.each(LANGUAGES)("step 2 names “Show More” in the row of actions and its picture shows it, in %s", (language) => {
    renderDialog(ios26, language);
    const list = document.querySelector(".install-steps")!;
    expect(list.getAttribute("data-count")).toBe("4");
    const items = [...list.querySelectorAll(":scope > li")];
    expect(items.map((item) => item.querySelector(".install-step__number")?.textContent)).toEqual(["1", "2", "3", "4"]);
    const second = items[1]!;
    const text = second.querySelector(".install-step__text")?.textContent ?? "";
    const showMore = translate(language, "install.ui.showMore");
    expect(text).toBe(translate(language, "install.step.shareSheetMore"));
    expect(text).toContain(showMore);
    // The menu name in the page's language, in the step's picture too.
    const picture = second.querySelector('svg[data-picture="shareSheetMore"]')!;
    expect(picture.textContent?.replace(/\s/g, "")).toBe(showMore.replace(/\s/g, ""));
    // The next step is Add to Home Screen.
    expect(items[2]!.querySelector(".install-step__text")?.textContent).toBe(translate(language, "install.step.shareSheet"));
  });

  it.each(LANGUAGES)("has its own texts for the step in %s", (language) => {
    for (const key of ["install.step.shareSheetMore", "install.ui.showMore"] as const) {
      expect(translate(language, key).length).toBeGreaterThan(0);
      if (language !== "en") expect(translate(language, key)).not.toBe(translate("en", key));
    }
  });

  it("uses Apple's name of the button in German and English", () => {
    expect(translate("de", "install.ui.showMore")).toBe("Mehr anzeigen");
    expect(translate("en", "install.ui.showMore")).toBe("Show More");
  });

  it("highlights the round button at the end of the row of actions, below contacts and apps", () => {
    renderDialog(ios26);
    const picture = document.querySelector('svg[data-picture="shareSheetMore"]')!;
    const hits = picture.querySelectorAll("[data-hit]");
    expect(hits).toHaveLength(1);
    const actions = [...picture.querySelectorAll("[data-actions] > g")];
    expect(actions).toHaveLength(4);
    // The highlight belongs to the last of the four actions (Copy, Add Bookmark, Add to Reading List, Show More).
    expect(actions[3]!.contains(hits[0]!)).toBe(true);
    expect(Number(hits[0]!.getAttribute("cx"))).toBeGreaterThan(75);
    expect(Number(hits[0]!.getAttribute("cy"))).toBeGreaterThan(70);
  });
});

describe("Firefox on Android: menu, “More”, “Add app to Home screen” (REQ-847)", () => {
  const FIREFOX_ANDROID = CASES.filter(([name]) => name.startsWith("Android Firefox"));
  const phone = steps(CASES.find(([name]) => name === "Android Firefox 145, phone")![1]);

  it("has real user agents of phone and tablet in the table", () => {
    expect(FIREFOX_ANDROID.map(([, nav]) => nav.userAgent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Mobile;"), expect.stringContaining("Tablet;")]),
    );
  });

  it.each(FIREFOX_ANDROID)("%s: the steps menu, More, Add app to Home screen and the home screen", (_name, nav) => {
    const guide = steps(nav);
    expect(guide.guide).toBe("androidFirefox");
    expect(guide.device).toBe("android");
    expect(guide.browser).toBe("Firefox");
    expect(guide.steps).toEqual(["androidMenu", "firefoxMore", "firefoxAdd", "androidHome"]);
    expect(guide.note).toBeUndefined();
  });

  it("adds the step only there", () => {
    for (const [name, nav] of CASES) {
      const guide = installGuide(nav);
      if (guide.kind !== "steps" || guide.guide === "androidFirefox") continue;
      expect(guide.steps, name).not.toContain("firefoxMore");
      expect(guide.steps, name).not.toContain("firefoxAdd");
    }
  });

  it.each(LANGUAGES)("steps 2 and 3 name the entries as the browser does, also in their pictures, in %s", (language) => {
    renderDialog(phone, language);
    const list = document.querySelector(".install-steps")!;
    expect(list.getAttribute("data-count")).toBe("4");
    const items = [...list.querySelectorAll(":scope > li")];
    expect(items.map((item) => item.querySelector(".install-step__number")?.textContent)).toEqual(["1", "2", "3", "4"]);
    const text = (index: number) => items[index]!.querySelector(".install-step__text")?.textContent ?? "";
    const label = (picture: string) =>
      items.map((item) => item.querySelector(`svg[data-picture="${picture}"] [data-entry]`)).find(Boolean)?.textContent ?? "";
    const more = translate(language, "install.ui.more");
    const add = translate(language, "install.ui.addAppToHome");
    expect(text(0)).toBe(translate(language, "install.step.androidMenu"));
    expect(text(1)).toBe(translate(language, "install.step.firefoxMore"));
    expect(text(1)).toContain(more);
    expect(label("firefoxMore").replace(/\s/g, "")).toBe(more.replace(/\s/g, ""));
    expect(text(2)).toBe(translate(language, "install.step.firefoxAdd"));
    expect(text(2)).toContain(add);
    expect(label("firefoxAdd").replace(/\s/g, "")).toBe(add.replace(/\s/g, ""));
    expect(text(3)).toBe(translate(language, "install.step.androidHome"));
    // No more "Install" in a horizontal menu.
    expect(items[2]!.querySelector("svg")?.textContent).not.toContain(translate(language, "install.start"));
  });

  it.each(LANGUAGES)("has its own texts for the steps in %s", (language) => {
    for (const key of ["install.step.firefoxMore", "install.step.firefoxAdd", "install.ui.more", "install.ui.addAppToHome"] as const) {
      expect(translate(language, key).length).toBeGreaterThan(0);
      if (language !== "en") expect(translate(language, key)).not.toBe(translate("en", key));
    }
  });

  it("uses Firefox's names of the entries in German and English", () => {
    expect(translate("de", "install.ui.more")).toBe("Mehr");
    expect(translate("de", "install.ui.addAppToHome")).toBe("App zum Startbildschirm hinzufügen");
    expect(translate("de", "install.step.firefoxMore")).toBe("Im Menü auf „Mehr“ tippen");
    expect(translate("de", "install.step.firefoxAdd")).toBe("„App zum Startbildschirm hinzufügen“ wählen");
    expect(translate("en", "install.ui.more")).toBe("More");
    expect(translate("en", "install.ui.addAppToHome")).toBe("Add app to Home screen");
  });

  it("highlights “⋮” at the top right, next to “+” and the tabs", () => {
    renderDialog(phone);
    const picture = document.querySelector('svg[data-picture="androidMenu"]')!;
    const hits = picture.querySelectorAll("[data-hit]");
    expect(hits).toHaveLength(1);
    expect(Number(hits[0]!.getAttribute("cx"))).toBeGreaterThan(85);
    expect(Number(hits[0]!.getAttribute("cy"))).toBeLessThan(15);
  });

  it("draws the sheet from the bottom with “More” and its arrow down as the highlighted card, then the expanded entry", () => {
    renderDialog(phone);
    for (const name of ["firefoxMore", "firefoxAdd"]) {
      const picture = document.querySelector(`svg[data-picture="${name}"]`)!;
      const sheet = picture.querySelector("[data-sheet]")!;
      expect(Number(sheet.getAttribute("y"))).toBeGreaterThan(20);
      const hits = picture.querySelectorAll("[data-hit]");
      expect(hits, name).toHaveLength(1);
      const entry = picture.querySelector("[data-entry]")!;
      expect(entry.contains(hits[0]!)).toBe(true);
      // The highlight spans the card below the row Back, Forward, Share, Reload.
      expect(Number(hits[0]!.getAttribute("width"))).toBeGreaterThan(85);
      expect(Number(hits[0]!.getAttribute("y"))).toBeGreaterThan(Number(sheet.getAttribute("y")) + 30);
    }
    const more = document.querySelector('svg[data-picture="firefoxMore"] [data-entry]')!;
    expect(more.querySelector("[data-chevron]")).toBeTruthy();
    const add = document.querySelector('svg[data-picture="firefoxAdd"] [data-entry]')!;
    expect(add.querySelector("[data-chevron]")).toBeNull();
  });
});

describe("labels of the pictures", () => {
  it("stay on one line when they fit and break at a space or after a hyphen otherwise", () => {
    expect(labelLines("Share", 60)).toEqual(["Share"]);
    expect(labelLines("Zum Home-Bildschirm", 66)).toEqual(["Zum Home-", "Bildschirm"]);
    expect(labelLines("Aggiungi alla schermata Home", 66)).toEqual(["Aggiungi alla", "schermata Home"]);
  });
});
