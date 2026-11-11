// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Tiny Markdown parser for THIRD_PARTY_LICENSES.md (REQ-514). It knows only what scripts/third-party.mjs writes:
 * ATX headings, paragraphs, `-` lists, pipe tables, fenced code blocks and HTML comments (dropped); inline code,
 * `**bold**`, `[text](url)` and `<url>`. The result is plain data that `MarkdownView` renders as React elements,
 * so nothing in the file reaches the page as HTML. Links keep only http(s) and mailto targets.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "heading"; level: number; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; items: Inline[][] }
  | { type: "table"; head: Inline[][]; rows: Inline[][][] }
  | { type: "code"; text: string };

const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|<((?:https?:\/\/|mailto:)[^>\s]+)>/g;

/** Only targets that cannot run script; others are shown as text. */
export function safeHref(href: string): string | null {
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
}

export function parseInline(source: string): Inline[] {
  const result: Inline[] = [];
  const text = (value: string) => {
    if (!value) return;
    const last = result[result.length - 1];
    if (last?.type === "text") last.text += value;
    else result.push({ type: "text", text: value });
  };
  let index = 0;
  for (const match of source.matchAll(INLINE)) {
    text(source.slice(index, match.index));
    index = match.index + match[0].length;
    const [whole, code, strong, label, href, auto] = match;
    if (code !== undefined) result.push({ type: "code", text: code });
    else if (strong !== undefined) result.push({ type: "strong", children: parseInline(strong) });
    else if (label !== undefined && href !== undefined) {
      const safe = safeHref(href);
      if (safe) result.push({ type: "link", href: safe, children: parseInline(label) });
      else text(whole);
    } else if (auto !== undefined) result.push({ type: "link", href: auto, children: [{ type: "text", text: auto }] });
  }
  text(source.slice(index));
  return result;
}

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => parseInline(cell.trim()));

const isTableSeparator = (line: string | undefined) => line !== undefined && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const fence = /^\s*(```+|~~~+)/.exec(line);
    if (fence?.[1]) {
      const marker = fence[1];
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").trimStart().startsWith(marker)) body.push(lines[i++] ?? "");
      i += 1;
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    if (line.trimStart().startsWith("<!--")) {
      while (i < lines.length && !(lines[i] ?? "").includes("-->")) i += 1;
      i += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading?.[1] && heading[2] !== undefined) {
      blocks.push({ type: "heading", level: heading[1].length, children: parseInline(heading[2]) });
      i += 1;
      continue;
    }
    if (line.trimStart().startsWith("|") && isTableSeparator(lines[i + 1])) {
      const head = splitRow(line);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? "").trimStart().startsWith("|")) rows.push(splitRow(lines[i++] ?? ""));
      blocks.push({ type: "table", head, rows });
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i] ?? ""))
        items.push(parseInline((lines[i++] ?? "").replace(/^\s*[-*+]\s+/, "")));
      blocks.push({ type: "list", items });
      continue;
    }
    // The first line always belongs to the paragraph (e.g. a `|` line without a table separator below it).
    const text: string[] = [line.trim()];
    i += 1;
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (!next.trim() || /^(#{1,6}\s|\s*(```|~~~|<!--|\||[-*+]\s))/.test(next)) break;
      text.push(next.trim());
      i += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(text.join(" ")) });
  }
  return blocks;
}
