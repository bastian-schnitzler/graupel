// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * License popups over the About tab: the third-party licenses (REQ-514) with Markdown parser and loader, and the GPL
 * as plain text instead of a download (REQ-647).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AboutPanel, LICENSE_HREF, THIRD_PARTY_HREF } from "../src/dialogs/info/AboutPanel.tsx";
import ThirdPartyDialog, {
  loadNotice,
  loadText,
  MarkdownView,
  type ThirdPartyDialogProps,
} from "../src/dialogs/info/ThirdPartyDialog.tsx";
import { parseInline, parseMarkdown } from "../src/dialogs/info/markdown.ts";
import { ConfigProvider, DEFAULT_CONFIG } from "../src/config/index.ts";
import { I18nProvider, LANGUAGES, MESSAGES, translate, type Language } from "../src/i18n/index.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const NOTICE = readFileSync(join(APP_DIR, "THIRD_PARTY_LICENSES.md"), "utf8");
const GPL = readFileSync(join(APP_DIR, "LICENSE"), "utf8");

const response = (body: string, status = 200) => new Response(body, { status });

/** The popup as the About tab opens it for the third-party licenses. */
const NOTICE_PROPS = {
  title: "Third-party licenses",
  href: "x.md",
  format: "markdown",
  error: "The third-party licenses could not be loaded. Please try again later.",
  testId: "third-party-licenses",
} as const satisfies Partial<ThirdPartyDialogProps>;

function wrap(children: React.ReactNode, language: Language = "en") {
  return (
    <ConfigProvider config={DEFAULT_CONFIG}>
      <I18nProvider languages={LANGUAGES} fallbackLanguage="en" browserLanguages={[language]}>
        {children}
      </I18nProvider>
    </ConfigProvider>
  );
}

