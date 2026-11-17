// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Pictures of the install steps (REQ-775, DEC-110): drawn, not photographed, as inline SVG in the colours of the page,
 * so they follow the light and dark design. The button or entry of the step is highlighted in the app's orange, and
 * the menu names are those of the page's language. Decorative: the line of text below each picture says the same.
 */
import { useId, type ReactNode } from "react";
import { useT } from "../../i18n/index.ts";
import type { InstallDevice, InstallPicture as PictureName } from "../../state/index.ts";
import "../pictures.css";

/** Size of every picture (user units): a phone's screen, cut out. */
const WIDTH = 100;
const HEIGHT = 125;
/** Text size of the labels and the space between their lines. */
const FONT = 7.5;
const LINE = 8.5;

/** An id from `useId` that is safe in `url(#…)`. */
export const useSvgId = () => `ip${useId().replace(/[^\w-]/g, "")}`;

/** Rough width of a text in the page's sans-serif font. */
export const textWidth = (text: string, size: number) => text.length * size * 0.56;

/**
 * Lines of a label that fit `max` units: one line, or two split at the space (or after the hyphen) that keeps the
 * longer line shortest. A line still too long is squeezed (`textLength`) by the caller.
 */
export function labelLines(text: string, max: number, size = FONT): string[] {
  if (textWidth(text, size) <= max) return [text];
  let best: [string, string] | null = null;
  for (let i = 1; i < text.length - 1; i++) {
    const char = text[i];
    if (char !== " " && char !== "-") continue;
    const first = char === "-" ? text.slice(0, i + 1) : text.slice(0, i);
    const second = text.slice(i + 1);
    if (!best || Math.max(first.length, second.length) < Math.max(best[0].length, best[1].length)) {
      best = [first, second];
    }
  }
  return best ?? [text];
}

interface LabelProps {
  x: number;
  /** Middle of the label, whatever its number of lines. */
  y: number;
  text: string;
  max: number;
  anchor?: "start" | "middle";
  size?: number;
  className?: string;
}

export function Label({ x, y, text, max, anchor = "middle", size = FONT, className = "ip-label" }: LabelProps) {
  const lines = labelLines(text, max, size);
  const first = y - ((lines.length - 1) * LINE) / 2 + size * 0.35;
  return (
    <text x={x} y={first} textAnchor={anchor} className={className} style={{ fontSize: size }}>
      {lines.map((line, index) => (
        <tspan
          key={index}
          x={x}
          dy={index === 0 ? 0 : LINE}
          {...(textWidth(line, size) > max ? { textLength: max, lengthAdjust: "spacingAndGlyphs" } : {})}
        >
          {line}
        </tspan>
      ))}
    </text>
  );
}

/** Height of a menu row with a label of `lines` lines. */
const rowHeight = (lines: number) => 6 + lines * LINE;

/** Glyphs, centred on 0,0 and about 10 units large. */
type GlyphName =
  | "share"
  | "more"
  | "menu"
  | "kebab"
  | "back"
  | "forward"
  | "book"
  | "tabs"
  | "plus"
  | "add"
  | "home"
  | "copy"
  | "bookmark"
  | "glasses"
  | "chevronDown"
  | "chevronSmall"
  | "reload"
  | "globe"
  | "star"
  | "search"
  | "laptop"
  | "puzzle";

