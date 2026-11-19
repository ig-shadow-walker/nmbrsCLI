import { exchangeCode, type Session } from "./auth.ts";
import type { Config } from "./config.ts";
import { Exit, NmbrsError } from "./errors.ts";
import type { Prompter } from "./prompt.ts";

const LOGIN_TIMEOUT_MS = 5 * 60_000;

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PKCE (RFC 7636): Nmbrs Reporting wants a 64-character code verifier and an S256 challenge. */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64url(new Bun.CryptoHasher("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function authorizeUrl(config: Config, p: { state: string; challenge: string }): string {
  const url = new URL(`${config.authUrl}/connect/authorize`);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scopes,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    state: p.state,
    prompt: "login",
  }).toString();
  return url.toString();
}

/** Takes the code out of the address the login sent the browser to (or the error it reports). */
export function parseCallback(address: string, expectedState: string): string {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    throw new NmbrsError("That is not a web address.", Exit.ERROR, { key: "login.bad_callback" });
  }
  const q = url.searchParams.size ? url.searchParams : new URLSearchParams(url.hash.slice(1));
  const error = q.get("error");
  if (error) {
    throw new NmbrsError(`The Nmbrs Reporting login failed: ${error}${q.get("error_description") ? `: ${q.get("error_description")}` : ""}`, Exit.AUTH, {
      key: `login.${error}`,
      hint:
        error === "access_denied"
          ? "The login was cancelled or consent was refused. Run `nmbrs login` to try again."
          : "Check the API connection in Connect Center (its Callback URL and that it is active), then run `nmbrs login` again.",
    });
  }
  const code = q.get("code");
  if (!code) throw new NmbrsError("That address has no login code in it.", Exit.ERROR, { key: "login.no_code" });
  if (q.get("state") !== expectedState) {
    throw new NmbrsError("The login answer does not belong to this login (state mismatch).", Exit.AUTH, {
      key: "login.state_mismatch",
      hint: "Run `nmbrs login` again and finish the login in the browser tab it opens.",
    });
  }
  return code;
}

/** True when the redirect URI points at this computer, so nmbrs can receive the login itself. */
export function isLoopback(redirectUri: string): boolean {
  try {
    const u = new URL(redirectUri);
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

const PAGE = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;line-height:1.5">` +
  `<h1 style="font-size:1.4rem">${title}</h1><p>${text}</p></body>`;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Listens on the redirect URI until the browser comes back with the code. */
export async function waitForCallback(redirectUri: string, state: string, timeoutMs = LOGIN_TIMEOUT_MS): Promise<{ code: Promise<string>; stop: () => void }> {
  const target = new URL(redirectUri);
  const port = Number(target.port || 80);
  let resolve!: (code: string) => void;
  let reject!: (e: unknown) => void;
  const code = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const fetchHandler = (req: Request) => {
    const url = new URL(req.url);
    if (url.pathname !== target.pathname) return new Response("Not found", { status: 404 });
    try {
      const c = parseCallback(req.url, state);
      resolve(c);
      return new Response(PAGE("Logged in to Nmbrs Reporting", "You can close this tab and go back to the terminal."), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (e) {
      reject(e);
      return new Response(PAGE("Login failed", escapeHtml((e as Error).message) + "<br>Go back to the terminal for what to do next."), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  };
  // "localhost" can mean 127.0.0.1 or ::1 depending on the browser; listen on both where possible.
  const hosts = target.hostname === "[::1]" ? ["::1"] : target.hostname === "127.0.0.1" ? ["127.0.0.1"] : ["127.0.0.1", "::1"];
  const servers: ReturnType<typeof Bun.serve>[] = [];
  for (const hostname of hosts) {
    try {
      servers.push(Bun.serve({ port, hostname, fetch: fetchHandler }));
    } catch (e) {
      if (hostname === hosts[0]) {
        throw new NmbrsError(`Can't listen on ${target.host} for the login: ${(e as Error).message}`, Exit.ERROR, {
          key: "login.port_in_use",
          hint: `Close whatever uses port ${port}, or log in with \`nmbrs login --manual\`.`,
        });
      }
    }
  }
  const timer = setTimeout(
    () =>
      reject(
        new NmbrsError("The browser login did not come back within 5 minutes.", Exit.AUTH, {
          key: "login.timeout",
          hint:
            `If the login page showed an error about the redirect or callback, add ${redirectUri} as a Callback URL ` +
            "of the API connection in Connect Center. Then run `nmbrs login` again (or `nmbrs login --manual`).",
        }),
      ),
    timeoutMs,
  );
  // Graceful stop: the browser's request in flight still gets its "you can close this tab" page.
  const stop = () => {
    clearTimeout(timer);
    for (const s of servers) void s.stop(false);
  };
  code.then(stop, stop);
  return { code, stop };
}

/** Opens a URL in the default browser. Returns false if that didn't work (the URL is printed anyway). */
export function openBrowser(url: string): boolean {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["rundll32", "url.dll,FileProtocolHandler", url]
        : ["xdg-open", url];
  try {
    const p = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
    p.unref();
    return true;
  } catch {
    return false;
  }
}

export interface LoginOptions {
  /** Don't try to open a browser; print the address instead. */
  browser?: boolean;
  /** Paste the address the login ended on instead of listening on localhost. */
  manual?: boolean;
}

export interface LoginDeps {
  /** Replaced in tests to play the browser. */
  open?: (url: string) => boolean | Promise<boolean>;
  timeoutMs?: number;
}

/** The browser login (authorization code + PKCE). Returns the new, unsaved session. */
export async function browserLogin(config: Config, io: Prompter, o: LoginOptions = {}, deps: LoginDeps = {}): Promise<Session> {
  const { verifier, challenge } = createPkce();
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const url = authorizeUrl(config, { state, challenge });
  const manual = o.manual || !isLoopback(config.redirectUri);

  if (manual && !io.interactive) {
    throw new NmbrsError("Logging in with a pasted address needs a terminal.", Exit.ERROR, {
      key: "login.needs_terminal",
      hint: "Run `nmbrs login` in a terminal.",
    });
  }

  let code: string;
  if (manual) {
    io.say("Open this address in a browser and log in to Nmbrs Reporting:");
    io.say("");
    io.say(`  ${url}`);
    io.say("");
    if (o.browser !== false) await (deps.open ?? openBrowser)(url);
    io.say(`After logging in, the browser goes to ${config.redirectUri}?code=… (the page itself may not load).`);
    const pasted = await io.ask("Paste that whole address here", { required: true });
    code = parseCallback(pasted, state);
  } else {
    const waiting = await waitForCallback(config.redirectUri, state, deps.timeoutMs);
    try {
      const opened = o.browser !== false && (await (deps.open ?? openBrowser)(url));
      io.say(opened ? "Your browser opens to log in to Nmbrs Reporting. If it doesn't, open this address:" : "Open this address in a browser on this computer to log in to Nmbrs Reporting:");
      io.say("");
      io.say(`  ${url}`);
      io.say("");
      io.say("Waiting for the login to finish (Ctrl-C to cancel)…");
      code = await waiting.code;
    } finally {
      waiting.stop();
    }
  }
  return exchangeCode(config, code, verifier);
}
