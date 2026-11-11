// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/** Small line icons of the location picker (decorative; buttons carry the text or an accessible name). */
const PATHS = {
  gps: "M12 2v3M12 19v3M2 12h3M19 12h3M12 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10Zm0 3.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0-3Z",
  map: "M3 6l6-2l6 2l6-2v14l-6 2l-6-2l-6 2ZM9 4v14M15 6v14",
  star: "M12 3l2.8 5.7l6.2.9l-4.5 4.4l1.1 6.2L12 17.3l-5.6 2.9l1.1-6.2L3 9.6l6.2-.9Z",
  close: "M6 6l12 12M18 6L6 18",
  chevronDown: "M6 9l6 6l6-6",
  pencil: "M4 20h4L19 9l-4-4L4 16ZM13.5 6.5l4 4",
  layers: "M12 3l9 5l-9 5l-9-5ZM3 12.5l9 5l9-5M3 16.5l9 5l9-5",
  starFilled: "M12 3l2.8 5.7l6.2.9l-4.5 4.4l1.1 6.2L12 17.3l-5.6 2.9l1.1-6.2L3 9.6l6.2-.9Z",
  // The refresh symbol of "Loading forecast…" (REQ-737), in the place field while another place loads (REQ-751).
  refresh: "M20 12a8 8 0 1 1-2.34-5.66L20 9M20 4v5h-5",
} as const;

export function Icon({ name, className }: { name: keyof typeof PATHS; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      data-icon={name}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      focusable="false"
      fill={name === "starFilled" ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