function Glyph({ name, x, y, scale = 1 }: { name: GlyphName; x: number; y: number; scale?: number }) {
  const at = scale === 1 ? `translate(${x} ${y})` : `translate(${x} ${y}) scale(${scale})`;
  const dots = (points: [number, number][]) => (
    <g transform={at} className="ip-dot">
      {points.map(([cx, cy]) => (
        <circle key={`${cx},${cy}`} cx={cx} cy={cy} r={1.1} />
      ))}
    </g>
  );
  if (name === "more") return dots([[-3.5, 0], [0, 0], [3.5, 0]]);
  if (name === "kebab") return dots([[0, -3.5], [0, 0], [0, 3.5]]);
  const paths: Record<Exclude<GlyphName, "more" | "kebab">, string> = {
    share: "M0 -5V2M-2.5 -2.5L0 -5L2.5 -2.5M-1.8 -0.5H-3.5V5H3.5V-0.5H1.8",
    menu: "M-4 -3H4M-4 0H4M-4 3H4",
    back: "M1.5 -4L-2.5 0L1.5 4",
    forward: "M-1.5 -4L2.5 0L-1.5 4",
    book: "M-4 -3.5H-0.5Q0 -3.5 0 -3V4Q0 3.5 -0.5 3.5H-4ZM4 -3.5H0.5Q0 -3.5 0 -3M0 4Q0 3.5 0.5 3.5H4V-3.5",
    tabs: "M-1.5 -4H4V1.5M-4 -1.5H1.5V4H-4Z",
    plus: "M0 -4V4M-4 0H4",
    add: "M-4 -4H4V4H-4ZM0 -2V2M-2 0H2",
    home: "M-4 0L0 -4L4 0M-3 -1V4H3V-1",
    copy: "M-1.5 -4.5H3.5V2.5H-1.5ZM-3.5 -2.5V4.5H1.5",
    bookmark: "M-3 -4.5H3V4.5L0 2L-3 4.5Z",
    glasses: "M-1.2 0A2 2 0 1 1 -5.2 0A2 2 0 1 1 -1.2 0ZM5.2 0A2 2 0 1 1 1.2 0A2 2 0 1 1 5.2 0ZM-1.2 -0.4Q0 -1.3 1.2 -0.4",
    chevronDown: "M-4 -2L0 2L4 -2",
    chevronSmall: "M-2.2 -1L0 1.2L2.2 -1",
    reload: "M3.6 -1.2A3.8 3.8 0 1 0 2.6 2.8M3.9 -4.2V-1H0.7",
    globe: "M4 0A4 4 0 1 1 -4 0A4 4 0 1 1 4 0ZM-4 0H4M0 -4Q-2.6 0 0 4Q2.6 0 0 -4",
    star: "M0 -4.2L1.3 -1.4L4.2 -1.1L2 0.9L2.6 3.9L0 2.4L-2.6 3.9L-2 0.9L-4.2 -1.1L-1.3 -1.4Z",
    search: "M2 0A3 3 0 1 1 -4 0A3 3 0 1 1 2 0ZM1.2 2.2L3.8 4.6",
    laptop: "M-3.5 -3H3.5V2H-3.5ZM-4.8 4H4.8",
    puzzle: "M-4 -2.5H-1.3A1.3 1.3 0 1 1 1.3 -2.5H4V0.2A1.3 1.3 0 1 1 4 2.8V4.5H-4Z",
  };
  return <path transform={at} className="ip-glyph" d={paths[name]} />;
}

/** The app's symbol: a white, faceted cloud on light blue, as on the home screen. */
function GraupelIcon({ x, y, size, round = false }: { x: number; y: number; size: number; round?: boolean }) {
  const scale = size / 24;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} data-graupel-icon="">
      {round ? <circle cx={12} cy={12} r={12} className="ip-icon-bg" /> : <rect width={24} height={24} rx={5.5} className="ip-icon-bg" />}
      <path
        className="ip-icon-cloud"
        d="M5.6 17.2H18.4A3.4 3.4 0 0 0 19 10.5A5 5 0 0 0 9.4 9.1A3.8 3.8 0 0 0 5.6 17.2Z"
      />
      <path className="ip-icon-facet" d="M9.4 9.1L11.6 17.2M14.2 7.6L11.6 17.2M5.4 13.4L19.6 12.6" />
    </g>
  );
}

/** Highlight around a round button. */
export const HitCircle = ({ x, y, r = 7.5 }: { x: number; y: number; r?: number }) => (
  <circle cx={x} cy={y} r={r} className="ip-hit" data-hit="" />
);

/** Highlight around a menu entry. */
export const HitRect = ({ x, y, width, height }: { x: number; y: number; width: number; height: number }) => (
  <rect x={x} y={y} width={width} height={height} rx={3} className="ip-hit" data-hit="" />
);

/** A sketch of the page behind: heading, the day slider in the page's blue and the chart. */
function PageSketch({ top, bottom }: { top: number; bottom: number }) {
  return (
    <g>
      <rect x={8} y={top + 4} width={46} height={4} rx={2} className="ip-line" />
      <rect x={8} y={top + 12} width={84} height={7} rx={2} className="ip-accent" />
      <rect x={0} y={top + 24} width={WIDTH} height={Math.max(0, bottom - top - 28)} className="ip-chart" />
    </g>
  );
}

