import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSession } from "../src/auth.ts";
import { buildProgram } from "../src/cli.ts";
import { loadConfig } from "../src/config.ts";

export interface Call {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
}

type Handler = (call: Call) => Response | Promise<Response> | undefined;

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export const AUTH_HOST = "auth.nmbrs.test";
export const API_HOST = "api.nmbrs.test";
export const AUTH_URL = `https://${AUTH_HOST}`;
export const API_URL = `https://${API_HOST}/public-api`;
export const ADVISER = "11111111-1111-1111-1111-111111111111";

function sha256url(s: string): string {
  return Buffer.from(new Bun.CryptoHasher("sha256").update(s).digest()).toString("base64url");
}

/**
 * A fake Nmbrs Reporting: the login server (authorize, token with PKCE and rotating refresh
 * tokens, revocation) plus whatever API routes a test adds. Records every call.
 */
export class FakeNmbrs {
  calls: Call[] = [];
  clientId = "good-client";
  clientSecret = "good-secret";
  /** The refresh token that is currently valid; every refresh replaces it. */
  refreshToken: string | undefined;
  refreshes = 0;
  /** What the loopback listener showed the browser at the end of the login. */
  lastPage?: { status: number; text: string };
  issued = 0;
  /** What the "user" does on the login page: log in, or refuse. */
  loginOutcome: "ok" | "access_denied" = "ok";
  private codes = new Map<string, { challenge: string; redirectUri: string }>();
  private routes: Array<{ method: string; path: string | RegExp; handler: Handler }> = [];
  private original = globalThis.fetch;

  on(method: string, path: string | RegExp, handler: Handler | Record<string, unknown>) {
    this.routes.push({
      method,
      path,
      handler: typeof handler === "function" ? (handler as Handler) : () => json(200, handler),
    });
    return this;
  }

  apiCalls(): Call[] {
    return this.calls.filter((c) => c.url.hostname === API_HOST);
  }

  /** Plays the browser: opens the login page and follows its redirect back to nmbrs. */
  browser = async (address: string): Promise<boolean> => {
    const res = await fetch(address, { redirect: "manual" });
    const location = res.headers.get("location");
    if (!location) throw new Error(`login page did not redirect (${res.status})`);
    const back = await this.original(location);
    this.lastPage = { status: back.status, text: await back.text() };
    return true;
  };

  /** The address the login would have sent the browser to, for --manual tests. */
  async redirectFor(address: string): Promise<string> {
    const res = await fetch(address, { redirect: "manual" });
    return res.headers.get("location")!;
  }

  private issue(scope: string) {
    this.issued++;
    this.refreshToken = `refresh-${this.issued}`;
    return json(200, {
      access_token: `access-${this.issued}`,
      refresh_token: this.refreshToken,
      expires_in: 3600,
      token_type: "Bearer",
      scope,
    });
  }

  private token(form: Record<string, string>): Response {
    if (form.client_id !== this.clientId || form.client_secret !== this.clientSecret) {
      return json(400, { error: "invalid_client" });
    }
    if (form.grant_type === "client_credentials") return json(400, { error: "unauthorized_client" });
    if (form.grant_type === "authorization_code") {
      const c = this.codes.get(form.code ?? "");
      if (!c || c.redirectUri !== form.redirect_uri || sha256url(form.code_verifier ?? "") !== c.challenge) {
        return json(400, { error: "invalid_grant" });
      }
      if (form.code_verifier!.length !== 64) return json(400, { error: "invalid_request", error_description: "verifier length" });
      this.codes.delete(form.code!);
      return this.issue("public_api offline_access");
    }
    if (form.grant_type === "refresh_token") {
      if (!this.refreshToken || form.refresh_token !== this.refreshToken) return json(400, { error: "invalid_grant" });
      this.refreshes++;
      return this.issue("public_api offline_access");
    }
    return json(400, { error: "unsupported_grant_type" });
  }

