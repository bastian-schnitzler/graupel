import React, { useCallback } from "react";
import { apiService } from "../../services/apiService";

interface OpenMeteoAttributionProps {
  className?: string;
  testId?: string;
}

export const OpenMeteoAttribution: React.FC<OpenMeteoAttributionProps> = ({
  className = "",
  testId = "open-meteo-attribution",
}) => {
  const handleClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    e.stopPropagation();
    void apiService.openExternalUrl("https://open-meteo.com/");
  }, []);

  return (
    <div
      className={`open-meteo-attribution ${className}`.trim()}
      data-testid={testId}
    >
      <span className="open-meteo-attribution-text">
        {"Weather data by "}
        <a
          href="https://open-meteo.com/"
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleClick}
          className="open-meteo-attribution-link"
        >
          Open-Meteo.com
        </a>
      </span>
    </div>
  );
};
