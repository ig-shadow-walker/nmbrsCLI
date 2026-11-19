import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Endpoint } from "./catalog-types.ts";
import { catalog, pathParams } from "./catalog.ts";
import { type Config, loadConfig } from "./config.ts";
import { Exit, NmbrsError } from "./errors.ts";
import { NmbrsClient, type PagingStyle, type QueryValue, buildUrl } from "./http.ts";
import { type OutputOptions, printSuccess } from "./output.ts";
import { type Plan, consumePlan, loadPlan, savePlan } from "./plans.ts";
import { riskReasons } from "./risk.ts";

export interface GlobalOpts {
  json?: boolean;
  fields?: string;
  limit?: string;
  raw?: boolean;
  verbose?: boolean;
}

export class Runtime {
  readonly out: OutputOptions;
  readonly limit?: number;
  readonly raw: boolean;
  readonly verbose: boolean;
  private _config?: Config;
  private _client?: NmbrsClient;

  constructor(opts: GlobalOpts) {
    this.out = {
      json: !!opts.json || process.env.NMBRS_OUTPUT === "json",
      fields: opts.fields ? opts.fields.split(",").map((f) => f.trim()).filter(Boolean) : undefined,
    };
    if (opts.limit !== undefined) {
      const n = Number(opts.limit);
      if (!Number.isInteger(n) || n < 1) throw new NmbrsError(`--limit must be a positive whole number.`);
      this.limit = n;
    }
    this.raw = !!opts.raw;
    this.verbose = !!opts.verbose;
  }

  get config(): Config {
    return (this._config ??= loadConfig());
  }

  get client(): NmbrsClient {
    return (this._client ??= new NmbrsClient(this.config, { verbose: this.verbose }));
  }

  /** The adviser to act for: --adviser-id, else the one saved by setup. */
  adviserId(given?: string): string {
    const id = given || this.config.adviserId;
    if (!id) {
      throw new NmbrsError("No adviser id is known.", Exit.ERROR, {
        key: "adviser.missing",
        hint: "Pass --adviser-id <globalAdviserId>, or run `nmbrs setup` again so it saves the adviser of the logged-in user.",
      });
    }
    return id;
  }

  success(data: unknown, meta?: Record<string, unknown>) {
    const limited = Array.isArray(data) && this.limit !== undefined ? data.slice(0, this.limit) : data;
    printSuccess(limited, meta, this.out);
  }
}

/** Fills {placeholders} in a path template. */
export function fillPath(template: string, values: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const v = values[name];
    if (!v) throw new NmbrsError(`Missing ${name}.`);
    return encodeURIComponent(v);
  });
}

/** One JSON:API resource ({type, id?, attributes}) as a plain object: {id?, ...attributes}. */
function flattenResource(r: unknown): unknown {
  if (!r || typeof r !== "object" || Array.isArray(r) || !("attributes" in r)) return r;
  const { id, attributes } = r as { id?: unknown; attributes: unknown };
  if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) {
    return { ...(id !== undefined && id !== null ? { id } : {}), ...(attributes as Record<string, unknown>) };
  }
  return attributes;
}

/** A JSON:API document's data, flattened (with raw: as {type, attributes}). Other bodies are returned as they are. */
export function unwrap(body: unknown, raw = false): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body) || !("data" in body)) return body;
  const data = (body as { data: unknown }).data;
  if (raw) return data;
  return Array.isArray(data) ? data.map(flattenResource) : flattenResource(data);
}

export interface ReadRequest {
  endpoint?: Endpoint;
  path: string;
  query: Record<string, QueryValue>;
  paging?: PagingStyle;
  page?: number;
  pageSize?: number;
  all?: boolean;
  /** Save base64 documents in the answer (signing documents) to this folder. */
  saveDir?: string;
}

export async function runRead(rt: Runtime, r: ReadRequest): Promise<number> {
  if (r.paging) {
    const res = await rt.client.paginate({ method: "GET", path: r.path, query: r.query }, r.paging, {
      page: r.page,
      size: r.pageSize,
      all: r.all,
      limit: rt.limit,
    });
    rt.success(rt.raw ? res.items : res.items.map(flattenResource), {
      count: res.items.length,
      page: res.firstPage,
      page_size: res.pageSize,
      ...(res.pagesFetched > 1 ? { pages_fetched: res.pagesFetched } : {}),
      next_page: res.nextPage,
      ...(res.deprecated ? { deprecated: true } : {}),
    });
    return Exit.OK;
  }
  const res = await rt.client.request({ method: "GET", path: r.path, query: r.query });
  let data = unwrap(res.body, rt.raw);
  if (Array.isArray(data) && rt.limit !== undefined) data = data.slice(0, rt.limit);
  const meta: Record<string, unknown> = res.deprecated ? { deprecated: true } : {};
  if (r.saveDir) {
    const saved = saveDocuments(data, r.saveDir);
    rt.success(saved.data, { ...meta, saved: saved.files });
    return Exit.OK;
  }
  rt.success(rt.out.json ? data : forDisplay(data), meta);
  return Exit.OK;
}

