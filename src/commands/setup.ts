import type { Command } from "commander";
import type { Environment } from "../config.ts";
import { Exit, NmbrsError } from "../errors.ts";
import { type Prompter, silentPrompter, terminalPrompter } from "../prompt.ts";
import { buildReference } from "../reference.ts";
import type { Runtime } from "../runtime.ts";
import { binDirMissingFromPath, runSetup, setupSummary } from "../setup.ts";
import { installSkill } from "../skill.ts";
import { action } from "./common.ts";

export function root(cmd: Command): Command {
  let c = cmd;
  while (c.parent) c = c.parent;
  return c;
}

interface SetupFlags {
  clientId?: string;
  clientSecretStdin?: boolean;
  sandbox?: boolean;
  environment?: string;
  redirectUri?: string;
  adviserId?: string;
  skill?: boolean;
  skillDir?: string;
  check?: boolean;
  login?: boolean;
  manual?: boolean;
  browser?: boolean;
  interactive?: boolean;
}

/** Tests replace this to script the answers. */
export const prompters = {
  make(interactive: boolean): Prompter {
    // Without a terminal, messages (like the login address) still go to stderr.
    return interactive ? terminalPrompter() : silentPrompter((t) => process.stderr.write(t + "\n"));
  },
};

export function parseEnvironment(f: { sandbox?: boolean; environment?: string }): Environment | undefined {
  if (f.sandbox) return "sandbox";
  if (f.environment === undefined) return undefined;
  const e = f.environment.toLowerCase();
  if (e === "production" || e === "sandbox") return e;
  throw new NmbrsError(`--environment must be production or sandbox, got "${f.environment}".`);
}

export function registerSetup(program: Command) {
  program
    .command("setup")
    .alias("init")
    .description("Connect nmbrs to Nmbrs Reporting: asks for the Client ID and Secret, logs you in, installs the Claude skill")
    .option("--client-id <id>", "Client ID of the API connection (otherwise asked, or the saved one)")
    .option("--client-secret-stdin", "Read the Client Secret from stdin (e.g. from a password manager)")
    .option("--sandbox", "Use the sandbox environment (same as --environment sandbox)")
    .option("--environment <name>", "production (default) or sandbox")
    .option("--redirect-uri <url>", "Callback URL registered on the API connection (default http://localhost:47615/callback)")
    .option("--adviser-id <id>", "globalAdviserId to act for (default: the logged-in user's adviser)")
    .option("--skill", "Install the Claude skill without asking")
    .option("--no-skill", "Don't install the Claude skill")
    .option("--skill-dir <dir>", "Install the skill here instead of ~/.claude/skills/nmbrs")
    .option("--no-check", "Don't check the Client ID and Secret with Nmbrs Reporting")
    .option("--no-login", "Save the credentials but don't log in yet (run `nmbrs login` later)")
    .option("--manual", "Log in by pasting the address the browser ends on, instead of a localhost listener")
    .option("--no-browser", "Print the login address instead of opening a browser")
    .option("--no-interactive", "Never ask; use flags, environment and the saved file")
    .addHelpText(
      "after",
      [
        "",
        "Run it in a terminal and answer the questions. Unattended (still opens the browser to log in):",
        "  op read op://Finance/Nmbrs/secret | nmbrs setup --client-id <id> --client-secret-stdin --json",
        "  Get-Clipboard | nmbrs setup --client-id <id> --client-secret-stdin     (Windows PowerShell)",
        "",
        "The API connection in Connect Center must list the Callback URL (http://localhost:47615/callback unless",
        "you pass --redirect-uri). Credentials are saved to ~/.config/nmbrs/credentials (%APPDATA%\\nmbrs\\credentials",
        "on Windows) and the login to session.json next to it, readable only by you. Run it again any time.",
      ].join("\n"),
    )
    .action(
      action(async (rt: Runtime, cmd: Command) => {
        const f = cmd.opts() as SetupFlags;
        let clientSecret: string | undefined;
        if (f.clientSecretStdin) {
          clientSecret = (await Bun.stdin.text()).trim();
          if (!clientSecret) throw new NmbrsError("--client-secret-stdin was given, but stdin was empty.");
        }
        const interactive = f.interactive !== false && !rt.out.json && !f.clientSecretStdin && !!process.stdin.isTTY;
        const io = prompters.make(interactive);
        const result = await runSetup(
          {
            clientId: f.clientId,
            clientSecret,
            environment: parseEnvironment(f),
            redirectUri: f.redirectUri,
            adviserId: f.adviserId,
            skill: f.skill,
            skillDir: f.skillDir,
            check: f.check,
            login: f.login,
            manual: f.manual,
            browser: f.browser,
          },
          io,
          { reference: () => buildReference(root(cmd)) },
        );
        if (interactive) for (const line of setupSummary(result)) io.say(line);
        else rt.success(result, { binNotOnPath: binDirMissingFromPath() });
        return Exit.OK;
      }),
    );

  const skill = program.command("skill").description("The Claude skill that teaches Claude Code to use nmbrs");
  skill
    .command("install")
    .description("Install or update the skill (SKILL.md and a reference generated from this nmbrs)")
    .option("--dir <dir>", "Install here instead of ~/.claude/skills/nmbrs")
    .option("--force", "Replace a development symlink with a copy")
    .action(
      action(async (rt: Runtime, cmd: Command) => {
        const o = cmd.opts() as { dir?: string; force?: boolean };
        rt.success(installSkill(buildReference(root(cmd)), o));
        return Exit.OK;
      }),
    );
}
