import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { readSession } from "../src/auth.ts";
import { loadConfig, parseCredentials } from "../src/config.ts";
import { NmbrsError } from "../src/errors.ts";
import type { AskOptions, Prompter } from "../src/prompt.ts";
import { runSetup, writeCredentials } from "../src/setup.ts";
import { installSkill } from "../src/skill.ts";
import { ADVISER, FakeNmbrs, json, testEnv } from "./helpers.ts";

/** Answers questions from a script and records what was asked and said. */
class ScriptedPrompter implements Prompter {
  asked: string[] = [];
  said: string[] = [];
  constructor(
    private answers: Array<string | (() => Promise<string>)>,
    readonly interactive = true,
  ) {}
  say(text = "") {
    this.said.push(text);
  }
  private async next(question: string): Promise<string> {
    this.asked.push(question);
    const a = this.answers.shift();
    if (a === undefined) throw new Error(`unexpected question: ${question}`);
    if (a === "<ctrl-c>") throw new NmbrsError("Setup cancelled; nothing was saved.");
    return typeof a === "function" ? a() : a;
  }
  async ask(question: string, opts: AskOptions = {}) {
    return (await this.next(question)) || opts.default || "";
  }
  async confirm(question: string, defaultYes: boolean) {
    const a = await this.next(question);
    return a === "" ? defaultYes : a === "y";
  }
}

const reference = () => "# ref\n";

