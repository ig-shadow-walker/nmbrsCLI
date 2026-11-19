import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.ts";
import { Exit, LOGIN_HINT, NmbrsError } from "./errors.ts";

/**
 * What a login leaves behind: a refresh token (single use, valid 180 days, replaced on every
 * refresh) and the current access token (valid 60 minutes). Stored in <config dir>/session.json, mode 600.
 */
export interface Session {
  refreshToken: string;
  /** Epoch ms. Nmbrs Reporting refresh tokens last 180 days and every refresh starts a new 180 days. */
  refreshTokenExpiresAt: number;
  accessToken: string;
  /** Epoch ms. */
  accessTokenExpiresAt: number;
  scope: string;
  /** Who logged in, from /v1/me. */
  user?: { email?: string; globalAdviserId?: string };
  loggedInAt: string;
  /** Identifies the login server and API connection the tokens belong to. */
  fingerprint: string;
}

export const REFRESH_TOKEN_DAYS = 180;
/** Refresh this long before the access token actually expires. */
const EXPIRY_MARGIN_MS = 120_000;
const TOKEN_TIMEOUT_MS = 30_000;
/** A lock older than this was left behind by a process that died; take it over. */
const STALE_LOCK_MS = 60_000;
const LOCK_WAIT_MS = 45_000;

export function sessionPath(config: Pick<Config, "configDir">): string {
  return join(config.configDir, "session.json");
}

function fingerprint(config: Pick<Config, "authUrl" | "clientId">): string {
  return new Bun.CryptoHasher("sha256").update(`${config.authUrl}\n${config.clientId}`).digest("hex").slice(0, 16);
}

export function readSession(config: Config): Session | undefined {
  const file = sessionPath(config);
  if (!existsSync(file)) return undefined;
  try {
    const s = JSON.parse(readFileSync(file, "utf8")) as Session;
    if (s.fingerprint !== fingerprint(config) || typeof s.refreshToken !== "string") return undefined;
    return s;
  } catch {
    return undefined;
  }
}