/** Grey bar standing for a menu entry that is not meant. */
const Placeholder = ({ x, y, width }: { x: number; y: number; width: number }) => (
  <rect x={x} y={y - 1.5} width={width} height={3} rx={1.5} className="ip-line" />
);

/** Bar of round buttons at the bottom (iPhone, Android). */
function BottomBar({ glyphs, hit }: { glyphs: GlyphName[]; hit?: number }) {
  const step = WIDTH / glyphs.length;
  return (
    <g>
      <rect x={0} y={HEIGHT - 20} width={WIDTH} height={20} className="ip-bar" />
      {glyphs.map((name, index) => {
        const x = step * (index + 0.5);
        return (
          <g key={index}>
            {index === hit && <HitCircle x={x} y={HEIGHT - 10} r={glyphs.length > 5 ? 6.5 : 7.5} />}
            <Glyph name={name} x={x} y={HEIGHT - 10} />
          </g>
        );
      })}
    </g>
  );
}

/** The address field with a line standing for the address. */
function AddressField({ x, y, width, height = 13 }: { x: number; y: number; width: number; height?: number }) {
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={height / 2} className="ip-field" />
      <rect x={x + width / 2 - 14} y={y + height / 2 - 1.5} width={28} height={3} rx={1.5} className="ip-line" />
    </g>
  );
}

interface MenuEntry {
  label?: string;
  glyph?: GlyphName;
  /** Placeholder width when the entry has no label. */
  width?: number;
  hit?: boolean;
}

/** A menu: entries from `y` down, the highlighted one with its label, the others as grey bars. */
function Menu({ x, y, width, entries }: { x: number; y: number; width: number; entries: MenuEntry[] }) {
  // Text after the glyph, or from the left edge in a menu without glyphs (the Mac's).
  const textX = (entry: MenuEntry) => (entry.glyph ? x + 16 : x + 6);
  const max = (entry: MenuEntry) => x + width - 4 - textX(entry);
  const heights = entries.map((entry) => (entry.label ? rowHeight(labelLines(entry.label, max(entry)).length) : 11));
  const tops = heights.map((_, index) => y + 3 + heights.slice(0, index).reduce((sum, height) => sum + height, 0));
  const bottom = y + 3 + heights.reduce((sum, height) => sum + height, 0);
  const rows = entries.map((entry, index) => {
    const height = heights[index]!;
    const middle = tops[index]! + height / 2;
    return (
      <g key={index}>
        {entry.hit && <HitRect x={x + 2} y={middle - height / 2 + 0.5} width={width - 4} height={height - 1} />}
        {entry.glyph ? <Glyph name={entry.glyph} x={x + 9} y={middle} /> : null}
        {entry.label ? (
          <Label x={textX(entry)} y={middle} text={entry.label} max={max(entry)} anchor="start" />
        ) : (
          <Placeholder x={textX(entry)} y={middle} width={entry.width ?? 30} />
        )}
      </g>
    );
  });
  return (
    <g>
      <rect x={x} y={y} width={width} height={bottom - y + 3} rx={5} className="ip-menu" />
      {rows}
    </g>
  );
}

/** The desktop's menu bar with Safari's menus, File highlighted (`hit`) or open. */
function MacMenuBar({ file, pressed }: { file: string; pressed: "hit" | "open" }) {
  const size = 6.5;
  const safariX = 12;
  const fileX = safariX + textWidth("Safari", size) + 6;
  const fileWidth = textWidth(file, size);
  return (
    <g>
      <rect x={0} y={0} width={WIDTH} height={12} className="ip-bar" />
      <circle cx={6} cy={6} r={2} className="ip-dot" />
      <text x={safariX} y={8.3} className="ip-label ip-label--strong" style={{ fontSize: size }}>
        Safari
      </text>
      {pressed === "hit" ? (
        <HitRect x={fileX - 2.5} y={1.5} width={fileWidth + 5} height={9} />
      ) : (
        <rect x={fileX - 2.5} y={1.5} width={fileWidth + 5} height={9} rx={2} className="ip-pressed" />
      )}
      <text x={fileX} y={8.3} className="ip-label" style={{ fontSize: size }}>
        {file}
      </text>
      <Placeholder x={fileX + fileWidth + 6} y={6} width={10} />
      <Placeholder x={fileX + fileWidth + 20} y={6} width={8} />
    </g>
  );
}

