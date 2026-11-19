/**
 * Rebuilds catalog/endpoints.json from the published Nmbrs Reporting OpenAPI spec (the one behind
 * https://visionplanner.stoplight.io/docs/visionplanner-public-api-s). Run it when the API changes:
 *
 *   bun run sync-docs                 # download the spec
 *   bun run sync-docs ./spec.json     # or use a local copy
 *
 * Then `bun run reference` to refresh the skill's reference.md, and `bun test`.
 */
import type { Catalog, Endpoint, Field, Param } from "../src/catalog-types.ts";

const SPEC_URL =
  "https://api.stoplight.io/projects/cHJqOjIzMTU2NA/branches/main/export/reference/2.%20Public%20REST%20end-points/public-api.swagger.json";

type Schema = {
  $ref?: string;
  type?: string;
  format?: string;
  nullable?: boolean;
  description?: string;
  enum?: string[];
  items?: Schema;
  oneOf?: Schema[];
  allOf?: Schema[];
  properties?: Record<string, Schema>;
  required?: string[];
};

const source = process.argv[2];
const spec = source
  ? await Bun.file(source).json()
  : await fetch(SPEC_URL).then((r) => {
      if (!r.ok) throw new Error(`Downloading the spec failed: HTTP ${r.status}`);
      return r.json();
    });

const schemas: Record<string, Schema> = spec.components?.schemas ?? {};

function deref(s: Schema | undefined, seen = new Set<string>()): Schema {
  if (!s) return {};
  if (s.$ref) {
    const name = s.$ref.split("/").pop()!;
    if (seen.has(name)) return { type: "object" };
    return deref(schemas[name], new Set([...seen, name]));
  }
  // Nullable references are written as {nullable, oneOf: [{$ref}]}.
  const one = s.oneOf ?? s.allOf;
  if (one?.length === 1) return { ...deref(one[0], seen), nullable: s.nullable, description: s.description ?? deref(one[0], seen).description };
  return s;
}

/** "Can have the following values:\n- a\n- b (B)" -> ["a", "b"]. */
const LIST = /(?:Can have (?:one of )?the following values|Allowed values)[^:]*:\s*((?:\s*-\s*[^\r\n]+)+)/i;

function enumFrom(description = ""): string[] | undefined {
  const m = description.match(LIST);
  if (!m) return undefined;
  const items = m[1]!
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+\(/)[0]!.replace(/^"|"$/g, "").trim());
  return items.length ? items : undefined;
}

function clean(description = ""): string {
  return description.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
}

function typeName(s: Schema): string {
  if (s.type === "array") {
    const item = deref(s.items);
    return `array[${item.properties ? "object" : (item.type ?? "string")}]`;
  }
  if (s.properties) return "object";
  return s.type ?? "string";
}

function fieldsOf(s: Schema, depth = 0): Field[] {
  const obj = deref(s);
  const target = obj.type === "array" ? deref(obj.items) : obj;
  if (!target.properties || depth > 4) return [];
  const required = new Set(target.required ?? []);
  return Object.entries(target.properties).map(([name, raw]) => {
    const p = deref(raw);
    const listed = enumFrom(p.description);
    const description = listed ? p.description!.replace(LIST, "") : p.description;
    const f: Field = { name, type: typeName(p), required: required.has(name) && !p.nullable, description: clean(description) };
    if (p.format && p.format !== "int32" && p.format !== "int64") f.format = p.format;
    const en = p.enum ?? listed;
    if (en) f.enum = en;
    const sub = fieldsOf(p, depth + 1);
    if (sub.length) f.fields = sub;
    return f;
  });
}

/** JSON:API responses wrap the model in data[].attributes; describe the model. */
function responseFields(op: any): Field[] {
  const content = op.responses?.["200"]?.content ?? {};
  const media = content["application/vnd.api+json"] ?? content["application/json"];
  if (!media) return [];
  let s = deref(media.schema);
  const data = s.properties?.data ? deref(s.properties.data) : undefined;
  if (data) {
    const item = data.type === "array" ? deref(data.items) : data;
    s = item.properties?.attributes ? deref(item.properties.attributes) : item;
  }
  if (!s.properties) return [{ name: "(value)", type: typeName(s), required: true, description: clean(s.description) }];
  return fieldsOf(s);
}

function kebab(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const endpoints: Endpoint[] = [];
for (const [path, ops] of Object.entries<any>(spec.paths ?? {})) {
  for (const [method, op] of Object.entries<any>(ops)) {
    if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
    const params: Param[] = (op.parameters ?? []).map((p: any) => {
      const s = deref(p.schema);
      const param: Param = {
        name: p.name,
        in: p.in,
        type: typeName(s),
        required: !!p.required,
        description: clean(p.description),
      };
      if (s.format && s.format !== "int32") param.format = s.format;
      if (s.enum) param.enum = s.enum;
      return param;
    });
    const body = op.requestBody?.content?.["application/json"]?.schema;
    if (body) {
      params.push({ name: "body", in: "body", type: "object", required: !!op.requestBody.required, description: "", fields: fieldsOf(body) });
    }
    endpoints.push({
      id: kebab(op.summary ?? op.operationId),
      group: op.tags?.[0] ?? "Other",
      method: method.toUpperCase() as Endpoint["method"],
      path,
      summary: op.summary ?? "",
      description: clean(op.description),
      deprecated: !!op.deprecated,
      params,
      response: responseFields(op),
    });
  }
}

const ids = endpoints.map((e) => e.id);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dupes.length) throw new Error(`Duplicate endpoint ids: ${dupes.join(", ")}`);

const catalog: Catalog = {
  source: source ? `file:${source}` : SPEC_URL,
  syncedAt: new Date().toISOString(),
  endpoints,
};
await Bun.write(new URL("../catalog/endpoints.json", import.meta.url), JSON.stringify(catalog, null, 2) + "\n");
console.log(`Wrote catalog/endpoints.json: ${endpoints.length} endpoints`);
for (const e of endpoints) console.log(`  ${e.method.padEnd(6)} ${e.path}  (${e.id})`);
