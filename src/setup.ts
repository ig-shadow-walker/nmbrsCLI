import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, resolve } from "node:path";
import { type Session, checkClientCredentials, sessionPath, writeSession } from "./auth.ts";
import {
  type Config,
  DEFAULT_REDIRECT_URI,
  type Environment,
  configDir,
  credentialsPath,
  normalizeScopes,
  parseCredentials,
  urlsFor,
} from "./config.ts";
import { Exit, NmbrsError } from "./errors.ts";
import { NmbrsClient } from "./http.ts";
import { type LoginDeps, browserLogin, isLoopback } from "./login.ts";
import type { Prompter } from "./prompt.ts";
import { type SkillInstall, defaultSkillDir, installSkill } from "./skill.ts";

export interface SetupOptions {
  clientId?: string;
  /** Already read from stdin by the command (never from argv, where it would end up in shell history). */
  clientSecret?: string;
  environment?: Environment;
  redirectUri?: string;
  adviserId?: string;
  /** undefined: ask (or yes when not interactive). */
  skill?: boolean;
  skillDir?: string;
  /** false: don't check the Client ID and Secret with the login server. */
  check?: boolean;
  /** false: save the credentials but don't log in yet. */
  login?: boolean;
  /** Paste the address the login ended on instead of listening on localhost. */
  manual?: boolean;
  /** false: print the login address instead of opening a browser. */
  browser?: boolean;
}

export interface SetupDeps {
  /** reference.md for the skill, generated from the running CLI. */
  reference: () => string;
  env?: Record<string, string | undefined>;
  login?: LoginDeps;
}

export interface SetupResult {
  credentialsFile: string;
  clientId: string;
  environment: Environment;
  redirectUri: string;
  checked: boolean;
  loggedIn: boolean;
  sessionFile: string | null;
  user: { email: unknown; globalAdviserId: unknown } | null;
  adviserId: string | null;
  skill: SkillInstall | null;
  warnings: string[];
}

export function mask(s: string): string {
  return s.length <= 8 ? "****" : `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function quoteEnv(v: string): string {
  return /^[A-Za-z0-9_.:\/+=@-]*$/.test(v) ? v : `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Writes the credentials file (mode 600), keeping any other NMBRS_* settings that were in it. */
export function writeCredentials(file: string, values: Record<string, string | undefined>): void {
  const previous = existsSync(file) ? parseCredentials(readFileSync(file, "utf8")) : {};
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(previous)) if (k.startsWith("NMBRS_") && v !== "") merged[k] = v;
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === "") delete merged[k];
    else merged[k] = v;
  }
  const lines = [
    "# nmbrs credentials, written by `nmbrs setup`. Only you can read this file. Keep it out of git.",
    "# Run `nmbrs setup` again to change them. The login itself is kept in session.json next to this file.",
    ...Object.entries(merged).map(([k, v]) => `${k}=${quoteEnv(v)}`),
    "",
  ];
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, lines.join("\n"), { mode: 0o600 });
  chmodSync(file, 0o600);
}

/** Who is logged in: /v1/me (email, globalAdviserId, applicationClientId). */
export async function fetchMe(config: Config): Promise<{ email?: string; globalAdviserId?: string; applicationClientId?: string }> {
  const res = await new NmbrsClient(config).request({ method: "GET", path: "/v1/me" });
  const data = (res.body as { data?: { attributes?: Record<string, unknown> } } | null)?.data;
  const me = (data?.attributes ?? data ?? {}) as Record<string, unknown>;
  return {
    email: me.email as string | undefined,
    globalAdviserId: me.globalAdviserId as string | undefined,
    applicationClientId: me.applicationClientId as string | undefined,
  };
}

/** Logs in in the browser, saves the session, and reads who logged in. Used by setup and `nmbrs login`. */
export async function loginAndSave(
  config: Config,
  io: Prompter,
  o: { manual?: boolean; browser?: boolean },
  deps: LoginDeps = {},
): Promise<{ session: Session; me: Awaited<ReturnType<typeof fetchMe>> | null; warning?: string }> {
  const session = await browserLogin(config, io, o, deps);
  writeSession(config, session);
  try {
    const me = await fetchMe(config);
    session.user = { email: me.email, globalAdviserId: me.globalAdviserId };
    writeSession(config, session);
    return { session, me };
  } catch (e) {
    return { session, me: null, warning: `Logged in, but reading /v1/me failed: ${(e as Error).message}` };
  }
}

const other = (e: Environment): Environment => (e === "production" ? "sandbox" : "production");