/** A Safari window on the desktop. */
function MacWindow({ y }: { y: number }) {
  return (
    <g>
      <rect x={8} y={y} width={84} height={70} rx={4} className="ip-field" />
      <rect x={8.4} y={y + 0.4} width={83.2} height={10} rx={3.6} className="ip-bar" />
      {[14, 19, 24].map((cx) => (
        <circle key={cx} cx={cx} cy={y + 5} r={1.4} className="ip-line" />
      ))}
      <rect x={34} y={y + 3} width={40} height={4} rx={2} className="ip-line" />
      <rect x={14} y={y + 16} width={36} height={3} rx={1.5} className="ip-line" />
      <rect x={14} y={y + 23} width={72} height={6} rx={2} className="ip-accent" />
      <rect x={8.4} y={y + 34} width={83.2} height={35} className="ip-chart" />
    </g>
  );
}

/** Home screen with apps; the app's symbol in the middle, highlighted, named below. */
function HomeScreen({ android }: { android: boolean }) {
  const gradient = useSvgId();
  const columns = [22, 50, 78];
  const rows = [20, 48, 76];
  const size = 17;
  return (
    <g>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" className="ip-wallpaper-top" />
          <stop offset="1" className="ip-wallpaper-bottom" />
        </linearGradient>
      </defs>
      <rect width={WIDTH} height={HEIGHT} fill={`url(#${gradient})`} />
      {rows.flatMap((cy) =>
        columns.map((cx) =>
          cx === 50 && cy === 48 ? null : android ? (
            <circle key={`${cx},${cy}`} cx={cx} cy={cy} r={size / 2} className="ip-app" />
          ) : (
            <rect key={`${cx},${cy}`} x={cx - size / 2} y={cy - size / 2} width={size} height={size} rx={4.5} className="ip-app" />
          ),
        ),
      )}
      {android ? (
        <circle cx={50} cy={48} r={size / 2 + 3.5} className="ip-hit" data-hit="" />
      ) : (
        <rect x={50 - size / 2 - 3} y={48 - size / 2 - 3} width={size + 6} height={size + 6} rx={6.5} className="ip-hit" data-hit="" />
      )}
      <GraupelIcon x={50 - size / 2} y={48 - size / 2} size={size} round={android} />
      <text x={50} y={66} textAnchor="middle" className="ip-app-label">
        Graupel
      </text>
      {android ? (
        <g>
          {[22, 41, 59, 78].map((cx) => (
            <circle key={cx} cx={cx} cy={101} r={7} className="ip-app" />
          ))}
          <rect x={38} y={118} width={24} height={2} rx={1} className="ip-app" />
        </g>
      ) : (
        <g>
          <rect x={6} y={93} width={88} height={24} rx={8} className="ip-app ip-app--dock" />
          {[20, 40, 60, 80].map((cx) => (
            <rect key={cx} x={cx - 7} y={98} width={14} height={14} rx={3.5} className="ip-app" />
          ))}
        </g>
      )}
    </g>
  );
}

/** Share sheet of iOS with "Add to Home Screen" highlighted, over the dimmed page. */
function ShareSheet({ label }: { label: string }) {
  return (
    <g>
      <PageSketch top={4} bottom={HEIGHT} />
      <rect width={WIDTH} height={HEIGHT} className="ip-dim" />
      <rect x={4} y={24} width={92} height={110} rx={8} className="ip-menu" />
      <GraupelIcon x={10} y={30} size={11} />
      <rect x={25} y={31.5} width={34} height={3} rx={1.5} className="ip-line" />
      <rect x={25} y={37} width={22} height={2.5} rx={1.25} className="ip-line" />
      {[18, 38, 58, 78].map((cx) => (
        <circle key={cx} cx={cx} cy={55} r={6} className="ip-line" />
      ))}
      <Menu
        x={8}
        y={66}
        width={84}
        entries={[{ glyph: "book", width: 32 }, { glyph: "add", label, hit: true }, { glyph: "plus", width: 26 }]}
      />
    </g>
  );
}

