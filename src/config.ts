import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { Exit, NmbrsError } from "./errors.ts";

/** The two Nmbrs Reporting environments (from the Authentication docs). */
export const ENVIRONMENTS = {
  production: { authUrl: "https://auth.reporting.nmbrs.com", apiUrl: "https://vpc-nl.reporting.nmbrs.com/public-api" },
  sandbox: { authUrl: "https://auth-sandbox.reporting.nmbrs.com", apiUrl: "https://vpc-sandbox.reporting.nmbrs.com/public-api" },
} as const;

export type Environment = keyof typeof ENVIRONMENTS;

/** public_api for the API, offline_access for a refresh token (so one login lasts 180 days). */
export const DEFAULT_SCOPES = "public_api offline_access";

/**
 * Where the browser login sends the user back to. It must be listed as a Callback URL of the
 * API connection in Connect Center. A localhost address lets `nmbrs` catch the login itself.
 */
export const DEFAULT_REDIRECT_URI = "http://localhost:47615/callback";

/** "a, b  c" -> "a b c"; empty -> the default scopes. offline_access is always added. */
export function normalizeScopes(s: string | undefined): string {
  const list = (s ?? "").split(/[\s,]+/).filter(Boolean);
  if (!list.length) return DEFAULT_SCOPES;
  if (!list.includes("offline_access")) list.push("offline_access");
  return [...new Set(list)].join(" ");
}

const trimmed = () => z.string().trim().optional().transform((s) => s || undefined);

const schema = z.object({
  NMBRS_CLIENT_ID: z.string({ error: "is missing" }).trim().min(1, "is empty"),
  NMBRS_CLIENT_SECRET: z.string({ error: "is missing" }).trim().min(1, "is empty"),
  NMBRS_ENVIRONMENT: z.enum(["production", "sandbox"]).default("production"),
  NMBRS_SCOPES: z.string().optional().transform(normalizeScopes),
  NMBRS_REDIRECT_URI: z.url().default(DEFAULT_REDIRECT_URI),
  NMBRS_ADVISER_ID: trimmed(),
  NMBRS_API_URL: z.url().optional(),
  NMBRS_AUTH_URL: z.url().optional(),
});

export interface Config {
  clientId: string;
  clientSecret: string;
  environment: Environment;
  scopes: string;
  redirectUri: string;
  /** The globalAdviserId that commands use unless --adviser-id is given. Saved by setup from /v1/me. */
  adviserId?: string;
  apiUrl: string;
  /** Base URL of the login server; /connect/authorize and /connect/token live under it. */
  authUrl: string;
  configDir: string;
  /** The credentials file that was read, if there is one. */
  credentialsFile: string | null;
}

/** Parser for the credentials file: KEY=value lines, optional quotes, # comments. */
export function parseCredentials(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2]!;
    const q = value[0];
    if ((q === '"' || q === "'") && value.lastIndexOf(q) > 0) {
      value = value.slice(1, value.lastIndexOf(q));
      if (q === '"') value = value.replace(/\\(["\\n])/g, (_, c: string) => (c === "n" ? "\n" : c));
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    out[m[1]!] = value;
  }
  return out;
}

export function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") || p.startsWith("~\\") ? join(homedir(), p.slice(1)) : p;
}

/** ~/.config/nmbrs on macOS and Linux, %APPDATA%\\nmbrs on Windows; NMBRS_CONFIG_DIR overrides both. */
export function configDir(env: Record<string, string | undefined> = process.env): string {
  if (env.NMBRS_CONFIG_DIR) return resolve(expandHome(env.NMBRS_CONFIG_DIR));
  if (process.platform === "win32") return join(env.APPDATA || join(homedir(), "AppData", "Roaming"), "nmbrs");
  return join(homedir(), ".config", "nmbrs");
}

/** Where `nmbrs setup` saves the credentials: <config dir>/credentials (mode 600). */
export function credentialsPath(env: Record<string, string | undefined> = process.env): string {
  return join(configDir(env), "credentials");
}

/** API and login URLs for an environment, with the NMBRS_API_URL / NMBRS_AUTH_URL overrides applied. */
export function urlsFor(environment: Environment, overrides: { apiUrl?: string; authUrl?: string } = {}) {
  const base = ENVIRONMENTS[environment];
  return {
    apiUrl: (overrides.apiUrl ?? base.apiUrl).replace(/\/+$/, ""),
    authUrl: (overrides.authUrl ?? base.authUrl).replace(/\/+$/, ""),
  };
}

/** The saved credentials file merged with NMBRS_* environment variables (which win). */
export function readSettings(env: Record<string, string | undefined> = process.env): { values: Record<string, string>; file: string; found: boolean } {
  const values: Record<string, string> = {};
  const file = credentialsPath(env);
  const found = existsSync(file);
  if (found) {
    for (const [k, v] of Object.entries(parseCredentials(readFileSync(file, "utf8")))) {
      if (k.startsWith("NMBRS_") && v !== "") values[k] = v;
    }
  }
  for (const [k, v] of Object.entries(env)) if (k.startsWith("NMBRS_") && v) values[k] = v;
  return { values, file, found };
}

/**
 * Builds the config from the credentials file that `nmbrs setup` writes. NMBRS_* environment
 * variables win over the file, for CI and containers. Nothing is read from the current folder.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const { values, file, found } = readSettings(env);
  const parsed = schema.safeParse(values);
  if (!parsed.success) {
    const bad = parsed.error.issues.map((i) => `${String(i.path[0])} ${i.message}`).join("; ");
    const missing = !values.NMBRS_CLIENT_ID || !values.NMBRS_CLIENT_SECRET;
    throw new NmbrsError(missing ? "nmbrs is not connected to Nmbrs Reporting yet." : `The nmbrs settings are not valid: ${bad}`, Exit.AUTH, {
      key: "config.missing",
      hint: missing
        ? "Run `nmbrs setup` in a terminal: it asks for the Client ID and Secret of your API connection, logs you in and saves everything."
        : `Fix ${file} (or the NMBRS_* environment variables), or run \`nmbrs setup\` again.`,
    });
  }
  const c = parsed.data;
  return {
    clientId: c.NMBRS_CLIENT_ID,
    clientSecret: c.NMBRS_CLIENT_SECRET,
    environment: c.NMBRS_ENVIRONMENT,
    scopes: c.NMBRS_SCOPES,
    redirectUri: c.NMBRS_REDIRECT_URI,
    adviserId: c.NMBRS_ADVISER_ID,
    ...urlsFor(c.NMBRS_ENVIRONMENT, { apiUrl: c.NMBRS_API_URL, authUrl: c.NMBRS_AUTH_URL }),
    configDir: configDir(env),
    credentialsFile: found ? file : null,
  };
}