/** The guided setup behind `nmbrs setup`. Interactive when the prompter is; otherwise flags, env and the existing file. */
export async function runSetup(o: SetupOptions, io: Prompter, deps: SetupDeps): Promise<SetupResult> {
  const env = deps.env ?? process.env;
  const file = credentialsPath(env);
  const saved = existsSync(file) ? parseCredentials(readFileSync(file, "utf8")) : {};
  const known = (k: string): string | undefined => env[k] || saved[k] || undefined;
  const warnings: string[] = [];
  const redirectUri = o.redirectUri ?? known("NMBRS_REDIRECT_URI") ?? DEFAULT_REDIRECT_URI;

  if (io.interactive) {
    io.say("");
    io.say("Nmbrs Reporting CLI setup");
    io.say("");
    io.say("This connects the `nmbrs` command to Nmbrs Reporting. You need an API connection from Connect Center");
    io.say("(adviser settings > Connect Center > + Connectie toevoegen; its Eigenschappen tab shows the Client ID");
    io.say("and Client Secret). Give that connection this Callback URL:");
    io.say("");
    io.say(`  ${redirectUri}`);
    io.say("");
    io.say("Everything is stored on this computer only, in files only you can read.");
    io.say("");
  }

  let clientId = o.clientId;
  let secret = o.clientSecret;
  const savedId = known("NMBRS_CLIENT_ID");
  const savedSecret = known("NMBRS_CLIENT_SECRET");
  if (!clientId && !secret && savedId && savedSecret) {
    if (!io.interactive || (await io.confirm(`Use the saved credentials (Client ID ${mask(savedId)})?`, true))) {
      clientId = savedId;
      secret = savedSecret;
    }
  }
  if (!io.interactive) {
    clientId ??= savedId;
    secret ??= savedSecret;
    if (!clientId || !secret) {
      throw new NmbrsError(`Setup needs a ${!clientId ? "Client ID" : "Client Secret"}.`, Exit.AUTH, {
        key: "setup.needs_input",
        hint: "Run `nmbrs setup` in a terminal, or pass --client-id and pipe the secret into --client-secret-stdin.",
      });
    }
  }
  clientId ??= await io.ask("Client ID", { required: true });
  secret ??= await io.ask("Client Secret (hidden)", { secret: true, required: true });

  const environmentGiven = o.environment ?? (known("NMBRS_ENVIRONMENT") as Environment | undefined);
  let environment: Environment = environmentGiven ?? "production";
  const config = (): Config => ({
    clientId: clientId!,
    clientSecret: secret!,
    environment,
    scopes: normalizeScopes(known("NMBRS_SCOPES")),
    redirectUri,
    adviserId: o.adviserId ?? known("NMBRS_ADVISER_ID"),
    ...urlsFor(environment, { apiUrl: known("NMBRS_API_URL"), authUrl: known("NMBRS_AUTH_URL") }),
    configDir: configDir(env),
    credentialsFile: file,
  });

  // 1. Are the Client ID and Secret right? Checked without a browser; wrong ones are asked again.
  const checked = o.check !== false;
  if (checked) {
    if (io.interactive) io.say("Checking the Client ID and Secret…");
    for (let attempt = 1; ; attempt++) {
      if ((await checkClientCredentials(config())) === "ok") break;
      // Maybe it's a connection in the other environment.
      if (!environmentGiven && !known("NMBRS_AUTH_URL")) {
        const here = environment;
        environment = other(here);
        if ((await checkClientCredentials(config())) === "ok") {
          io.say(`That API connection belongs to the ${environment} environment; using ${environment}.`);
          break;
        }
        environment = here;
      }
      const wrong = new NmbrsError("Nmbrs Reporting did not accept that Client ID and Secret.", Exit.AUTH, {
        key: "setup.invalid_client",
        hint: "Copy both again from the API connection's Eigenschappen tab in Connect Center.",
      });
      if (!io.interactive || attempt >= 3) throw wrong;
      io.say("Nmbrs Reporting did not accept that Client ID and Secret. Check them and try again.");
      clientId = await io.ask("Client ID", { default: clientId, required: true });
      secret = await io.ask("Client Secret (hidden)", { secret: true, required: true });
    }
  }

  // 2. Every question before the browser opens.
  let doLogin = o.login !== false;
  if (doLogin && io.interactive) {
    const how = isLoopback(redirectUri) && !o.manual ? "your browser opens" : "you get an address to open";
    doLogin = await io.confirm(`Log in to Nmbrs Reporting now (${how})?`, true);
  }
  const wantSkill =
    o.skill ?? (io.interactive ? await io.confirm("Install the Claude skill, so Claude Code knows how to use nmbrs?", true) : true);

  // 3. Save the credentials before the login, so a failed or cancelled login doesn't lose them.
  const values = (adviserId?: string) => ({
    NMBRS_CLIENT_ID: clientId,
    NMBRS_CLIENT_SECRET: secret,
    NMBRS_ENVIRONMENT: environment,
    NMBRS_REDIRECT_URI: redirectUri === DEFAULT_REDIRECT_URI ? undefined : redirectUri,
    NMBRS_ADVISER_ID: adviserId,
  });
  writeCredentials(file, values(config().adviserId));

  // 4. The browser login, then who logged in and for which adviser.
  let loggedIn = false;
  let user: SetupResult["user"] = null;
  let adviserId = config().adviserId ?? null;
  if (doLogin) {
    if (io.interactive) io.say("");
    const r = await loginAndSave(config(), io, { manual: o.manual, browser: o.browser }, deps.login);
    loggedIn = true;
    if (r.warning) warnings.push(r.warning);
    if (r.me) {
      user = { email: r.me.email ?? null, globalAdviserId: r.me.globalAdviserId ?? null };
      if (!o.adviserId && r.me.globalAdviserId) {
        if (adviserId && adviserId !== r.me.globalAdviserId) warnings.push(`The adviser changed from ${adviserId} to ${r.me.globalAdviserId}.`);
        adviserId = r.me.globalAdviserId;
      }
    }
    writeCredentials(file, values(adviserId ?? undefined));
  }

  for (const k of ["NMBRS_CLIENT_ID", "NMBRS_CLIENT_SECRET", "NMBRS_ENVIRONMENT", "NMBRS_ADVISER_ID"]) {
    if (env[k]) warnings.push(`${k} is set in your environment and wins over ${file}.`);
  }

  // 5. The Claude skill.
  const skill: SkillInstall | null = wantSkill ? installSkill(deps.reference(), { dir: o.skillDir ?? defaultSkillDir(env) }) : null;

  return {
    credentialsFile: file,
    clientId: mask(clientId),
    environment,
    redirectUri,
    checked,
    loggedIn,
    sessionFile: loggedIn ? sessionPath(config()) : null,
    user,
    adviserId,
    skill,
    warnings,
  };
}

