/** Config view tabs (system.md §7). */
export type ConfigTab = "basic" | "chains" | "meteogram";

export const CONFIG_TABS: { id: ConfigTab; label: string }[] = [
  { id: "basic", label: "Basic" },
  { id: "chains", label: "Model chains" },
  { id: "meteogram", label: "Meteogram" },
];
