import React, { useEffect, useRef, useState } from "react";
import { Check, CircleAlert, ClipboardCopy } from "lucide-react";

type CopyState = "idle" | "busy" | "done" | "error";

const TITLES: Record<CopyState, string> = {
  idle: "Copy meteogram as PNG to clipboard",
  busy: "Copying…",
  done: "Copied to clipboard",
  error: "Copy failed",
};

/** Feedback (check / error icon) stays visible this long. */
export const COPY_FEEDBACK_MS = 2000;

interface CopyPngButtonProps {
  onCopy: () => Promise<boolean>;
  className?: string;
  testId?: string;
}

export const CopyPngButton: React.FC<CopyPngButtonProps> = ({
  onCopy,
  className = "",
  testId = "copy-png-button",
}) => {
  const [state, setState] = useState<CopyState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (state === "busy") return;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setState("busy");
    let ok = false;
    try {
      ok = await onCopy();
    } catch (err) {
      console.warn("Copying the meteogram failed:", err);
    }
    setState(ok ? "done" : "error");
    resetTimer.current = setTimeout(() => setState("idle"), COPY_FEEDBACK_MS);
  };

  const Icon = state === "done" ? Check : state === "error" ? CircleAlert : ClipboardCopy;

  return (
    <button
      type="button"
      className={`meteogram-copy-btn ${className}`.trim()}
      data-testid={testId}
      data-state={state}
      title={TITLES[state]}
      aria-label={TITLES[state]}
      disabled={state === "busy"}
      onClick={handleClick}
      // The chart toggles fullscreen on double-click; the button must not.
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <Icon size={14} aria-hidden="true" />
    </button>
  );
};
