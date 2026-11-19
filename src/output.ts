import { NmbrsError } from "./errors.ts";

export interface OutputOptions {
  json: boolean;
  fields?: string[];
}

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts.slice(0, -1)) cur = (cur[p] ??= {}) as Record<string, unknown>;
  cur[parts[parts.length - 1]!] = value;
}

/** Keeps only the given (dotted) fields of an object, or of every object in an array. */
export function pickFields(data: unknown, fields?: string[]): unknown {
  if (!fields?.length) return data;
  const pick = (o: unknown) => {
    if (!o || typeof o !== "object" || Array.isArray(o)) return o;
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const v = getPath(o, f);
      if (v !== undefined) setPath(out, f, v);
    }
    return out;
  };
  return Array.isArray(data) ? data.map(pick) : pick(data);
}

export function printSuccess(data: unknown, meta: Record<string, unknown> | undefined, opts: OutputOptions) {
  const picked = pickFields(data, opts.fields);
  if (opts.json) {
    const envelope: Record<string, unknown> = { ok: true, data: picked ?? null };
    if (meta && Object.keys(meta).length) envelope.meta = meta;
    process.stdout.write(JSON.stringify(envelope, null, 2) + "\n");
    return;
  }
  process.stdout.write(renderHuman(picked) + "\n");
  if (meta) {
    const notes: string[] = [];
    if (meta.next_page) notes.push(`more results: add --page ${meta.next_page}, or --all`);
    if (meta.deprecated) notes.push("Nmbrs Reporting marks this endpoint as deprecated");
    for (const w of (meta.warnings as string[] | undefined) ?? []) notes.push(w);
    if (notes.length) process.stderr.write(notes.map((n) => `note: ${n}`).join("\n") + "\n");
  }
}

export function printError(err: unknown, opts: Pick<OutputOptions, "json">) {
  const e =
    err instanceof NmbrsError
      ? err
      : new NmbrsError(err instanceof Error ? err.message : String(err), 1, { key: "internal" });
  if (opts.json) {
    process.stdout.write(JSON.stringify({ ok: false, error: e.toJSON() }, null, 2) + "\n");
  } else {
    let msg = `error: ${e.message}`;
    for (const d of e.extra.details ?? []) msg += `\n  - ${[d.param, d.message ?? d.key].filter(Boolean).join(": ")}`;
    if (e.extra.hint) msg += `\nhint: ${e.extra.hint}`;
    process.stderr.write(msg + "\n");
  }
  return e.exitCode;
}

// ---------- human-readable rendering ----------

const isScalar = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);

function short(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (isScalar(v)) return String(v);
  const o = v as Record<string, unknown>;
  // Money objects: {"value": "12.50", "currency": "EUR"} or {"amount": ..., "currency": ...}
  if (o && typeof o === "object" && "currency" in o && ("value" in o || "amount" in o)) {
    return `${o.value ?? o.amount} ${o.currency}`;
  }
  if (Array.isArray(v)) return v.every(isScalar) ? v.join(", ") : `[${v.length} items]`;
  return JSON.stringify(v);
}

const PREFERRED = [
  "id",
  "administrationId",
  "globalAdministrationId",
  "globalDossierId",
  "webhookId",
  "name",
  "administrationName",
  "webhookName",
  "clientIdentifier",
  "cocNumber",
  "year",
  "dossierType",
  "status",
  "dueDate",
  "lastUpdatedDate",
  "callbackUrl",
  "email",
  "addedDate",
];

function columnsFor(rows: Record<string, unknown>[]): string[] {
  const keys = new Set<string>();
  for (const r of rows.slice(0, 20)) for (const [k, v] of Object.entries(r)) if (isScalar(v) || isMoney(v)) keys.add(k);
  const ordered = [...PREFERRED.filter((k) => keys.has(k)), ...[...keys].filter((k) => !PREFERRED.includes(k))];
  return ordered.slice(0, 7);
}

function isMoney(v: unknown) {
  return !!v && typeof v === "object" && "currency" in (v as object);
}

function table(rows: Record<string, unknown>[], cols: string[]): string {
  const cells = rows.map((r) => cols.map((c) => short(r[c]).replace(/\s+/g, " ")));
  const widths = cols.map((c, i) => Math.min(40, Math.max(c.length, ...cells.map((row) => row[i]!.length))));
  const fmt = (vals: string[]) =>
    vals.map((v, i) => (v.length > widths[i]! ? v.slice(0, widths[i]! - 1) + "…" : v.padEnd(widths[i]!))).join("  ").trimEnd();
  return [fmt(cols), fmt(widths.map((w) => "-".repeat(w))), ...cells.map(fmt)].join("\n");
}

function yaml(v: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  if (isScalar(v) || isMoney(v)) return pad + short(v);
  if (Array.isArray(v)) {
    if (!v.length) return pad + "[]";
    return v
      .map((item) =>
        isScalar(item) ? `${pad}- ${short(item)}` : `${pad}-\n${yaml(item, indent + 2)}`,
      )
      .join("\n");
  }
  const entries = Object.entries(v as Record<string, unknown>).filter(([k]) => k !== "_links");
  if (!entries.length) return pad + "{}";
  return entries
    .map(([k, val]) =>
      isScalar(val) || isMoney(val) || (Array.isArray(val) && val.every(isScalar))
        ? `${pad}${k}: ${short(val)}`
        : `${pad}${k}:\n${yaml(val, indent + 2)}`,
    )
    .join("\n");
}

export function renderHuman(data: unknown): string {
  if (data === null || data === undefined) return "(no content)";
  if (Array.isArray(data)) {
    if (!data.length) return "(no results)";
    if (data.every((r) => r && typeof r === "object" && !Array.isArray(r))) {
      const rows = data as Record<string, unknown>[];
      const cols = columnsFor(rows);
      return cols.length ? `${table(rows, cols)}\n(${rows.length} ${rows.length === 1 ? "row" : "rows"})` : yaml(data);
    }
  }
  return yaml(data);
}
