// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
export { ConfigProvider, useConfig, type ConfigProviderProps } from "./ConfigContext.tsx";
export { CONFIG_SCHEMA, mergeDeep, parseConfig, siteDomain, startPlace, validateConfig, type ParsedConfig } from "./config.ts";
export { DEFAULT_CONFIG, DEFAULT_HOSTER, DEFAULT_PLACE, DEFAULT_TIME_ZONE, HOSTERS, imprintHoster } from "./defaults.ts";
export { CONFIG_URL, loadConfig, reportConfigWarnings } from "./load.ts";
export * from "./types.ts";