/** Writes the session atomically (temp file + rename), so a crash never leaves half a refresh token. */
export function writeSession(config: Config, session: Session): void {
  mkdirSync(config.configDir, { recursive: true, mode: 0o700 });
  const file = sessionPath(config);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(session, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

export function clearSession(config: Config): boolean {
  const file = sessionPath(config);
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
}

/** POSTs a form to /connect/token with the client id and secret (client_secret_post). */
export async function tokenRequest(config: Config, form: Record<string, string>): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch(`${config.authUrl}/connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ ...form, client_id: config.clientId, client_secret: config.clientSecret }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
  } catch (e) {
    throw new NmbrsError(`Could not reach the Nmbrs Reporting login server: ${(e as Error).message}`, Exit.UNAVAILABLE, {
      key: "token.unreachable",
    });
  }
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON error page */
  }
  if (res.ok && typeof body.access_token === "string") return body as unknown as TokenResponse;

  const code = String(body.error ?? `http_${res.status}`);
  const desc = String(body.error_description ?? (text.slice(0, 200) || res.statusText));
  const hint =
    code === "invalid_client"
      ? "The Client ID or Client Secret is wrong. Check them in Connect Center and run `nmbrs setup` again."
      : code === "invalid_grant"
        ? `The login has expired or was used elsewhere. ${LOGIN_HINT}`
        : code === "invalid_scope" || code === "unauthorized_client"
          ? "The API connection is not allowed to do this. Check it in Connect Center, or ask Nmbrs Reporting support."
          : undefined;
  throw new NmbrsError(`Nmbrs Reporting login failed: ${code}: ${desc}`, res.status >= 500 ? Exit.UNAVAILABLE : Exit.AUTH, {
    status: res.status,
    key: `token.${code}`,
    hint,
  });
}

function toSession(config: Config, t: TokenResponse, previous?: Session): Session {
  const now = Date.now();
  const refreshToken = t.refresh_token ?? previous?.refreshToken;
  if (!refreshToken) {
    throw new NmbrsError("Nmbrs Reporting did not return a refresh token.", Exit.AUTH, {
      key: "token.no_refresh_token",
      hint: "The login must ask for the offline_access scope. Remove NMBRS_SCOPES if you set it, and run `nmbrs login`.",
    });
  }
  return {
    refreshToken,
    refreshTokenExpiresAt: t.refresh_token ? now + REFRESH_TOKEN_DAYS * 86_400_000 : previous!.refreshTokenExpiresAt,
    accessToken: t.access_token,
    accessTokenExpiresAt: now + Number(t.expires_in ?? 3600) * 1000,
    scope: t.scope ?? config.scopes,
    user: previous?.user,
    loggedInAt: previous?.loggedInAt ?? new Date(now).toISOString(),
    fingerprint: fingerprint(config),
  };
}

/** Exchanges the code from the browser login for tokens (authorization code + PKCE). Does not save. */
export async function exchangeCode(config: Config, code: string, codeVerifier: string): Promise<Session> {
  const t = await tokenRequest(config, {
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier,
  });
  return toSession(config, t);
}

/** Holds a lock file around a refresh, so two nmbrs processes never spend the same refresh token. */
async function withLock<T>(config: Config, fn: () => Promise<T>): Promise<T> {
  mkdirSync(config.configDir, { recursive: true, mode: 0o700 });
  const lock = join(config.configDir, "session.lock");
  const start = Date.now();
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS) rmSync(lock, { recursive: true, force: true });
      } catch {
        /* removed by its owner meanwhile */
      }
      if (Date.now() - start > LOCK_WAIT_MS) {
        throw new NmbrsError("Another nmbrs command is refreshing the login and did not finish.", Exit.UNAVAILABLE, {
          key: "session.locked",
          hint: `If no other nmbrs command is running, delete ${lock} and try again.`,
        });
      }
      await Bun.sleep(100);
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function notLoggedIn(): NmbrsError {
  return new NmbrsError("nmbrs is not logged in to Nmbrs Reporting.", Exit.AUTH, {
    key: "session.missing",
    hint: "Run `nmbrs login` (or `nmbrs setup`) in a terminal; it opens the browser to log in.",
  });
}

const fresh = (s: Session) => s.accessTokenExpiresAt - EXPIRY_MARGIN_MS > Date.now();

/** Returns a valid access token, refreshing (and rotating the refresh token) when needed. */
export async function getSession(config: Config, opts: { forceRefresh?: boolean } = {}): Promise<Session> {
  const before = readSession(config);
  if (!before) throw notLoggedIn();
  if (!opts.forceRefresh && fresh(before)) return before;
  return withLock(config, async () => {
    const current = readSession(config);
    if (!current) throw notLoggedIn();
    // Another process refreshed while we waited for the lock: use its token.
    if (current.refreshToken !== before.refreshToken && fresh(current)) return current;
    if (current.refreshTokenExpiresAt < Date.now()) {
      throw new NmbrsError("The Nmbrs Reporting login expired (refresh tokens last 180 days).", Exit.AUTH, {
        key: "session.expired",
        hint: LOGIN_HINT,
      });
    }
    const t = await tokenRequest(config, { grant_type: "refresh_token", refresh_token: current.refreshToken });
    const next = toSession(config, t, current);
    writeSession(config, next);
    return next;
  });
}

/** Revokes the refresh token at the login server. Best effort: returns false if that failed. */
export async function revokeSession(config: Config, session: Session): Promise<boolean> {
  try {
    const res = await fetch(`${config.authUrl}/connect/revocation`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: session.refreshToken,
        token_type_hint: "refresh_token",
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Checks a Client ID and Secret without a browser: asks for a client-credentials token. Only
 * invalid_client means they are wrong; refusing the grant or scope still proves they are right.
 */
export async function checkClientCredentials(config: Config): Promise<"ok" | "invalid"> {
  try {
    await tokenRequest(config, { grant_type: "client_credentials", scope: "public_api" });
    return "ok";
  } catch (e) {
    if (e instanceof NmbrsError && e.extra.key === "token.invalid_client") return "invalid";
    if (e instanceof NmbrsError && e.exitCode === Exit.UNAVAILABLE) throw e;
    return "ok";
  }
}