/**
 * Share sheet of iOS 26 (REQ-844): contacts, apps and the row of actions Copy, Add Bookmark, Add to Reading List, which
 * ends with the round button "Show More" (arrow down), highlighted and named. Only after it does the sheet list "Add to
 * Home Screen".
 */
function ShareSheetMore({ label }: { label: string }) {
  // Contacts and apps scroll sideways: a fifth one is cut off at the right edge, as on the iPhone.
  const columns = [15, 36.5, 58, 79.5];
  const rows = [...columns, 101];
  const actionsY = 86;
  const actions: GlyphName[] = ["copy", "bookmark", "glasses", "chevronDown"];
  return (
    <g>
      <PageSketch top={4} bottom={HEIGHT} />
      <rect width={WIDTH} height={HEIGHT} className="ip-dim" />
      <rect x={3} y={10} width={94} height={125} rx={10} className="ip-menu" />
      <GraupelIcon x={9} y={16} size={12} />
      <rect x={25} y={17.5} width={32} height={3} rx={1.5} className="ip-line" />
      <rect x={25} y={23} width={22} height={2.5} rx={1.25} className="ip-line" />
      {rows.map((cx) => (
        <circle key={`contact${cx}`} cx={cx} cy={42} r={7} className="ip-line" />
      ))}
      {rows.map((cx) => (
        <rect key={`app${cx}`} x={cx - 6.5} y={57} width={13} height={13} rx={3.5} className="ip-line" />
      ))}
      <g data-actions="">
        {actions.map((name, index) => {
          const cx = columns[index]!;
          const last = index === actions.length - 1;
          return (
            <g key={name}>
              {last && <HitCircle x={cx} y={actionsY} r={9.5} />}
              <circle cx={cx} cy={actionsY} r={8} className="ip-bar" />
              <Glyph name={name} x={cx} y={actionsY} />
              {last ? (
                <Label x={cx} y={103} text={label} max={32} size={7} />
              ) : (
                <Placeholder x={cx - 7} y={100} width={14} />
              )}
            </g>
          );
        })}
      </g>
    </g>
  );
}

/** Firefox's bar on Android: the address, "+", the tabs and the menu "⋮" at the right, highlighted with `hit`. */
function FirefoxToolbar({ hit }: { hit: boolean }) {
  return (
    <g>
      <rect x={0} y={0} width={WIDTH} height={22} className="ip-bar" />
      <AddressField x={5} y={5} width={56} height={12} />
      <Glyph name="plus" x={68} y={11} />
      <Glyph name="tabs" x={79} y={11} />
      {hit && <HitCircle x={90} y={11} r={6.5} />}
      <Glyph name="kebab" x={90} y={11} />
    </g>
  );
}

/** One card of Firefox's sheet: a glyph and a grey bar, or the meant entry with its label, highlighted. */
interface SheetCard {
  glyph: GlyphName;
  width?: number;
  label?: string;
  /** A round button with an arrow down at the right ("More", Extensions). */
  chevron?: boolean;
}

/**
 * The menu "⋮" of Firefox on Android (REQ-847): a sheet from the bottom with a handle, the row Back, Forward, Share,
 * Reload and below it cards. Collapsed, "More" (dots, arrow down) closes the cards and is highlighted; `expanded`, the
 * cards it opened end with Add app to Home screen, highlighted.
 */
