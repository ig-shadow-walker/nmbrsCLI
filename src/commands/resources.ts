import { Command } from "commander";
import { type JsonObject, applySets, coerce, readBodyInput, toFlag, toOptKey, validateBody } from "../body.ts";
import type { Endpoint, Param } from "../catalog-types.ts";
import { bodyFields, getEndpoint, pathParams, queryParams } from "../catalog.ts";
import { NmbrsError } from "../errors.ts";
import type { PagingStyle, QueryValue } from "../http.ts";
import { type CommandSpec, type GroupSpec, groups } from "../registry.ts";
import { type Runtime, fillPath, runRead, runWrite } from "../runtime.ts";
import { RESERVED_FLAGS, action, collect, fieldTree, firstSentence, valueHint } from "./common.ts";

interface FieldOption {
  flag: string;
  key: string;
  field: string;
  type: string;
  where: "query" | "body";
}

export const ADVISER_PARAM = "globalAdviserId";
const PAGING_PARAMS = new Set(["page[number]", "page[size]", "page[limit]", "page[offset]"]);

/** Maps catalog endpoint id -> friendly command ("administrations list"). */
export const friendlyCommands = new Map<string, string>();
for (const g of groups) for (const c of g.commands) friendlyCommands.set(c.endpoint, `nmbrs ${g.name} ${c.name}`);

export function pagingStyle(e: Endpoint): PagingStyle | undefined {
  const names = queryParams(e).map((q) => q.name);
  if (names.includes("page[number]")) return "number";
  if (names.includes("page[limit]")) return "offset";
  return undefined;
}

/**
 * JSON:API filters as the API wants them: [field]=operation:value. Accepts that form, or the
 * friendlier field=operation:value.
 */
export function normalizeFilter(raw: string): string {
  const s = raw.trim();
  if (s.startsWith("[")) return s;
  const eq = s.indexOf("=");
  if (eq <= 0) throw new NmbrsError(`--filter needs field=operation:value (e.g. year=eq:2025), got "${raw}".`);
  const value = s.slice(eq + 1);
  if (!/^[a-z]+:/.test(value)) {
    throw new NmbrsError(`--filter "${raw}" has no operation. Use eq, ne, gt, ge, lt, le, like, startswith, endswith or in, e.g. ${s.slice(0, eq)}=eq:${value}.`);
  }
  return `[${s.slice(0, eq)}]=${value}`;
}

function subcommand(parent: Command, name: string): Command {
  return parent.commands.find((c) => c.name() === name) ?? parent.command(name).description(`${name} commands`);
}

export function commandHelp(e: Endpoint, spec?: CommandSpec): string {
  const lines = ["", `Calls: ${e.method} ${e.path}   (endpoint id: ${e.id})`];
  if (e.method !== "GET") {
    lines.push("This changes data: it makes a plan and exits with code 2. Run `nmbrs apply <plan-id>` to do it.");
  }
  if (pathParams(e).includes(ADVISER_PARAM)) lines.push("Acts for the adviser saved by `nmbrs setup` unless --adviser-id is given.");
  if (e.description) lines.push("", e.description.length > 600 ? firstSentence(e.description, 400) : e.description);
  const fields = bodyFields(e);
  if (fields?.length) {
    lines.push(
      "",
      "Body fields (* = required). Pass top-level fields as --flags, everything with --data '<json>',",
      "--data-file <file>, or --set key.path=value:",
      ...fieldTree(fields),
    );
  }
  if (queryParams(e).some((q) => q.name === "filter")) {
    lines.push(
      "",
      "Filters: --filter field=operation:value (repeatable). Operations: eq ne gt ge lt le like startswith",
      "endswith in (comma-separated values; escape a comma in a value as \\,). Sort: --sort -field,other.",
    );
  }
  if (spec?.examples?.length) lines.push("", "Examples:", ...spec.examples.map((x) => `  ${x}`));
  return lines.join("\n");
}

