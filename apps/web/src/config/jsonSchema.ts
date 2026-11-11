// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Minimal JSON Schema validator for the subset used by config.schema.json (no dependency):
 * type, enum, const, oneOf, anyOf, $ref to "#/$defs/…", properties, required, additionalProperties: false,
 * items, minItems, maxItems, uniqueItems, minimum, maximum, minLength. Unknown keywords are ignored.
 */

export interface SchemaNode {
  type?: string | string[];
  enum?: readonly unknown[];
  const?: unknown;
  oneOf?: SchemaNode[];
  anyOf?: SchemaNode[];
  $ref?: string;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  items?: SchemaNode;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  $defs?: Record<string, SchemaNode>;
  [keyword: string]: unknown;
}

/** One validation problem; `path` is a JSON pointer into the validated value ("" for the root). */
export interface SchemaError {
  path: string;
  message: string;
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return typeOf(value) === "object";
    default:
      return typeOf(value) === type;
  }
}

function resolveRef(root: SchemaNode, ref: string): SchemaNode {
  const match = /^#\/\$defs\/(.+)$/.exec(ref);
  const target = match ? root.$defs?.[match[1]!] : undefined;
  if (!target) throw new Error(`Unsupported or unknown $ref: ${ref}`);
  return target;
}

function describe(value: unknown): string {
  return JSON.stringify(value);
}

function check(root: SchemaNode, schema: SchemaNode, value: unknown, path: string, errors: SchemaError[]): void {
  if (schema.$ref) {
    check(root, resolveRef(root, schema.$ref), value, path, errors);
  }
  const at = path === "" ? "/" : path;

  if (schema.oneOf || schema.anyOf) {
    const options = (schema.oneOf ?? schema.anyOf)!;
    const matching = options.filter((option) => validateAgainst(root, option, value).length === 0).length;
    const ok = schema.oneOf ? matching === 1 : matching >= 1;
    if (!ok) errors.push({ path: at, message: `${describe(value)} does not match ${describeOptions(root, options)}` });
    return;
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      errors.push({ path: at, message: `expected ${types.join(" or ")}, got ${typeOf(value)}` });
      return;
    }
  }
  if ("const" in schema && value !== schema.const) {
    errors.push({ path: at, message: `expected ${describe(schema.const)}, got ${describe(value)}` });
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push({ path: at, message: `expected one of ${schema.enum.map(describe).join(", ")}, got ${describe(value)}` });
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path: at, message: `must be at least ${schema.minimum}, got ${value}` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path: at, message: `must be at most ${schema.maximum}, got ${value}` });
    }
  }
  if (typeof value === "string" && schema.minLength !== undefined && value.length < schema.minLength) {
    errors.push({ path: at, message: `must have at least ${schema.minLength} characters` });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push({ path: at, message: `must have at least ${schema.minItems} entries` });
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push({ path: at, message: `must have at most ${schema.maxItems} entries` });
    }
    if (schema.uniqueItems) {
      const seen = new Set(value.map((item) => JSON.stringify(item)));
      if (seen.size !== value.length) errors.push({ path: at, message: "entries must be unique" });
    }
    if (schema.items) {
      value.forEach((item, index) => check(root, schema.items!, item, `${path}/${index}`, errors));
    }
  }
  if (typeOf(value) === "object") {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in record)) errors.push({ path: at, message: `missing required field "${key}"` });
    }
    for (const [key, child] of Object.entries(record)) {
      const childSchema = schema.properties?.[key];
      if (childSchema) check(root, childSchema, child, `${path}/${key}`, errors);
      else if (schema.additionalProperties === false) errors.push({ path: at, message: `unknown field "${key}"` });
    }
  }
}

function describeOptions(root: SchemaNode, options: SchemaNode[]): string {
  return options
    .map((option) => {
      if ("const" in option) return describe(option.const);
      if (option.$ref) return option.$ref.replace("#/$defs/", "");
      if (option.type) return [option.type].flat().join("|");
      return "schema";
    })
    .join(" or ");
}

function validateAgainst(root: SchemaNode, schema: SchemaNode, value: unknown): SchemaError[] {
  const errors: SchemaError[] = [];
  check(root, schema, value, "", errors);
  return errors;
}

/**
 * Validates `value` against `schema` (a sub-schema of `root`, whose $defs resolve references).
 * `path` prefixes the reported paths. Returns all problems found, empty when valid.
 */
export function validateSchema(value: unknown, schema: SchemaNode, root: SchemaNode = schema, path = ""): SchemaError[] {
  const errors: SchemaError[] = [];
  check(root, schema, value, path, errors);
  return errors;
}