function FirefoxSheet({ expanded, label }: { expanded: boolean; label: string }) {
  const top = 27;
  const cardX = 3;
  const cardWidth = WIDTH - 2 * cardX;
  const textX = cardX + 14;
  const size = 7;
  const cards: SheetCard[] = expanded
    ? [
        { glyph: "puzzle", width: 34, chevron: true },
        { glyph: "book", width: 36 },
        { glyph: "glasses", width: 40 },
        { glyph: "bookmark", width: 44 },
        { glyph: "add", label },
        { glyph: "share", width: 32 },
      ]
    : [
        { glyph: "globe", width: 14 },
        { glyph: "star", width: 50 },
        { glyph: "search", width: 34 },
        { glyph: "laptop", width: 38 },
        { glyph: "puzzle", width: 32, chevron: true },
        { glyph: "more", label, chevron: true },
      ];
  let y = top + 24;
  const rows = cards.map((card, index) => {
    const max = cardX + cardWidth - (card.chevron ? 16 : 4) - textX;
    const height = card.label ? rowHeight(labelLines(card.label, max, size).length) : 9;
    const rowTop = y;
    const middle = rowTop + height / 2;
    y += height + 1;
    return (
      <g key={index} {...(card.label ? { "data-entry": "" } : {})}>
        <rect x={cardX} y={rowTop} width={cardWidth} height={height} rx={2.5} className="ip-menu" />
        {card.label && <HitRect x={cardX + 1} y={rowTop + 1} width={cardWidth - 2} height={height - 2} />}
        <Glyph name={card.glyph} x={cardX + 7.5} y={middle} scale={0.7} />
        {card.label ? (
          <Label x={textX} y={middle} text={card.label} max={max} anchor="start" size={size} />
        ) : (
          <Placeholder x={textX} y={middle} width={card.width ?? 30} />
        )}
        {card.chevron && (
          <g data-chevron="">
            <circle cx={cardX + cardWidth - 8} cy={middle} r={3.6} className="ip-pressed" />
            <Glyph name="chevronSmall" x={cardX + cardWidth - 8} y={middle + 0.1} />
          </g>
        )}
      </g>
    );
  });
  return (
    <g>
      <PageSketch top={24} bottom={HEIGHT} />
      <FirefoxToolbar hit={false} />
      <rect width={WIDTH} height={HEIGHT} className="ip-dim" />
      <rect x={0} y={top} width={WIDTH} height={HEIGHT} rx={10} className="ip-bar" data-sheet="" />
      <rect x={WIDTH / 2 - 6} y={top + 3} width={12} height={1.8} rx={0.9} className="ip-line" />
      {(["back", "forward", "share", "reload"] as const).map((name, index) => {
        const x = 12.5 + index * 25;
        return (
          <g key={name}>
            <Glyph name={name} x={x} y={top + 11} />
            <Placeholder x={x - 7} y={top + 19} width={14} />
          </g>
        );
      })}
      {rows}
      {!expanded && (
        // Below "More" the row History, Bookmarks, Downloads, Passwords, cut off at the bottom.
        <g>
          {[0, 1, 2, 3].map((index) => (
            <rect key={index} x={cardX + index * 23.75} y={y + 1} width={22.75} height={20} rx={2.5} className="ip-menu" />
          ))}
        </g>
      )}
    </g>
  );
}

