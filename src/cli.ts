#!/usr/bin/env bun
import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { registerApi } from "./commands/api.ts";
import { registerResources } from "./commands/resources.ts";
import { registerSetup } from "./commands/setup.ts";
import { registerSystem } from "./commands/system.ts";

export function buildProgram(): Command {
  const program = new Command("nmbrs")
    .description("Nmbrs Reporting from the command line. Reads run straight away; changes make a plan you apply.")
    .version(pkg.version)
    .option("--json", "Machine-readable output: {ok, data, meta} or {ok:false, error}")
    .option("--fields <a,b.c>", "Only these fields of each result (dotted paths)")
    .option("--limit <n>", "At most n results")
    .option("--raw", "Keep the JSON:API shape ({type, attributes}) instead of flattening it")
    .option("-v, --verbose", "Log HTTP requests to stderr")
    .showHelpAfterError()
    .addHelpText(
      "after",
      [
        "",
        "Exit codes: 0 ok, 1 error, 2 plan made (nothing sent), 3 not set up / not logged in,",
        "            4 not authorized, 5 Nmbrs Reporting unavailable or timed out, 6 not found",
        "",
        "First time: nmbrs setup   Then: nmbrs <group> --help   or   nmbrs endpoints <words>",
      ].join("\n"),
    );
  program.configureHelp({ sortSubcommands: false });

  registerSetup(program);
  registerSystem(program);
  registerResources(program);
  registerApi(program);
  return program;
}

if (import.meta.main) {
  await buildProgram().parseAsync(process.argv);
}