/** Writes every {name, content(base64), xbrl?(base64)} object in the data to dir; returns the data without the base64. */
export function saveDocuments(data: unknown, dir: string): { data: unknown; files: string[] } {
  const out = resolve(dir);
  mkdirSync(out, { recursive: true });
  const files: string[] = [];
  const used = new Set<string>();
  const unique = (name: string) => {
    let n = basename(name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")) || "document";
    for (let i = 2; used.has(n.toLowerCase()); i++) n = n.replace(/(\.[^.]*)?$/, (ext) => `-${i}${ext ?? ""}`);
    used.add(n.toLowerCase());
    return n;
  };
  const write = (name: string, b64: string) => {
    const file = join(out, unique(name));
    writeFileSync(file, Buffer.from(b64, "base64"));
    files.push(file);
    return file;
  };
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== "object") return v;
    const o = { ...(v as Record<string, unknown>) };
    if (typeof o.name === "string") {
      const ext = /\.[a-z0-9]{2,5}$/i.test(o.name) ? "" : o.type === "xbrl" ? ".xbrl" : ".pdf";
      if (typeof o.content === "string" && o.content) o.content = `saved: ${write(o.name + ext, o.content)}`;
      if (typeof o.xbrl === "string" && o.xbrl) o.xbrl = `saved: ${write(o.name.replace(/\.[^.]*$/, "") + ".xbrl", o.xbrl)}`;
    }
    for (const [k, x] of Object.entries(o)) if (x && typeof x === "object") o[k] = walk(x);
    return o;
  };
  return { data: walk(data), files };
}

// ---------- writes: plan, then apply ----------

export interface WriteRequest {
  endpoint?: Endpoint;
  method: string;
  path: string;
  query: Record<string, QueryValue>;
  body?: unknown;
  command: string;
  warnings?: string[];
}

const TARGET_KEYS = [
  "webhookId",
  "webhookName",
  "callbackUrl",
  "webhookTypeId",
  "administrationId",
  "name",
  "legalName",
  "clientIdentifier",
  "cocNumber",
];

/** For a write on /x/{id}/..., the GET endpoint that shows the thing being changed. */
function targetRead(e: Endpoint, concretePath: string): { path: string; query: Record<string, QueryValue> } | undefined {
  // The client card has no GET of its own; find the administration in the list instead.
  const card = concretePath.match(/^(\/v1\/advisers\/[^/]+\/administrations)\/([^/?]+)\/client-card/);
  if (card) return { path: card[1]!, query: { globalAdministrationId: decodeURIComponent(card[2]!), "page[number]": 1, "page[size]": 1 } };
  const segs = e.path.split("/");
  for (let k = segs.length; k > 2; k--) {
    if (!/^\{.+\}$/.test(segs[k - 1]!)) continue;
    const tpl = segs.slice(0, k).join("/");
    if (catalog.endpoints.some((x) => x.method === "GET" && x.path === tpl)) {
      return { path: concretePath.split("?")[0]!.split("/").slice(0, k).join("/"), query: {} };
    }
  }
  return undefined;
}