/** One picture of a step, drawn for the guide's device. */
export function InstallPicture({ picture, device }: { picture: PictureName; device: InstallDevice }) {
  const t = useT();
  const clip = useSvgId();
  const inset = useSvgId();
  const share = t("install.ui.share");
  let content: ReactNode;
  switch (picture) {
    case "safariBarBottom":
      // Safari up to iOS 18 on the iPhone: Share in the middle of the bar at the bottom.
      content = (
        <>
          <PageSketch top={4} bottom={84} />
          <rect x={0} y={84} width={WIDTH} height={21} className="ip-bar" />
          <AddressField x={8} y={88} width={84} />
          <BottomBar glyphs={["back", "forward", "share", "book", "tabs"]} hit={2} />
        </>
      );
      break;
    case "safariShareOrMore": {
      // Safari from iOS 26 (REQ-808): with the bar Bottom (or Top) Share sits in the toolbar at the bottom, which is
      // highlighted; the small inset shows the compact bar's "…", the second way, with a dashed highlight.
      const toolbarY = HEIGHT - 11.5;
      content = (
        <>
          <PageSketch top={4} bottom={HEIGHT} />
          <rect x={5} y={HEIGHT - 35} width={90} height={13} rx={6.5} className="ip-field" />
          <rect x={36} y={HEIGHT - 30} width={28} height={3} rx={1.5} className="ip-line" />
          <rect x={5} y={toolbarY - 7.5} width={90} height={15} rx={7.5} className="ip-field" />
          {(["back", "forward", "share", "book", "tabs"] as const).map((name, index) => {
            const x = 14 + index * 18;
            return (
              <g key={name}>
                {name === "share" && <HitCircle x={x} y={toolbarY} />}
                <Glyph name={name} x={x} y={toolbarY} />
              </g>
            );
          })}
          <g data-compact-bar="">
            <defs>
              <clipPath id={inset}>
                <rect x={52} y={56} width={42} height={24} rx={5} />
              </clipPath>
            </defs>
            <rect x={52} y={56} width={42} height={24} rx={5} className="ip-bar" />
            <rect x={44} y={61} width={30} height={14} rx={7} className="ip-field" clipPath={`url(#${inset})`} />
            <circle cx={83} cy={68} r={6} className="ip-field" />
            <circle cx={83} cy={68} r={7.5} className="ip-hit ip-hit--second" data-hint="" />
            <Glyph name="more" x={83} y={68} />
            <rect x={52} y={56} width={42} height={24} rx={5} className="ip-inset" />
          </g>
        </>
      );
      break;
    }
    case "safariBarTop":
      // Safari on the iPad: Share at the top right of the bar.
      content = (
        <>
          <rect x={0} y={0} width={WIDTH} height={22} className="ip-bar" />
          <rect x={6} y={7} width={8} height={8} rx={1.5} className="ip-glyph" />
          <AddressField x={20} y={5} width={46} height={12} />
          <HitCircle x={78} y={11} />
          <Glyph name="share" x={78} y={11} />
          <Glyph name="tabs" x={92} y={11} />
          <PageSketch top={24} bottom={HEIGHT} />
        </>
      );
      break;
    case "addressShare":
      // Chrome and Edge on the iPhone and iPad: Share at the right end of the address bar.
      content = (
        <>
          <rect x={0} y={0} width={WIDTH} height={26} className="ip-bar" />
          <rect x={5} y={5} width={90} height={16} rx={8} className="ip-field" />
          <rect x={14} y={11.5} width={34} height={3} rx={1.5} className="ip-line" />
          <HitCircle x={85} y={13} />
          <Glyph name="share" x={85} y={13} />
          <PageSketch top={28} bottom={device === "iphone" ? HEIGHT - 20 : HEIGHT} />
          {device === "iphone" && <BottomBar glyphs={["back", "forward", "plus", "tabs", "more"]} />}
        </>
      );
      break;
    case "firefoxMenu":
      // Firefox: the menu "☰" (at the bottom right on the iPhone, at the top right on the iPad) with Share.
      content =
        device === "iphone" ? (
          <>
            <rect x={0} y={0} width={WIDTH} height={22} className="ip-bar" />
            <AddressField x={6} y={5} width={88} height={12} />
            <PageSketch top={24} bottom={HEIGHT - 20} />
            <BottomBar glyphs={["back", "forward", "plus", "tabs", "menu"]} hit={4} />
            <Menu
              x={30}
              y={42}
              width={66}
              entries={[{ glyph: "book", width: 30 }, { glyph: "plus", width: 24 }, { glyph: "share", label: share, hit: true }]}
            />
          </>
        ) : (
          <>
            <rect x={0} y={0} width={WIDTH} height={22} className="ip-bar" />
            <Glyph name="back" x={8} y={11} />
            <AddressField x={16} y={5} width={58} height={12} />
            <HitCircle x={88} y={11} />
            <Glyph name="menu" x={88} y={11} />
            <PageSketch top={24} bottom={HEIGHT} />
            <Menu
              x={30}
              y={24}
              width={66}
              entries={[{ glyph: "share", label: share, hit: true }, { glyph: "book", width: 30 }, { glyph: "plus", width: 24 }]}
            />
          </>
        );
      break;
    case "shareSheetMore":
      content = <ShareSheetMore label={t("install.ui.showMore")} />;
      break;
    case "shareSheet":
      content = <ShareSheet label={t("install.ui.addToHome")} />;
      break;
    case "homeScreen":
      content = <HomeScreen android={false} />;
      break;
    case "androidHome":
      content = <HomeScreen android={true} />;
      break;
    case "macMenuBar":
      // Safari on the Mac: the menu File in the menu bar.
      content = (
        <>
          <rect width={WIDTH} height={HEIGHT} className="ip-desk" />
          <MacWindow y={24} />
          <MacMenuBar file={t("install.ui.file")} pressed="hit" />
        </>
      );
      break;
    case "macFileMenu": {
      // Its entry Add to Dock.
      const file = t("install.ui.file");
      const menuX = Math.min(12 + textWidth("Safari", 6.5) + 6 - 4, WIDTH - 74);
      content = (
        <>
          <rect width={WIDTH} height={HEIGHT} className="ip-desk" />
          <MacWindow y={24} />
          <MacMenuBar file={file} pressed="open" />
          <Menu
            x={menuX}
            y={12}
            width={72}
            entries={[
              { width: 34 },
              { width: 40 },
              { width: 28 },
              { label: t("install.ui.addToDock"), hit: true },
              { width: 36 },
              { width: 30 },
            ]}
          />
        </>
      );
      break;
    }
    case "dock":
      // The app's symbol in the Dock.
      content = (
        <>
          <rect width={WIDTH} height={HEIGHT} className="ip-desk" />
          <rect x={0} y={0} width={WIDTH} height={12} className="ip-bar" />
          <circle cx={6} cy={6} r={2} className="ip-dot" />
          <MacWindow y={18} />
          <rect x={30} y={86} width={40} height={11} rx={3} className="ip-menu" />
          <text x={50} y={93.6} textAnchor="middle" className="ip-label" style={{ fontSize: 6.5 }}>
            Graupel
          </text>
          <rect x={6} y={101} width={88} height={18} rx={5} className="ip-dockbar" />
          {[16, 30, 44, 72, 86].map((cx) => (
            <rect key={cx} x={cx - 5.5} y={104.5} width={11} height={11} rx={2.8} className="ip-app ip-app--desk" />
          ))}
          <rect x={58 - 8} y={102.5} width={16} height={15} rx={4} className="ip-hit" data-hit="" />
          <GraupelIcon x={58 - 5.5} y={104.5} size={11} />
        </>
      );
      break;
    case "samsungMenu":
      // Samsung Internet: the menu "☰" at the bottom right.
      content = (
        <>
          <rect x={0} y={0} width={WIDTH} height={22} className="ip-bar" />
          <AddressField x={6} y={5} width={88} height={12} />
          <PageSketch top={24} bottom={HEIGHT - 20} />
          <BottomBar glyphs={["back", "forward", "home", "book", "tabs", "menu"]} hit={5} />
        </>
      );
      break;
    case "samsungAdd":
      // Its entry Add page to, then Home screen.
      content = (
        <>
          <PageSketch top={4} bottom={HEIGHT} />
          <rect width={WIDTH} height={HEIGHT} className="ip-dim" />
          <Menu
            x={4}
            y={20}
            width={92}
            entries={[
              { glyph: "book", width: 34 },
              { glyph: "tabs", width: 28 },
              { glyph: "plus", label: t("install.ui.addPageTo"), hit: true },
              { glyph: "share", width: 30 },
            ]}
          />
          <Menu
            x={20}
            y={78}
            width={72}
            entries={[{ glyph: "book", width: 30 }, { glyph: "home", label: t("install.ui.homeScreen"), hit: true }]}
          />
        </>
      );
      break;
    case "androidMenu":
      // Firefox on Android: the menu "⋮" at the top right, next to "+" and the tabs.
      content = (
        <>
          <FirefoxToolbar hit={true} />
          <PageSketch top={24} bottom={HEIGHT} />
        </>
      );
      break;
    case "firefoxMore":
      // Its sheet from the bottom, with "More" (REQ-847).
      content = <FirefoxSheet expanded={false} label={t("install.ui.more")} />;
      break;
    case "firefoxAdd":
      // "More" expanded: the entry Add app to Home screen (REQ-847).
      content = <FirefoxSheet expanded={true} label={t("install.ui.addAppToHome")} />;
      break;
  }
  return (
    <svg
      className="install-step__picture"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      aria-hidden="true"
      focusable="false"
      data-picture={picture}
    >
      <defs>
        <clipPath id={clip}>
          <rect x={0} y={0} width={WIDTH} height={HEIGHT} rx={9} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width={WIDTH} height={HEIGHT} className="ip-screen" />
        {content}
      </g>
      <rect x={0.75} y={0.75} width={WIDTH - 1.5} height={HEIGHT - 1.5} rx={8.5} className="ip-frame" />
    </svg>
  );
}
