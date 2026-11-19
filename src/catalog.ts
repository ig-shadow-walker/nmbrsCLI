import catalogJson from "../catalog/endpoints.json" with { type: "json" };
import type { Catalog, Endpoint, Field, Param } from "./catalog-types.ts";
import { NmbrsError } from "./errors.ts";

export const catalog = catalogJson as Catalog;

const byId = new Map(catalog.endpoints.map((e) => [e.id, e]));

export function getEndpoint(id: string): Endpoint {
  const e = byId.get(id);
  if (!e) throw new Error(`Unknown endpoint id in catalog: ${id}`);
  return e;
}

export function pathParams(e: Endpoint): string[] {
  return [...e.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
}

export function queryParams(e: Endpoint): Param[] {
  return e.params.filter((p) => p.in === "query");
}

/** The body parameter's fields (the docs wrap them in one named object param). */
export function bodyFields(e: Endpoint): Field[] | undefined {
  const body = e.params.find((p) => p.in === "body");
  if (!body) return undefined;
  return body.fields ?? [];
}

/** Finds endpoints by id, by "METHOD /path", or by words in their summary/path/group. */
export function searchEndpoints(term?: string, group?: string): Endpoint[] {
  let list = catalog.endpoints;
  if (group) {
    const g = group.toLowerCase();
    list = list.filter((e) => e.group.toLowerCase().includes(g));
  }
  if (!term) return list;
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((e) => {
    const hay = `${e.id} ${e.method} ${e.path} ${e.group} ${e.summary}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Matches a concrete request (method + path such as /v3/invoices/123/send) to a catalog endpoint. */
export function matchEndpoint(method: string, path: string): Endpoint | undefined {
  const clean = path.split("?")[0]!.replace(/\/+$/, "");
  const m = method.toUpperCase();
  const candidates = catalog.endpoints.filter((e) => {
    if (e.method !== m) return false;
    const re = new RegExp(`^${e.path.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+")}$`);
    return re.test(clean);
  });
  // Prefer the most literal match (fewest placeholders), e.g. /invoices/peppol-scheme-catalog over /invoices/{id}.
  return candidates.sort((a, b) => pathParams(a).length - pathParams(b).length)[0];
}

export function resolveId(idOrRoute: string): Endpoint {
  const direct = byId.get(idOrRoute);
  if (direct) return direct;
  const m = idOrRoute.trim().match(/^(GET|POST|PUT|DELETE|PATCH)\s+(\S+)$/i);
  if (m) {
    const exact = catalog.endpoints.find((e) => e.method === m[1]!.toUpperCase() && e.path === m[2]);
    const hit = exact ?? matchEndpoint(m[1]!, m[2]!);
    if (hit) return hit;
  }
  const found = searchEndpoints(idOrRoute);
  if (found.length === 1) return found[0]!;
  throw new NmbrsError(
    found.length
      ? `"${idOrRoute}" matches ${found.length} endpoints: ${found.slice(0, 8).map((e) => e.id).join(", ")}`
      : `No endpoint matches "${idOrRoute}". Try \`nmbrs endpoints <words>\`.`,
  );
}
