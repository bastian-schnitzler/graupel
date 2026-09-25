import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { DrawingArea } from "./DrawingArea";

describe("DrawingArea", () => {
  const bounds = {
    top: 50,
    height: 100,
    left: 40,
    width: 720,
  };

  it("renders children with clipping path when clipId is provided", () => {
    const { container } = render(
      <svg>
        <DrawingArea bounds={bounds} clipId="test-clip" className="test-panel">
          <circle cx={50} cy={60} r={10} data-testid="child-circle" />
        </DrawingArea>
      </svg>,
    );

    const child = container.querySelector('[data-testid="child-circle"]');
    expect(child).toBeTruthy();

    const clippedGroup = container.querySelector(
      'g[clip-path="url(#test-clip)"]',
    );
    expect(clippedGroup).toBeTruthy();
    expect(clippedGroup?.contains(child!)).toBe(true);
  });

  it("renders clipPath in defs when renderClipDef is true", () => {
    const { container } = render(
      <svg>
        <DrawingArea bounds={bounds} clipId="custom-clip" renderClipDef={true}>
          <rect x={40} y={50} width={100} height={50} />
        </DrawingArea>
      </svg>,
    );

    const clipPath = container.querySelector("clipPath#custom-clip");
    expect(clipPath).toBeTruthy();
    const rect = clipPath?.querySelector("rect");
    expect(rect?.getAttribute("x")).toBe("40");
    expect(rect?.getAttribute("y")).toBe("50");
    expect(rect?.getAttribute("width")).toBe("720");
    expect(rect?.getAttribute("height")).toBe("100");
  });

  it("renders separator line when showSeparator is true", () => {
    const { container } = render(
      <svg>
        <DrawingArea
          bounds={bounds}
          showSeparator={true}
          separatorStroke="#333333"
          separatorStrokeWidth={2}
          separatorLeft={10}
          separatorRight={790}
        >
          <text x={50} y={60}>
            Content
          </text>
        </DrawingArea>
      </svg>,
    );

    const separator = container.querySelector(
      'line[data-testid="panel-separator-line"]',
    );
    expect(separator).toBeTruthy();
    expect(separator?.getAttribute("x1")).toBe("10");
    expect(separator?.getAttribute("x2")).toBe("790");
    expect(separator?.getAttribute("y1")).toBe("150"); // top (50) + height (100)
    expect(separator?.getAttribute("y2")).toBe("150");
    expect(separator?.getAttribute("stroke")).toBe("#333333");
    expect(separator?.getAttribute("stroke-width")).toBe("2");
  });
});
