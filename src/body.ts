import { readFileSync } from "node:fs";
import type { Field } from "./catalog-types.ts";
import { NmbrsError } from "./errors.ts";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

/** Reads --data / --data-file into an object. `-` reads stdin. */
export function readBodyInput(data?: string, dataFile?: string): JsonObject | undefined {
  if (data !== undefined && dataFile !== undefined) throw new NmbrsError("Use --data or --data-file, not both.");
  const raw = dataFile !== undefined ? (dataFile === "-" ? readFileSync(0, "utf8") : readFileSync(dataFile, "utf8")) : data;
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new NmbrsError(`The request body is not valid JSON: ${(e as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new NmbrsError("The request body must be a JSON object.");
  }
  return parsed as JsonObject;
}

/** Finds the catalog field at a dotted path (array indexes are skipped). */
export function fieldAt(fields: Field[] | undefined, path: string[]): Field | undefined {
  let list = fields;
  let found: Field | undefined;
  for (const part of path) {
    if (/^\d+$/.test(part)) continue;
    found = list?.find((f) => f.name === part);
    if (!found) return undefined;
    list = found.fields;
  }
  return found;
}

/** Converts a command-line string to the type the docs give for the field. */
export function coerce(raw: string, type: string | undefined, name: string): Json {
  const t = (type ?? "").toLowerCase();
  if (raw === "null") return null;
  if (t === "boolean") {
    if (/^(true|yes|1)$/i.test(raw)) return true;
    if (/^(false|no|0)$/i.test(raw)) return false;
    throw new NmbrsError(`${name} must be true or false, got "${raw}".`);
  }
  if (t === "integer" || t === "number") {
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(n)) throw new NmbrsError(`${name} must be a number, got "${raw}".`);
    if (t === "integer" && !Number.isInteger(n)) throw new NmbrsError(`${name} must be a whole number, got "${raw}".`);
    return n;
  }
  if (t.startsWith("array") || t === "object") {
    const s = raw.trim();
    if (s.startsWith("[") || s.startsWith("{")) {
      try {
        return JSON.parse(s) as Json;
      } catch (e) {
        throw new NmbrsError(`${name} is not valid JSON: ${(e as Error).message}`);
      }
    }
    if (t.startsWith("array")) {
      const items = s === "" ? [] : s.split(",").map((x) => x.trim());
      return /integer|number/.test(t) ? items.map(Number) : items;
    }
    throw new NmbrsError(`${name} needs a JSON object, e.g. '{"amount":"10.00","currency":"EUR"}'.`);
  }
  return raw;
}

/** Applies `key.path=value` assignments to a body, coercing by catalog type. */
export function applySets(body: JsonObject, sets: string[], fields?: Field[]): JsonObject {
  for (const s of sets) {
    const eq = s.indexOf("=");
    if (eq <= 0) throw new NmbrsError(`--set needs key=value, got "${s}".`);
    const key = s.slice(0, eq).trim();
    const raw = s.slice(eq + 1);
    const path = key.split(".");
    const field = fieldAt(fields, path);
    const value = coerce(raw, field?.type ?? guessType(raw), key);
    let node: Json = body;
    for (let i = 0; i < path.length - 1; i++) {
      const part = path[i]!;
      const nextIsIndex = /^\d+$/.test(path[i + 1]!);
      const container = node as Record<string, Json> | Json[];
      const k = (Array.isArray(container) ? Number(part) : part) as never;
      if (container[k] === undefined || container[k] === null || typeof container[k] !== "object") {
        (container as Record<string, Json>)[k] = nextIsIndex ? [] : {};
      }
      node = container[k];
    }
    const last = path[path.length - 1]!;
    if (Array.isArray(node)) node[Number(last)] = value;
    else (node as Record<string, Json>)[last] = value;
  }
  return body;
}

/** For fields the docs don't describe, keep JSON-looking values as JSON. */
function guessType(raw: string): string {
  if (/^(true|false)$/.test(raw)) return "boolean";
  if (/^[[{]/.test(raw.trim())) return "object";
  return "string";
}

export interface ValidationResult {
  missing: string[];
  unknown: string[];
  /** Values outside the documented options ("field: value (one of a, b)"). */
  invalid: string[];
}

/** Checks required fields (recursively) and flags fields the docs don't list. */
export function validateBody(body: JsonObject, fields: Field[] | undefined): ValidationResult {
  const result: ValidationResult = { missing: [], unknown: [], invalid: [] };
  if (!fields) return result;
  walk(body, fields, "", result);
  return result;
}

function walk(value: Json | undefined, fields: Field[], prefix: string, out: ValidationResult) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const f of fields) {
    const v = value[f.name];
    const path = prefix + f.name;
    if (f.required && (v === undefined || v === null || v === "")) out.missing.push(path);
    if (f.enum && typeof v === "string" && !f.enum.includes(v)) out.invalid.push(`${path}: ${v} (one of ${f.enum.join(", ")})`);
    if (v === undefined || v === null || !f.fields?.length) continue;
    if (Array.isArray(v)) v.forEach((item, i) => walk(item, f.fields!, `${path}.${i}.`, out));
    else walk(v, f.fields, `${path}.`, out);
  }
  for (const k of Object.keys(value)) {
    if (!fields.some((f) => f.name === k)) out.unknown.push(prefix + k);
  }
}

/** Converts a field name to a CLI option name: administrationName -> administration-name, page[size] -> page-size. */
export function toFlag(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\[\]\s]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/** Commander's camelCase key for an option name: administration-name -> administrationName. */
export function toOptKey(flag: string): string {
  return flag.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}
