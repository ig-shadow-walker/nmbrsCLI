import type { Command, Option } from "commander";
import { bodyFields, catalog, getEndpoint } from "./catalog.ts";
import { fieldTree } from "./commands/common.ts";
import { groups } from "./registry.ts";

const SKIP_OPTS = new Set(["-h, --help"]);

function usage(cmd: Command, path: string[]): string {
  const args = cmd.registeredArguments.map((a) => {
    const n = a.name() + (a.variadic ? "..." : "");
    return a.required ? `<${n}>` : `[${n}]`;
  });
  return ["nmbrs", ...path, ...args].join(" ");
}

function optionLines(cmd: Command): string[] {
  return (cmd.options as Option[]).filter((o) => !SKIP_OPTS.has(o.flags)).map((o) => `- \`${o.flags}\` ${o.description}`);
}

/**
 * The skill's reference.md, generated from the CLI's own command tree so it can't drift from the code.
 * Used by `bun run reference` (repo copy) and `nmbrs skill install` (installed copy).
 */
export function buildReference(program: Command): string {
  const out: string[] = [
    "# nmbrs command reference",
    "",
    "Generated from the CLI itself (`bun run reference`, `nmbrs skill install`); don't edit by hand.",
    `Endpoint catalog synced from the Nmbrs Reporting docs on ${catalog.syncedAt.slice(0, 10)}.`,
    "",
    "Global options (put them anywhere): `--json`, `--fields a,b.c`, `--limit n`, `--raw`, `-v/--verbose`.",
    "Paged list commands also take `--page n`, `--page-size n` and `--all`. Commands under",
    "`/v1/advisers/{globalAdviserId}` act for the adviser saved by setup unless `--adviser-id` is given.",
    "Write commands also take `-d/--data <json>`, `--data-file <path|->`, `--set key.path=value`",
    "(repeatable) and `--no-validate`, and make a plan (exit 2) that `nmbrs apply <plan-id>` sends.",
    "`*` marks required body fields.",
    "",
    "## Contents",
    "",
    ...["System: setup, skill, login, logout, apply, plans, auth, whoami", ...groups.map((g) => g.name), "api, endpoints, describe"].map(
      (s) => `- ${s}`,
    ),
    "",
  ];

  const specByPath = new Map<string, { endpoint: string }>();
  for (const g of groups) for (const c of g.commands) specByPath.set(`${g.name} ${c.name}`, c);

  const walk = (cmd: Command, path: string[], level: number) => {
    for (const sub of cmd.commands) {
      if (sub.name() === "help") continue;
      const p = [...path, sub.name()];
      if (sub.commands.length) {
        out.push(`${"#".repeat(Math.min(level, 4))} ${p.join(" ")}`, "", sub.description(), "");
        walk(sub, p, level + 1);
        continue;
      }
      out.push(`${"#".repeat(Math.min(level, 4))} ${p.join(" ")}`, "");
      out.push(`\`${usage(sub, p)}\`${sub.aliases().length ? `  (alias: ${sub.aliases().join(", ")})` : ""}`, "");
      out.push(sub.description(), "");
      const spec = specByPath.get(p.join(" "));
      if (spec) {
        const e = getEndpoint(spec.endpoint);
        out.push(`Calls \`${e.method} ${e.path}\`${e.method === "GET" ? "" : " (makes a plan)"}.`, "");
      }
      const opts = optionLines(sub).filter((l) => !/`(-d, )?--data|--data-file|--set |--no-validate|--adviser-id|--page|--all`/.test(l));
      if (opts.length) out.push(...opts, "");
      if (spec) {
        const fields = bodyFields(getEndpoint(spec.endpoint));
        if (fields?.length) out.push("Body fields:", "", "```", ...fieldTree(fields, 0), "```", "");
      }
    }
  };

  walk(program, [], 2);
  return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}
