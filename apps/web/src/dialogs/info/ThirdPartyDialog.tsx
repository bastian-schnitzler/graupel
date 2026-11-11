// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useState, type ReactNode } from "react";
import { useT } from "../../i18n/index.ts";
import { Dialog } from "../Dialog.tsx";
import { parseMarkdown, type Block, type Inline } from "./markdown.ts";
import "./ThirdPartyDialog.css";

/**
 * Loads a license file next to index.html (LICENSE, THIRD_PARTY_LICENSES.md) as text. Rejects on HTTP errors and when
 * the server answers with a page instead of the file (a fallback to index.html).
 */
export async function loadText(href: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl(href);
  if (!response.ok) throw new Error(`${href}: HTTP ${response.status}`);
  const text = await response.text();
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error(`${href}: a page instead of the file`);
  return text;
}

/** Loads the third-party notice (THIRD_PARTY_LICENSES.md) and parses it (REQ-514). */
export async function loadNotice(href: string, fetchImpl: typeof fetch = fetch): Promise<Block[]> {
  return parseMarkdown(await loadText(href, fetchImpl));
}

function renderInline(nodes: readonly Inline[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "code":
        return <code key={index}>{node.text}</code>;
      case "strong":
        return <strong key={index}>{renderInline(node.children)}</strong>;
      case "link":
        return (
          <a key={index} href={node.href} target="_blank" rel="noopener noreferrer">
            {renderInline(node.children)}
          </a>
        );
    }
  });
}

/** Markdown blocks as React elements; heading levels move down by `headingOffset` (at most h6). */
export function MarkdownView({ blocks, headingOffset = 0 }: { blocks: readonly Block[]; headingOffset?: number }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.type) {
          case "heading": {
            const Tag = `h${Math.min(6, block.level + headingOffset)}` as "h2";
            return <Tag key={index}>{renderInline(block.children)}</Tag>;
          }
          case "paragraph":
            return <p key={index}>{renderInline(block.children)}</p>;
          case "list":
            return (
              <ul key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInline(item)}</li>
                ))}
              </ul>
            );
          case "table":
            return (
              <div key={index} className="markdown__table">
                <table>
                  <thead>
                    <tr>
                      {block.head.map((cell, cellIndex) => (
                        <th key={cellIndex}>{renderInline(cell)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex}>{renderInline(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "code":
            return <pre key={index}>{block.text}</pre>;
        }
      })}
    </>
  );
}

type State =
  | { status: "loading" }
  | { status: "ready"; content: { format: "markdown"; blocks: Block[] } | { format: "text"; text: string } }
  | { status: "error" };

export interface ThirdPartyDialogProps {
  /** Heading of the popup; replaces the file's own top heading. */
  title: string;
  /** The file next to index.html. */
  href: string;
  /** Markdown (THIRD_PARTY_LICENSES.md, REQ-514) or plain text shown as it is, e.g. LICENSE (REQ-647). */
  format: "markdown" | "text";
  /** Shown when the file cannot be loaded. */
  error: string;
  /** `data-testid` of the loaded content. */
  testId: string;
  onClose: () => void;
  /** For tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Popup with a license file, opened over the info popup from the About tab: the third-party licenses (REQ-514) or the
 * GPL of Graupel (REQ-647). Loads the file when it opens (this module is a lazy chunk); the body scrolls. Markdown is
 * rendered, its top heading dropped for the dialog title; plain text keeps its lines and spaces.
 */
export default function ThirdPartyDialog(props: ThirdPartyDialogProps) {
  const { title, href, format, error, testId, onClose, fetchImpl } = props;
  const t = useT();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let active = true;
    loadText(href, fetchImpl).then(
      (text) => {
        if (!active) return;
        if (format === "text") {
          setState({ status: "ready", content: { format, text } });
          return;
        }
        const blocks = parseMarkdown(text);
        const first = blocks[0];
        if (first?.type === "heading" && first.level === 1) blocks.shift();
        setState({ status: "ready", content: { format, blocks } });
      },
      () => {
        if (active) setState({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [href, format, fetchImpl]);

  return (
    <Dialog title={title} onClose={onClose} className="third-party-dialog">
      {state.status === "loading" ? (
        <p className="third-party__status" role="status">
          {t("info.about.thirdPartyLoading")}
        </p>
      ) : state.status === "error" ? (
        <p className="third-party__status" role="alert">
          {error}
        </p>
      ) : state.content.format === "text" ? (
        <pre className="license-text" data-testid={testId}>
          {state.content.text}
        </pre>
      ) : (
        <div className="markdown" data-testid={testId}>
          <MarkdownView blocks={state.content.blocks} headingOffset={1} />
        </div>
      )}
    </Dialog>
  );
}
