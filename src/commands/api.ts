import type { Command } from "commander";
import { type JsonObject, applySets, coerce, readBodyInput, validateBody } from "../body.ts";
import { bodyFields, catalog, matchEndpoint, resolveId, searchEndpoints } from "../catalog.ts";
import { Exit, NmbrsError } from "../errors.ts";
import type { QueryValue } from "../http.ts";
import { type Runtime, runRead, runWrite } from "../runtime.ts";
import { action, collect, fieldTree } from "./common.ts";
import { ADVISER_PARAM, commandLine, friendlyCommands, normalizeFilter, pagingStyle } from "./resources.ts";

const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];

function parseQueryPairs(pairs: string[]): Record<string, QueryValue> {
  const out: Record<string, QueryValue> = {};
  for (const p of pairs) {
    const eq = p.indexOf("=");
    if (eq <= 0) throw new NmbrsError(`--query needs key=value, got "${p}".`);
    const k = p.slice(0, eq);
    const v = p.slice(eq + 1);
    const prev = out[k];
    out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [String(prev), v];
  }
  return out;
}

export function registerApi(program: Command) {
  program
    .command("api")
    .description("Call any Nmbrs Reporting endpoint directly (escape hatch for anything without a friendly command)")
    .argument("<method>", "GET, POST, PUT, DELETE or PATCH")
    .argument("<path>", "Path such as /v1/me or /v1/advisers/{globalAdviserId}/webhooks")
    .option("-q, --query <key=value>", "Query parameter (repeatable)", collect, [])
    .option("--filter <field=op:value>", "JSON:API filter, e.g. year=eq:2025 (repeatable)", collect, [])
    .option("-d, --data <json>", "Request body as JSON")
    .option("--data-file <path>", "Read the JSON body from a file (- for stdin)")
    .option("--set <key=value>", "Set a body field by dotted path (repeatable)", collect, [])
    .option("--adviser-id <id>", "Fills {globalAdviserId} in the path (default: the one saved by setup)")
    .option("--page <number>", "For paged lists: page to fetch (starts at 1)")
    .option("--page-size <number>", "For paged lists: results per page (default 100)")
    .option("--all", "For paged lists: fetch every page")
    .addHelpText(
      "after",
      [
        "",
        "GET runs straight away. Any other method makes a plan (exit code 2); run `nmbrs apply <plan-id>` to send it.",
        "{globalAdviserId} in the path is replaced with the saved adviser. Find paths with `nmbrs endpoints <words>`",
        "and their fields with `nmbrs describe <endpoint-id>`.",
        "",
        "Examples:",
        "  nmbrs api GET /v1/me --json",
        "  nmbrs api GET '/v1/advisers/{globalAdviserId}/administrations' --all --json",
        `  nmbrs api PUT '/v1/advisers/{globalAdviserId}/webhooks/<id>' -d '{"webhookName":"…","callbackUrl":"…","callbackSecret":"…"}'`,
      ].join("\n"),
    )
    .action(
      action(async (rt: Runtime, c: Command, method: unknown, path: unknown) => {
        const opts = c.opts() as {
          query: string[];
          filter: string[];
          data?: string;
          dataFile?: string;
          set: string[];
          adviserId?: string;
          page?: string;
          pageSize?: string;
          all?: boolean;
        };
        const m = String(method).toUpperCase();
        if (!METHODS.includes(m)) throw new NmbrsError(`Unknown method ${method}. Use one of ${METHODS.join(", ")}.`);
        let p = String(path);
        if (!/^https?:\/\//.test(p) && !p.startsWith("/")) p = `/${p}`;
        let [bare, qs] = p.split("?") as [string, string | undefined];
        if (bare.includes(`{${ADVISER_PARAM}}`)) bare = bare.replaceAll(`{${ADVISER_PARAM}}`, encodeURIComponent(rt.adviserId(opts.adviserId)));
        if (/\{[^}]+\}/.test(bare)) throw new NmbrsError(`Fill in ${bare.match(/\{[^}]+\}/)![0]} in the path.`);
        const query: Record<string, QueryValue> = { ...Object.fromEntries(new URLSearchParams(qs ?? "")), ...parseQueryPairs(opts.query) };
        if (opts.filter.length) query.filter = opts.filter.map(normalizeFilter);
        const endpoint = matchEndpoint(m, bare.replace(/^https?:\/\/[^/]+/, "").replace(/^\/public-api/, ""));

        if (m === "GET") {
          const paging = endpoint ? pagingStyle(endpoint) : undefined;
          const pagingGiven = Object.keys(query).some((k) => k.startsWith("page["));
          const num = (v: string | undefined, flag: string) => (v === undefined ? undefined : (coerce(v, "integer", flag) as number));
          return runRead(rt, {
            endpoint,
            path: bare,
            query,
            paging: pagingGiven ? undefined : paging,
            page: num(opts.page, "--page"),
            pageSize: num(opts.pageSize, "--page-size"),
            all: opts.all,
          });
        }
        const fields = endpoint ? bodyFields(endpoint) : undefined;
        const input = readBodyInput(opts.data, opts.dataFile);
        let body: JsonObject | undefined = input || opts.set.length ? applySets({ ...(input ?? {}) }, opts.set, fields) : undefined;
        const warnings: string[] = [];
        if (!endpoint) warnings.push(`${m} ${bare} is not in the Nmbrs Reporting docs catalog; it is sent as given.`);
        if (body && fields) {
          const v = validateBody(body, fields);
          if (v.missing.length) warnings.push(`The docs list these as required but they are missing: ${v.missing.join(", ")}`);
          if (v.unknown.length) warnings.push(`Fields the docs don't list: ${v.unknown.join(", ")}`);
          if (v.invalid.length) warnings.push(`Values outside the documented options: ${v.invalid.join("; ")}`);
        }
        if (body && !Object.keys(body).length) body = {};
        return runWrite(rt, { endpoint, method: m, path: bare, query, body, command: commandLine(), warnings });
      }),
    );

  program
    .command("endpoints")
    .description("List or search every Nmbrs Reporting API endpoint (from the bundled docs catalog)")
    .argument("[words...]", "Words to match in the id, path, group or summary")
    .option("--group <name>", "Only this docs group, e.g. Webhooks")
    .action(
      action(async (rt: Runtime, c: Command, words: unknown) => {
        const opts = c.opts() as { group?: string };
        const list = searchEndpoints((words as string[] | undefined)?.join(" "), opts.group);
        rt.success(
          list.map((e) => ({
            id: e.id,
            method: e.method,
            path: e.path,
            group: e.group,
            summary: e.summary,
            command: friendlyCommands.get(e.id) ?? `nmbrs api ${e.method} '${e.path}'`,
          })),
          { total: list.length, catalog_synced: catalog.syncedAt },
        );
        return Exit.OK;
      }),
    );

  program
    .command("describe")
    .description("Show an endpoint's parameters, body fields and response fields")
    .argument("<endpoint>", 'Endpoint id, "METHOD /path", or words that match one endpoint')
    .action(
      action(async (rt: Runtime, _c: Command, id: unknown) => {
        const e = resolveId(String(id));
        const command = friendlyCommands.get(e.id) ?? `nmbrs api ${e.method} '${e.path}'`;
        if (rt.out.json) {
          rt.success({ ...e, command });
          return Exit.OK;
        }
        const lines = [`${e.method} ${e.path}   (${e.id}, ${e.group})`, e.summary, `Command: ${command}`];
        if (e.description) lines.push("", e.description);
        for (const where of ["path", "query"] as const) {
          const ps = e.params.filter((p) => p.in === where);
          if (ps.length) lines.push("", `${where} parameters (* = required):`, ...fieldTree(ps));
        }
        const fields = bodyFields(e);
        if (fields?.length) lines.push("", "Body fields (* = required):", ...fieldTree(fields));
        if (e.response.length) lines.push("", "Response (each item, after flattening JSON:API data[].attributes):", ...fieldTree(e.response));
        process.stdout.write(lines.join("\n") + "\n");
        return Exit.OK;
      }),
    );
}
