/** One entry of the quantity registry (backend `graupel/data/quantities.py`). */
export interface QuantityDefinition {
  id: string;
  label: string;
  unit: string;
  kind: "point" | "interval";
  source: "hourly" | "pressure_level" | "composite" | "derived";
  api_name: string | null;
  aliases: string[];
  optional: boolean;
  catalogued: boolean;
  always_fetch: boolean;
  unit_from_api: boolean;
  retry_without: boolean;
  /** From the model's ensemble; never defines the model's delivered hours. */
  ensemble: boolean;
  allowed_styles: string[];
  requires: string[];
  downloadable: boolean;
  color: string | null;
}