export function buildCommand(parent: Command, spec: CommandSpec): Command {
  const e = getEndpoint(spec.endpoint);
  const parts = spec.name.split(" ");
  let host = parent;
  for (const p of parts.slice(0, -1)) host = subcommand(host, p);
  const cmd = host.command(parts[parts.length - 1]!).description(spec.summary ?? e.summary);
  if (spec.aliases) cmd.aliases(spec.aliases);

  const pathNames = pathParams(e);
  const positional = pathNames.filter((p) => p !== ADVISER_PARAM);
  const argNames = positional.map((p, i) => spec.args?.[i] ?? toFlag(p));
  for (const a of argNames) cmd.argument(`<${a}>`);
  const usesAdviser = pathNames.includes(ADVISER_PARAM);
  if (usesAdviser) cmd.option("--adviser-id <id>", "globalAdviserId to act for (default: the one saved by setup)");

  const fieldOpts: FieldOption[] = [];
  const used = new Set<string>([...RESERVED_FLAGS, "adviser-id", "filter", "sort", "page-size", "save-dir"]);
  const addOpt = (flag: string, field: string, type: string, where: "query" | "body", desc: string, required: boolean, options?: string[]) => {
    if (used.has(flag)) return;
    used.add(flag);
    fieldOpts.push({ flag, key: toOptKey(flag), field, type, where });
    cmd.option(`--${flag} ${valueHint(type, options)}`, `${firstSentence(desc) || field}${required ? " (required)" : ""}`);
  };

  const query = queryParams(e);
  const paging = pagingStyle(e);
  const hasFilter = query.some((q) => q.name === "filter");
  const hasSort = query.some((q) => q.name === "sort");
  for (const q of query) {
    if (PAGING_PARAMS.has(q.name) || q.name === "filter" || q.name === "sort") continue;
    addOpt(toFlag(q.name), q.name, q.type, "query", q.description, q.required, q.enum);
  }
  const fields = bodyFields(e);
  for (const f of fields ?? []) addOpt(toFlag(f.name), f.name, f.type, "body", f.description, f.required, f.enum);
  for (const [alias, target] of Object.entries(spec.optionAliases ?? {})) {
    const q = query.find((x) => x.name === target);
    const f = fields?.find((x) => x.name === target);
    const src = q ?? f;
    if (src) addOpt(alias, target, src.type, q ? "query" : "body", `Same as --${toFlag(target)}`, false, src.enum);
  }

  if (hasFilter) cmd.option("--filter <field=op:value>", "Filter, e.g. year=eq:2025 or dossierType=in:CMP,ADT (repeatable)", collect, []);
  if (hasSort) cmd.option("--sort <fields>", "Sort by these fields; - in front for descending, e.g. -year,name");
  if (paging) {
    cmd.option("--page <number>", "Page to fetch (starts at 1)");
    cmd.option("--page-size <number>", "Results per page (default 100)");
    cmd.option("--all", "Fetch every page (stops at --limit)");
  }
  if (fields) {
    cmd.option("-d, --data <json>", "Request body as JSON (merged under the --flags)");
    cmd.option("--data-file <path>", "Read the JSON body from a file (- for stdin)");
    cmd.option("--set <key=value>", "Set a body field by dotted path, e.g. address.city=Utrecht (repeatable)", collect, []);
    cmd.option("--no-validate", "Don't check required fields before making the plan");
  }
  if (spec.saveDocuments) cmd.option("--save-dir <dir>", "Save the base64 documents in the answer as files here (and leave them out of the output)");

  cmd.addHelpText("after", commandHelp(e, spec));

  cmd.action(
    action(async (rt: Runtime, c: Command, ...args: unknown[]) => {
      const opts = c.opts() as Record<string, unknown>;
      const pathValues: Record<string, string> = {};
      positional.forEach((p, i) => (pathValues[p] = String(args[i])));
      if (usesAdviser) pathValues[ADVISER_PARAM] = rt.adviserId(opts.adviserId as string | undefined);
      const path = fillPath(e.path, pathValues);

      const q: Record<string, QueryValue> = {};
      const body: JsonObject = { ...(spec.defaults ?? {}) };
      const input = fields ? readBodyInput(opts.data as string | undefined, opts.dataFile as string | undefined) : undefined;
      if (input) Object.assign(body, input);

      for (const o of fieldOpts) {
        const raw = opts[o.key];
        if (raw === undefined) continue;
        const value = coerce(String(raw), o.type, `--${o.flag}`);
        if (o.where === "query") q[o.field] = value as QueryValue;
        else body[o.field] = value;
      }
      const filters = (opts.filter as string[] | undefined) ?? [];
      if (filters.length) q.filter = filters.map(normalizeFilter);
      if (opts.sort) q.sort = String(opts.sort);

      const missingQuery = query.filter((p: Param) => p.required && !PAGING_PARAMS.has(p.name) && (q[p.name] === undefined || q[p.name] === ""));
      if (missingQuery.length) {
        throw new NmbrsError(`Missing required option: ${missingQuery.map((p) => `--${toFlag(p.name)}`).join(", ")}`);
      }

      if (e.method === "GET") {
        const num = (k: string, flag: string) => (opts[k] === undefined ? undefined : (coerce(String(opts[k]), "integer", flag) as number));
        const page = num("page", "--page");
        const pageSize = num("pageSize", "--page-size");
        if (page !== undefined && page < 1) throw new NmbrsError("--page starts at 1.");
        if (pageSize !== undefined && pageSize < 1) throw new NmbrsError("--page-size must be at least 1.");
        return runRead(rt, {
          endpoint: e,
          path,
          query: q,
          paging,
          page,
          pageSize,
          all: !!opts.all,
          saveDir: opts.saveDir as string | undefined,
        });
      }

      let finalBody: JsonObject | undefined;
      const warnings: string[] = [];
      if (fields) {
        finalBody = applySets(body, (opts.set as string[]) ?? [], fields);
        const v = validateBody(finalBody, fields);
        if (v.missing.length && opts.validate !== false) {
          throw new NmbrsError(`Missing required body fields: ${v.missing.join(", ")}`, 1, {
            key: "body.missing_fields",
            hint: `See \`nmbrs ${c.parent?.name()} ${c.name()} --help\` for the fields. Use --no-validate if the docs are wrong.`,
          });
        }
        if (v.unknown.length) warnings.push(`Fields the docs don't list (sent anyway): ${v.unknown.join(", ")}`);
        if (v.invalid.length) warnings.push(`Values outside the documented options: ${v.invalid.join("; ")}`);
      }
      return runWrite(rt, {
        endpoint: e,
        method: e.method,
        path,
        query: q,
        body: finalBody,
        command: commandLine(),
        warnings,
      });
    }),
  );
  return cmd;
}

export function commandLine(): string {
  const s = ["nmbrs", ...process.argv.slice(2)].map((a) => (/[\s'"]/.test(a) ? JSON.stringify(a) : a)).join(" ");
  return s.length > 600 ? s.slice(0, 600) + "…" : s;
}

export function buildGroup(program: Command, g: GroupSpec): Command {
  const group = program.command(g.name).description(g.summary);
  if (g.aliases) group.aliases(g.aliases);
  for (const spec of g.commands) buildCommand(group, spec);
  return group;
}

export function registerResources(program: Command) {
  for (const g of groups) buildGroup(program, g);
}
