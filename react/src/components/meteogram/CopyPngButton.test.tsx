import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COPY_FEEDBACK_MS, CopyPngButton } from "./CopyPngButton";

describe("CopyPngButton", () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    [true, "done", "Copied to clipboard"],
    [false, "error", "Copy failed"],
  ])("shows feedback for result %s and resets afterwards", async (ok, state, title) => {
    vi.useFakeTimers();
    const onCopy = vi.fn().mockResolvedValue(ok);
    render(<CopyPngButton onCopy={onCopy} />);
    const button = screen.getByTestId("copy-png-button");

    await act(async () => {
      fireEvent.click(button);
    });
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("data-state")).toBe(state);
    expect(button.getAttribute("title")).toBe(title);

    act(() => {
      vi.advanceTimersByTime(COPY_FEEDBACK_MS);
    });
    expect(button.getAttribute("data-state")).toBe("idle");
  });

  it("reports a thrown copy as error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<CopyPngButton onCopy={() => Promise.reject(new Error("boom"))} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("copy-png-button"));
    });
    expect(screen.getByTestId("copy-png-button").getAttribute("data-state")).toBe("error");
  });

  it("does not let clicks or double-clicks reach the chart (fullscreen toggle)", async () => {
    const onParentClick = vi.fn();
    const onParentDoubleClick = vi.fn();
    render(
      <div onClick={onParentClick} onDoubleClick={onParentDoubleClick}>
        <CopyPngButton onCopy={() => Promise.resolve(true)} />
      </div>,
    );
    const button = screen.getByTestId("copy-png-button");
    await act(async () => {
      fireEvent.click(button);
    });
    fireEvent.doubleClick(button);
    expect(onParentClick).not.toHaveBeenCalled();
    expect(onParentDoubleClick).not.toHaveBeenCalled();
  });
});