describe("nmbrs setup", () => {
  let env: ReturnType<typeof testEnv>;
  let fake: FakeNmbrs;
  let vars: Record<string, string | undefined>;
  beforeEach(() => {
    env = testEnv({ credentials: false });
    vars = {
      NMBRS_CONFIG_DIR: env.dir,
      NMBRS_AUTH_URL: process.env.NMBRS_AUTH_URL,
      NMBRS_API_URL: process.env.NMBRS_API_URL,
      NMBRS_REDIRECT_URI: process.env.NMBRS_REDIRECT_URI,
      CLAUDE_SKILLS_DIR: join(env.dir, "skills"),
      PATH: process.env.PATH,
    };
    fake = new FakeNmbrs()
      .on("GET", "/v1/me", { data: { type: "me", attributes: { email: "anna@kantoor.nl", globalAdviserId: ADVISER, applicationClientId: "good-client" } } })
      .install();
  });
  afterEach(() => {
    fake.restore();
    env.cleanup();
  });

  test("interactive: re-asks after a wrong secret, logs in through the browser, saves everything privately", async () => {
    const io = new ScriptedPrompter(["good-client", "bad-secret", "good-client", "good-secret", "y", "y"]);
    const r = await runSetup({}, io, { reference, env: vars, login: { open: fake.browser } });
    expect(io.asked).toEqual([
      "Client ID",
      "Client Secret (hidden)",
      "Client ID",
      "Client Secret (hidden)",
      "Log in to Nmbrs Reporting now (your browser opens)?",
      "Install the Claude skill, so Claude Code knows how to use nmbrs?",
    ]);
    expect(io.said.join("\n")).toContain("did not accept");
    expect(io.said.join("\n")).toContain(vars.NMBRS_REDIRECT_URI!); // tells which Callback URL to register
    expect(r.loggedIn).toBe(true);
    expect(fake.lastPage?.status).toBe(200);
    expect(fake.lastPage?.text).toContain("Logged in to Nmbrs Reporting");
    expect(r.user).toEqual({ email: "anna@kantoor.nl", globalAdviserId: ADVISER });
    expect(r.adviserId).toBe(ADVISER);
    expect(r.environment).toBe("production");

    const file = join(env.dir, "credentials");
    const saved = parseCredentials(readFileSync(file, "utf8"));
    expect(saved).toMatchObject({
      NMBRS_CLIENT_ID: "good-client",
      NMBRS_CLIENT_SECRET: "good-secret",
      NMBRS_ENVIRONMENT: "production",
      NMBRS_ADVISER_ID: ADVISER,
    });
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(statSync(join(env.dir, "session.json")).mode & 0o777).toBe(0o600);
    }
    const session = readSession(loadConfig(vars))!;
    expect(session.refreshToken).toBe(fake.refreshToken!);
    expect(session.user?.email).toBe("anna@kantoor.nl");
    expect(existsSync(join(env.dir, "skills", "nmbrs", "SKILL.md"))).toBe(true);

    // The authorize request used PKCE (S256) and asked for a refresh token.
    const authorize = fake.calls.find((c) => c.url.pathname === "/connect/authorize")!;
    expect(authorize.url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.url.searchParams.get("scope")).toBe("public_api offline_access");
    expect(authorize.url.searchParams.get("redirect_uri")).toBe(vars.NMBRS_REDIRECT_URI!);
  });

  test("finds out that the API connection belongs to the sandbox", async () => {
    // Production refuses the client; the sandbox (same fake, other URL) accepts it.
    delete vars.NMBRS_AUTH_URL;
    const prod = new FakeNmbrs();
    fake.restore();
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname === "auth.reporting.nmbrs.com") return json(400, { error: "invalid_client" });
      if (url.hostname === "auth-sandbox.reporting.nmbrs.com") return json(400, { error: "unauthorized_client" });
      return original(input as never, init);
    }) as typeof fetch;
    try {
      const io = new ScriptedPrompter(["good-client", "good-secret"], false);
      const r = await runSetup({ login: false, clientId: "good-client", clientSecret: "good-secret" }, io, { reference, env: vars });
      expect(r.environment).toBe("sandbox");
      expect(io.said.join("\n")).toContain("sandbox environment");
      expect(parseCredentials(readFileSync(join(env.dir, "credentials"), "utf8")).NMBRS_ENVIRONMENT).toBe("sandbox");
    } finally {
      globalThis.fetch = original;
      void prod;
    }
  });

  test("without a terminal: flags and stdin secret, no login, skill installed", async () => {
    const io = new ScriptedPrompter([], false);
    const r = await runSetup({ clientId: "good-client", clientSecret: "good-secret", login: false }, io, { reference, env: vars });
    expect(io.asked).toEqual([]);
    expect(r.loggedIn).toBe(false);
    expect(r.checked).toBe(true);
    expect(r.skill?.action).toBe("installed");
    expect(readSession(loadConfig(vars))).toBeUndefined();
  });

  test("without a terminal and without credentials it says how to run it", async () => {
    const io = new ScriptedPrompter([], false);
    const e = await runSetup({ login: false }, io, { reference, env: vars }).catch((x) => x);
    expect(e).toBeInstanceOf(NmbrsError);
    expect(e.extra.key).toBe("setup.needs_input");
    expect(e.exitCode).toBe(3);
  });

  test("a wrong secret without a terminal fails with exit 3 and saves nothing", async () => {
    const io = new ScriptedPrompter([], false);
    const e = await runSetup({ clientId: "good-client", clientSecret: "nope", login: false, environment: "production" }, io, {
      reference,
      env: vars,
    }).catch((x) => x);
    expect(e.extra.key).toBe("setup.invalid_client");
    expect(existsSync(join(env.dir, "credentials"))).toBe(false);
  });

  test("--manual: paste the address the browser ended on", async () => {
    let authorizeUrl = "";
    const io = new ScriptedPrompter(["y", async () => fake.redirectFor(authorizeUrl)]);
    const r = await runSetup({ clientId: "good-client", clientSecret: "good-secret", manual: true, skill: false }, io, {
      reference,
      env: vars,
      login: {
        open: (url) => {
          authorizeUrl = url;
          return true;
        },
      },
    });
    expect(io.asked).toEqual(["Log in to Nmbrs Reporting now (you get an address to open)?", "Paste that whole address here"]);
    expect(r.loggedIn).toBe(true);
    expect(r.skill).toBeNull();
  });

  test("a refused login leaves the credentials saved so `nmbrs login` can retry", async () => {
    fake.loginOutcome = "access_denied";
    const io = new ScriptedPrompter([], false);
    const e = await runSetup({ clientId: "good-client", clientSecret: "good-secret" }, io, {
      reference,
      env: vars,
      login: { open: fake.browser },
    }).catch((x) => x);
    expect(e.extra.key).toBe("login.access_denied");
    expect(fake.lastPage?.status).toBe(400);
    expect(parseCredentials(readFileSync(join(env.dir, "credentials"), "utf8")).NMBRS_CLIENT_ID).toBe("good-client");
  });

  test("cancelling before the browser opens saves nothing", async () => {
    const io = new ScriptedPrompter(["good-client", "good-secret", "<ctrl-c>"]);
    await expect(runSetup({}, io, { reference, env: vars })).rejects.toThrow("cancelled");
    expect(existsSync(join(env.dir, "credentials"))).toBe(false);
  });

  test("writeCredentials keeps other settings, removes cleared ones and quotes odd values", () => {
    const file = join(env.dir, "credentials");
    writeCredentials(file, { NMBRS_CLIENT_ID: "a", NMBRS_SCOPES: "public_api offline_access", NMBRS_ADVISER_ID: "x" });
    writeCredentials(file, { NMBRS_CLIENT_SECRET: 'we"ird\\ secret', NMBRS_ADVISER_ID: undefined });
    const saved = parseCredentials(readFileSync(file, "utf8"));
    expect(saved).toEqual({ NMBRS_CLIENT_ID: "a", NMBRS_SCOPES: "public_api offline_access", NMBRS_CLIENT_SECRET: 'we"ird\\ secret' });
  });

  test("skill install leaves a development symlink alone unless forced", () => {
    const target = join(env.dir, "dev-skill");
    mkdirSync(target);
    const dir = join(env.dir, "skills2", "nmbrs");
    mkdirSync(join(env.dir, "skills2"));
    symlinkSync(target, dir);
    expect(installSkill("# r\n", { dir }).action).toBe("linked");
    expect(installSkill("# r\n", { dir, force: true }).action).toBe("updated");
    expect(lstatSync(dir).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toContain("name: nmbrs");
  });
});