  install() {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname !== AUTH_HOST && url.hostname !== API_HOST) return this.original(input as never, init);
      const method = (init?.method ?? "GET").toUpperCase();
      let body: unknown = init?.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          /* form body */
        }
      } else if (body instanceof URLSearchParams) {
        body = Object.fromEntries(body);
      }
      const call: Call = { method, url, headers: new Headers(init?.headers), body };
      this.calls.push(call);

      if (url.hostname === AUTH_HOST) {
        if (url.pathname === "/connect/token") return this.token(body as Record<string, string>);
        if (url.pathname === "/connect/revocation") return new Response(null, { status: 200 });
        if (url.pathname === "/connect/authorize") {
          const p = url.searchParams;
          const back = new URL(p.get("redirect_uri")!);
          if (this.loginOutcome === "access_denied") {
            back.search = new URLSearchParams({ error: "access_denied", state: p.get("state")! }).toString();
          } else {
            const code = `code-${this.codes.size + 1}-${Math.random().toString(36).slice(2)}`;
            this.codes.set(code, { challenge: p.get("code_challenge")!, redirectUri: p.get("redirect_uri")! });
            back.search = new URLSearchParams({ code, state: p.get("state")! }).toString();
          }
          return new Response(null, { status: 302, headers: { location: back.toString() } });
        }
        return json(404, {});
      }

      const auth = call.headers.get("authorization") ?? "";
      if (!/^Bearer access-\d+$/.test(auth) || auth !== `Bearer access-${this.issued}`) return new Response(null, { status: 401 });
      for (const r of this.routes) {
        const path = url.pathname.replace(/^\/public-api/, "");
        const pathOk = typeof r.path === "string" ? r.path === path : r.path.test(path);
        if (r.method === method && pathOk) {
          const res = await r.handler(call);
          if (res) return res;
        }
      }
      return json(404, { errors: [{ status: "404", title: "Not Found", detail: `No fake route for ${method} ${url.pathname}` }] });
    }) as typeof fetch;
    return this;
  }

  restore() {
    globalThis.fetch = this.original;
  }
}

/** A free-looking port for the loopback login. */
export function randomPort(): number {
  return 40000 + Math.floor(Math.random() * 20000);
}

/** Isolated config dir and settings for one test. */
export function testEnv(opts: { credentials?: boolean } = { credentials: true }) {
  const dir = mkdtempSync(join(tmpdir(), "nmbrs-test-"));
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) if (k.startsWith("NMBRS_")) delete process.env[k];
  process.env.NMBRS_CONFIG_DIR = dir;
  process.env.NMBRS_AUTH_URL = AUTH_URL;
  process.env.NMBRS_API_URL = API_URL;
  process.env.NMBRS_REDIRECT_URI = `http://127.0.0.1:${randomPort()}/callback`;
  if (opts.credentials) {
    process.env.NMBRS_CLIENT_ID = "good-client";
    process.env.NMBRS_CLIENT_SECRET = "good-secret";
    process.env.NMBRS_ADVISER_ID = ADVISER;
  }
  process.env.CLAUDE_SKILLS_DIR = join(dir, "skills"); // never touch the real ~/.claude
  return {
    dir,
    cleanup() {
      process.env = saved;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Pretends a login happened: the fake issues tokens and the session file holds them. */
export function loggedIn(fake: FakeNmbrs, opts: { expired?: boolean } = {}) {
  fake.issued++;
  fake.refreshToken = `refresh-${fake.issued}`;
  const config = loadConfig();
  writeSession(config, {
    refreshToken: fake.refreshToken,
    refreshTokenExpiresAt: Date.now() + 180 * 86_400_000,
    accessToken: `access-${fake.issued}`,
    accessTokenExpiresAt: opts.expired ? Date.now() - 1000 : Date.now() + 3_600_000,
    scope: "public_api offline_access",
    loggedInAt: new Date().toISOString(),
    fingerprint: new Bun.CryptoHasher("sha256").update(`${config.authUrl}\n${config.clientId}`).digest("hex").slice(0, 16),
  });
  return config;
}

/** Runs the CLI in-process and captures stdout/stderr and the exit code. */
export async function runCli(...args: string[]) {
  let stdout = "";
  let stderr = "";
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((s: string | Uint8Array) => ((stdout += String(s)), true)) as typeof process.stdout.write;
  process.stderr.write = ((s: string | Uint8Array) => ((stderr += String(s)), true)) as typeof process.stderr.write;
  process.exitCode = 0;
  try {
    const program = buildProgram();
    program.exitOverride();
    program.configureOutput({ writeOut: (s) => (stdout += s), writeErr: (s) => (stderr += s) });
    await program.parseAsync(["bun", "nmbrs", ...args]);
  } catch (e) {
    const code = (e as { exitCode?: number }).exitCode;
    if (code === undefined) throw e;
    process.exitCode = code;
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
  const code = Number(process.exitCode ?? 0);
  process.exitCode = 0;
  let parsed: any;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = undefined;
  }
  return { stdout, stderr, code, json: parsed };
}
