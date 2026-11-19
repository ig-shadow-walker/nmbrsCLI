import { type Command, Option } from "commander";
import type { Field } from "../catalog-types.ts";
import { printError } from "../output.ts";
import { type GlobalOpts, Runtime } from "../runtime.ts";

/** Options every command has; generated field options must not clash with these. */
export const RESERVED_FLAGS = new Set([
  "json",
  "fields",
  "limit",
  "verbose",
  "data",
  "data-file",
  "set",
  "validate",
  "no-validate",
  "all",
  "page",
  "page-size",
  "raw",
  "adviser-id",
  "filter",
  "sort",
  "save-dir",
  "help",
  "version",
]);

export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/** Wraps an action: builds the runtime from global options, prints errors, sets the exit code. */
export function action<A extends unknown[]>(fn: (rt: Runtime, cmd: Command, ...args: A) => Promise<number>) {
  return async (...raw: unknown[]) => {
    const cmd = raw[raw.length - 1] as Command;
    const args = raw.slice(0, -2) as A; // commander passes (...args, opts, cmd)
    const globals = cmd.optsWithGlobals() as GlobalOpts;
    let json = !!globals.json || process.env.NMBRS_OUTPUT === "json";
    try {
      const rt = new Runtime(globals);
      json = rt.out.json;
      process.exitCode = await fn(rt, cmd, ...args);
    } catch (err) {
      process.exitCode = printError(err, { json });
    }
  };
}

export function firstSentence(s: string, max = 100): string {
  const one = s.replace(/\s+/g, " ").trim();
  const cut = one.match(/^(.+?[.!?])(\s|$)/)?.[1] ?? one;
  return cut.length > max ? cut.slice(0, max - 1) + "…" : cut;
}

export function valueHint(type: string, options?: string[]): string {
  if (options?.length && options.length <= 6) return `<${options.join("|")}>`;
  const t = type.toLowerCase();
  if (t === "boolean") return "<true|false>";
  if (t === "integer" || t === "number") return "<number>";
  if (t.startsWith("array[object") || t === "object") return "<json>";
  if (t.startsWith("array")) return "<a,b,...>";
  return "<value>";
}

export function fieldTree(fields: Field[], indent = 2): string[] {
  const lines: string[] = [];
  for (const f of fields) {
    const desc = firstSentence(f.description, 90) + (f.enum ? ` [${f.enum.join("|")}]` : "");
    lines.push(`${" ".repeat(indent)}${f.name}${f.required ? "*" : ""} (${f.type}${f.format ? `, ${f.format}` : ""})${desc.trim() ? `  ${desc.trim()}` : ""}`);
    if (f.fields?.length) lines.push(...fieldTree(f.fields, indent + 2));
  }
  return lines;
}

export function hiddenOption(flags: string, description: string): Option {
  return new Option(flags, description).hideHelp();
}