async function readTarget(rt: Runtime, e: Endpoint | undefined, concretePath: string, warnings: string[]) {
  if (!e || e.method === "GET") return undefined;
  const t = targetRead(e, concretePath);
  if (!t) return undefined;
  try {
    const res = await rt.client.request({ method: "GET", path: t.path, query: t.query });
    let data = unwrap(res.body);
    if (Array.isArray(data)) {
      if (!data.length) throw new NmbrsError("not found", Exit.NOT_FOUND);
      data = data[0];
    }
    if (!data || typeof data !== "object") return undefined;
    const out: Record<string, unknown> = {};
    for (const k of TARGET_KEYS) {
      const v = (data as Record<string, unknown>)[k];
      if (v !== undefined && v !== null && v !== "") out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
  } catch (err) {
    if (err instanceof NmbrsError && err.exitCode === Exit.NOT_FOUND) {
      throw new NmbrsError(`Nothing to change: ${concretePath} does not exist in Nmbrs Reporting.`, Exit.NOT_FOUND, { key: "resource.not_found" });
    }
    if (err instanceof NmbrsError && (err.exitCode === Exit.AUTH || err.exitCode === Exit.UNAVAILABLE)) throw err;
    warnings.push(`Could not read the current state first: ${(err as Error).message}`);
    return undefined;
  }
}

export function summarize(e: Endpoint | undefined, method: string, path: string, body: unknown, target?: Record<string, unknown>): string {
  const parts: string[] = [e?.summary || `${method} ${path}`];
  if (target) {
    const label = [target.webhookName ?? target.name, target.callbackUrl ?? target.clientIdentifier].filter(Boolean).join(", ");
    parts.push(`on ${label || target.webhookId || target.administrationId || path}`);
  } else if (e && pathParams(e).some((p) => p !== "globalAdviserId")) {
    parts.push(`on ${path}`);
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const facts: string[] = [];
  for (const k of ["name", "administrationName", "webhookName", "callbackUrl", "status", "periodType", "compilationSubscription", "insightsSubscription"]) {
    const v = b[k];
    if (v !== undefined && v !== null && typeof v !== "object") facts.push(`${k}=${String(v).slice(0, 60)}`);
  }
  if (Array.isArray(b.documents)) facts.push(`${b.documents.length} document${b.documents.length === 1 ? "" : "s"}`);
  if (facts.length) parts.push(`(${facts.join(", ")})`);
  return parts.join(" ");
}

/** For display: hides secrets and shortens big strings (base64 documents). */
export function forDisplay(v: unknown, key = ""): unknown {
  if (typeof v === "string") {
    if (/secret|password|token/i.test(key) && v) return "****";
    return v.length > 300 ? `<${v.length} characters, e.g. base64 file contents>` : v;
  }
  if (Array.isArray(v)) return v.map((x) => forDisplay(x));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, forDisplay(x, k)]));
  return v;
}

export function planView(plan: Plan, apiUrl: string) {
  return {
    planMade: true,
    planId: plan.id,
    summary: plan.summary,
    dangerous: plan.dangerous,
    ...(plan.target ? { target: plan.target } : {}),
    wouldSend: {
      method: plan.method,
      url: buildUrl(apiUrl, plan.path, plan.query),
      ...(plan.body !== undefined ? { body: forDisplay(plan.body) } : {}),
    },
    ...(plan.warnings.length ? { warnings: plan.warnings } : {}),
    expiresAt: plan.expiresAt,
    toApply: `nmbrs apply ${plan.id}`,
  };
}

/** Makes a plan for a write. Nothing is sent to Nmbrs Reporting except a read of the current state. */
export async function runWrite(rt: Runtime, w: WriteRequest): Promise<number> {
  const warnings = [...(w.warnings ?? [])];
  const target = await readTarget(rt, w.endpoint, w.path, warnings);
  const plan = savePlan({
    command: w.command,
    endpointId: w.endpoint?.id,
    method: w.method.toUpperCase(),
    path: w.path,
    query: Object.keys(w.query).length ? w.query : undefined,
    body: w.body,
    summary: summarize(w.endpoint, w.method, w.path, w.body, target),
    dangerous: riskReasons(w.endpoint, w.method, w.body),
    target,
    warnings,
  });
  const view = planView(plan, rt.config.apiUrl);
  if (rt.out.json) {
    process.stdout.write(JSON.stringify({ ok: true, data: view }, null, 2) + "\n");
  } else {
    const lines = [`Plan ${plan.id} (nothing has been sent yet)`, `  ${plan.summary}`];
    for (const d of plan.dangerous) lines.push(`  ! ${d}`);
    for (const wn of plan.warnings) lines.push(`  warning: ${wn}`);
    lines.push(`  ${view.wouldSend.method} ${view.wouldSend.url}`);
    if (plan.body !== undefined) lines.push(JSON.stringify(forDisplay(plan.body), null, 2).replace(/^/gm, "  "));
    lines.push(`To do it: nmbrs apply ${plan.id}   (expires ${plan.expiresAt})`);
    process.stdout.write(lines.join("\n") + "\n");
  }
  return Exit.PLAN;
}

export async function applyPlan(rt: Runtime, id: string): Promise<number> {
  const plan = loadPlan(id);
  // Consume first so a plan can never be sent twice, even if this process dies mid-request.
  if (!consumePlan(id)) throw new NmbrsError(`Plan ${id} was already applied.`, Exit.NOT_FOUND, { key: "plan.not_found" });
  const res = await rt.client.request({ method: plan.method, path: plan.path, query: plan.query, body: plan.body });
  rt.success(unwrap(res.body, rt.raw) ?? { done: true }, {
    applied: plan.id,
    summary: plan.summary,
    ...(res.deprecated ? { deprecated: true } : {}),
  });
  return Exit.OK;
}