/** The folder of the running nmbrs binary, if it isn't on PATH (null when it is, or when running from source). */
export function binDirMissingFromPath(env: Record<string, string | undefined> = process.env): string | null {
  const exe = process.execPath;
  if (!basename(exe).startsWith("nmbrs")) return null;
  const win = process.platform === "win32";
  const real = (p: string) => {
    try {
      const r = realpathSync(resolve(p.replace(/^~(?=[\\/]|$)/, homedir())));
      return win ? r.toLowerCase() : r;
    } catch {
      return undefined;
    }
  };
  const dir = dirname(exe);
  const target = real(dir) ?? (win ? dir.toLowerCase() : dir);
  const pathVar = env.PATH ?? env.Path ?? "";
  const onPath = pathVar.split(delimiter).some((p) => p && real(p.replace(/^"|"$/g, "")) === target);
  return onPath ? null : dir;
}

/** The closing text of an interactive setup. */
export function setupSummary(r: SetupResult): string[] {
  const lines: string[] = [""];
  if (r.loggedIn && r.user?.email) lines.push(`✓ Logged in to Nmbrs Reporting (${r.environment}) as ${String(r.user.email)}.`);
  else if (r.loggedIn) lines.push(`✓ Logged in to Nmbrs Reporting (${r.environment}).`);
  else if (r.checked) lines.push(`✓ Nmbrs Reporting (${r.environment}) accepted the Client ID and Secret.`);
  else lines.push("! Saved without checking the Client ID and Secret.");
  if (r.adviserId) lines.push(`✓ Commands act for adviser ${r.adviserId}.`);
  lines.push(`✓ Saved to ${r.credentialsFile} (only you can read it).`);
  if (!r.loggedIn) lines.push("! Not logged in yet. Run `nmbrs login` to log in in your browser.");
  else lines.push("  The login lasts 180 days and renews itself whenever nmbrs is used.");
  if (r.skill?.action === "linked") lines.push(`✓ Claude skill: ${r.skill.dir} is a development link; left as is.`);
  else if (r.skill) lines.push(`✓ Claude skill ${r.skill.action} in ${r.skill.dir}.`);
  for (const w of r.warnings) lines.push(`! ${w}`);
  const bin = binDirMissingFromPath();
  if (bin) {
    lines.push(
      process.platform === "win32"
        ? `! ${bin} is not on your PATH. Run the installer again, or add it under Settings > System > About > Advanced system settings > Environment Variables.`
        : `! ${bin} is not on your PATH. Add it:  export PATH="${bin}:$PATH"`,
    );
  }
  lines.push("", "You're set. Try:", "  nmbrs administrations list");
  if (r.skill) lines.push("", 'Or ask Claude Code: "Which Nmbrs Reporting administrations do we have, and which dossiers are open?"');
  lines.push("");
  return lines;
}