describe("Markdown parser", () => {
  it("reads headings, paragraphs, lists, tables and code blocks and drops comments", () => {
    const blocks = parseMarkdown(
      [
        "# Title",
        "",
        "<!-- generated",
        "do not edit -->",
        "",
        "First line",
        "second line with `code`.",
        "",
        "## Table",
        "",
        "| A | B |",
        "|---|---|",
        "| [x](https://x.org/) | **y** |",
        "",
        "- **License:** MIT",
        "- **Source:** (<https://lucide.dev>)",
        "",
        "```text",
        "Copyright (c) <year>",
        "",
        "  indented",
        "```",
      ].join("\n"),
    );
    expect(blocks.map((block) => block.type)).toEqual(["heading", "paragraph", "heading", "table", "list", "code"]);
    expect(blocks[0]).toEqual({ type: "heading", level: 1, children: [{ type: "text", text: "Title" }] });
    expect(blocks[1]).toEqual({
      type: "paragraph",
      children: [
        { type: "text", text: "First line second line with " },
        { type: "code", text: "code" },
        { type: "text", text: "." },
      ],
    });
    expect(blocks[3]).toEqual({
      type: "table",
      head: [[{ type: "text", text: "A" }], [{ type: "text", text: "B" }]],
      rows: [
        [
          [{ type: "link", href: "https://x.org/", children: [{ type: "text", text: "x" }] }],
          [{ type: "strong", children: [{ type: "text", text: "y" }] }],
        ],
      ],
    });
    expect(blocks[4]).toEqual({
      type: "list",
      items: [
        [{ type: "strong", children: [{ type: "text", text: "License:" }] }, { type: "text", text: " MIT" }],
        [
          { type: "strong", children: [{ type: "text", text: "Source:" }] },
          { type: "text", text: " (" },
          { type: "link", href: "https://lucide.dev", children: [{ type: "text", text: "https://lucide.dev" }] },
          { type: "text", text: ")" },
        ],
      ],
    });
    // Code blocks keep their text as it is, including what looks like markup.
    expect(blocks[5]).toEqual({ type: "code", text: "Copyright (c) <year>\n\n  indented" });
  });

  it("keeps only http(s) and mailto links and never produces markup", () => {
    expect(parseInline("[a](javascript:alert(1)) <b>x</b>")).toEqual([
      { type: "text", text: "[a](javascript:alert(1)) <b>x</b>" },
    ]);
    const { container } = render(<MarkdownView blocks={parseMarkdown('<img src=x onerror="alert(1)">\n\n[a](javascript:x)')} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it("does not hang on a pipe line without a table below it", () => {
    expect(parseMarkdown("| only text\nmore")).toEqual([
      { type: "paragraph", children: [{ type: "text", text: "| only text more" }] },
    ]);
  });

  it("reads the shipped THIRD_PARTY_LICENSES.md completely", () => {
    const blocks = parseMarkdown(NOTICE);
    const headings = blocks.filter((block) => block.type === "heading");
    // `#` lines inside code blocks (e.g. "# Vite core license") are text, not headings.
    const outsideCode = NOTICE.replace(/^```text\n[\s\S]*?^```$/gm, "");
    expect(headings.length).toBe((outsideCode.match(/^#{1,6} /gm) ?? []).length);
    expect(JSON.stringify(blocks.filter((block) => block.type === "code"))).toContain("# Vite core license");
    expect(blocks.filter((block) => block.type === "code").length).toBe((NOTICE.match(/^```text$/gm) ?? []).length);
    expect(blocks.filter((block) => block.type === "table").length).toBe((NOTICE.match(/^\|---/gm) ?? []).length);
    const text = JSON.stringify(blocks);
    expect(text).not.toContain("<!--");
    expect(text).not.toContain("```");
    expect(text).toContain("Permission is hereby granted");
  });
});

describe("loadNotice", () => {
  it("fetches and parses the file", async () => {
    const fetchImpl = vi.fn(async () => response("# T\n\ntext"));
    await expect(loadNotice("./THIRD_PARTY_LICENSES.md", fetchImpl)).resolves.toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledWith("./THIRD_PARTY_LICENSES.md");
  });

  it("rejects HTTP errors and an HTML page in place of the file", async () => {
    await expect(loadNotice("x.md", async () => response("missing", 404))).rejects.toThrow("HTTP 404");
    await expect(loadNotice("x.md", async () => response("<!doctype html><html></html>"))).rejects.toThrow(
      "a page instead of the file",
    );
  });

  it("loads plain text as it is (REQ-647)", async () => {
    await expect(loadText("LICENSE", async () => response(GPL))).resolves.toBe(GPL);
    await expect(loadText("LICENSE", async () => response("<html></html>"))).rejects.toThrow("a page instead of the file");
  });
});

describe("third-party popup", () => {
  it("shows a loading note, then the licenses without the file's own title", async () => {
    let resolve: (value: Response) => void = () => {};
    const fetchImpl = vi.fn(() => new Promise<Response>((done) => (resolve = done)));
    render(wrap(<ThirdPartyDialog {...NOTICE_PROPS} onClose={() => {}} fetchImpl={fetchImpl} />));
    const dialog = screen.getByRole("dialog", { name: "Third-party licenses" });
    expect(screen.getByRole("status").textContent).toBe("Loading licenses…");
    await act(async () => resolve(response(NOTICE)));
    const content = screen.getByTestId("third-party-licenses");
    expect(content.querySelector("h1, h2")).toBeNull();
    expect(dialog.querySelector("h3")?.textContent).toBe("Origin of the code and the logo");
    expect(content.querySelectorAll("table").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: /^maplibre-gl \d/ })).toBeTruthy();
    expect(content.textContent).toContain("Permission is hereby granted");
  });

  it.each(LANGUAGES)("shows a translated error when the file cannot be loaded (%s)", async (language) => {
    render(
      wrap(
        <ThirdPartyDialog
          {...NOTICE_PROPS}
          error={translate(language, "info.about.thirdPartyError")}
          onClose={() => {}}
          fetchImpl={async () => response("", 500)}
        />,
        language,
      ),
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBeTruthy();
    if (language !== "en") expect(alert.textContent).not.toBe("The third-party licenses could not be loaded. Please try again later.");
  });

  it("opens from the About tab without following a link and gives the focus back on close", async () => {
    const fetchMock = vi.fn(async () => response(NOTICE));
    vi.stubGlobal("fetch", fetchMock);
    render(wrap(<AboutPanel />));
    const button = screen.getByRole("button", { name: "Third-party licenses" });
    button.focus();
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog", { name: "Third-party licenses" });
    await screen.findByTestId("third-party-licenses");
    expect(fetchMock).toHaveBeenCalledWith(THIRD_PARTY_HREF);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(button);
  });
});

describe("GPL popup (REQ-647)", () => {
  it("shows the license as plain text, lines and indents kept, titled with its name", async () => {
    render(
      wrap(
        <ThirdPartyDialog
          title="GPL-3.0-or-later"
          href="LICENSE"
          format="text"
          error="x"
          testId="license-text"
          onClose={() => {}}
          fetchImpl={async () => response(GPL)}
        />,
      ),
    );
    const dialog = screen.getByRole("dialog", { name: "GPL-3.0-or-later" });
    const text = await screen.findByTestId("license-text");
    expect(text.tagName).toBe("PRE");
    expect(text.textContent).toBe(GPL);
    expect(text.textContent).toMatch(/^\s+GNU GENERAL PUBLIC LICENSE\n\s+Version 3, 29 June 2007/);
    // Plain text: nothing in it becomes markup, e.g. the <https://fsf.org/> of the header.
    expect(text.querySelector("*")).toBeNull();
    expect(dialog.querySelector("a, h3, ul, table")).toBeNull();
    expect(text.textContent).toContain("<https://fsf.org/>");
  });

  it.each(LANGUAGES)("has a translated error of its own (%s)", (language) => {
    const error = translate(language, "info.about.licenseError");
    expect(error).toBeTruthy();
    expect(error).not.toBe(translate(language, "info.about.thirdPartyError"));
    if (language !== "en") expect(error).not.toBe(MESSAGES.en["info.about.licenseError"]);
  });

  it("opens from the About tab, loads LICENSE and gives the focus back on close", async () => {
    const fetchMock = vi.fn(async () => response(GPL));
    vi.stubGlobal("fetch", fetchMock);
    render(wrap(<AboutPanel />, "de"));
    const button = screen.getByRole("button", { name: "GPL-3.0-or-later" });
    button.focus();
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog", { name: "GPL-3.0-or-later" });
    expect((await screen.findByTestId("license-text")).textContent).toBe(GPL);
    expect(fetchMock).toHaveBeenCalledWith(LICENSE_HREF);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(button);
  });

  it("shows the translated error when LICENSE cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response("", 404)));
    render(wrap(<AboutPanel />, "de"));
    fireEvent.click(screen.getByRole("button", { name: "GPL-3.0-or-later" }));
    expect((await screen.findByRole("alert")).textContent).toBe(translate("de", "info.about.licenseError"));
  });
});
