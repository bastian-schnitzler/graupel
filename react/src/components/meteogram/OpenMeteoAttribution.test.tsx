import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OpenMeteoAttribution } from "./OpenMeteoAttribution";
import { apiService } from "../../services/apiService";
import { readFileSync } from "node:fs";

const appCss = readFileSync("src/App.css", "utf8");

vi.mock("../../services/apiService", () => ({
  apiService: {
    openExternalUrl: vi.fn().mockResolvedValue(true),
  },
}));

describe("OpenMeteoAttribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with default testid, text, and link", () => {
    render(<OpenMeteoAttribution />);
    const container = screen.getByTestId("open-meteo-attribution");
    expect(container).toBeTruthy();
    expect(container.textContent).toBe("Weather data by Open-Meteo.com");
    expect(
      container.querySelectorAll(".open-meteo-attribution-text"),
    ).toHaveLength(1);

    const link = screen.getByRole("link", { name: "Open-Meteo.com" });
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("https://open-meteo.com/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("applies custom className and testId", () => {
    render(
      <OpenMeteoAttribution
        className="custom-class"
        testId="custom-attribution"
      />,
    );
    const container = screen.getByTestId("custom-attribution");
    expect(container.className).toContain("open-meteo-attribution");
    expect(container.className).toContain("custom-class");
  });

  it("lays out fullscreen attribution as a separate row above the chart", () => {
    const rule = appCss.match(
      /\.fullscreen-header-attribution\s*\{([^}]*)\}/s,
    )?.[1];
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/display:\s*flex/);
    expect(rule).toMatch(/justify-content:\s*flex-end/);
    expect(rule).toMatch(/flex-shrink:\s*0/);
    expect(rule).not.toMatch(/position:\s*absolute/);
  });

  it("intercepts link clicks and invokes apiService.openExternalUrl", () => {
    render(<OpenMeteoAttribution />);
    const link = screen.getByRole("link", { name: "Open-Meteo.com" });
    fireEvent.click(link);
    expect(apiService.openExternalUrl).toHaveBeenCalledWith(
      "https://open-meteo.com/",
    );
  });
});
