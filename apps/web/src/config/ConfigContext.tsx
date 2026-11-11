// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_CONFIG } from "./defaults.ts";
import { loadConfig, reportConfigWarnings } from "./load.ts";
import type { GraupelConfig } from "./types.ts";

const ConfigContext = createContext<GraupelConfig>(DEFAULT_CONFIG);

export interface ConfigProviderProps {
  /** Use this configuration instead of loading config.json (tests, embedding). */
  config?: GraupelConfig;
  /** Shown while config.json loads; nothing by default, so switched-off regions never flash. */
  fallback?: ReactNode;
  children: ReactNode;
}

/** Loads config.json once at startup and provides the merged configuration to `useConfig()`. */
export function ConfigProvider({ config, fallback = null, children }: ConfigProviderProps) {
  const [loaded, setLoaded] = useState<GraupelConfig | null>(null);

  useEffect(() => {
    if (config) return;
    let active = true;
    void loadConfig().then(({ config: result, warnings }) => {
      if (!active) return;
      reportConfigWarnings(warnings);
      setLoaded(result);
    });
    return () => {
      active = false;
    };
  }, [config]);

  const value = config ?? loaded;
  if (!value) return <>{fallback}</>;
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

/** The current configuration; outside a `ConfigProvider` the defaults. */
export function useConfig(): GraupelConfig {
  return useContext(ConfigContext);
}
