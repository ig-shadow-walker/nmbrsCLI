import type { Command } from "commander";
import { clearSession, getSession, readSession, revokeSession, sessionPath } from "../auth.ts";
import { configDir, credentialsPath } from "../config.ts";
import { Exit } from "../errors.ts";
import { consumePlan, listPlans, loadPlan, plansDir } from "../plans.ts";
import { type Runtime, applyPlan, planView, runRead } from "../runtime.ts";
import { fetchMe, loginAndSave, mask, writeCredentials } from "../setup.ts";
import { action } from "./common.ts";
import { prompters } from "./setup.ts";

const DAY = 86_400_000;

export function registerSystem(program: Command) {
  program
    .command("login")
    .description("Log in to Nmbrs Reporting in the browser (again), e.g. after the 180-day login expired")
    .option("--manual", "Paste the address the browser ends on, instead of a localhost listener")
    .option("--no-browser", "Print the login address instead of opening a browser")
    .action(
      action(async (rt: Runtime, cmd: Command) => {
        const f = cmd.opts() as { manual?: boolean; browser?: boolean };
        const config = rt.config;
        const io = prompters.make(!rt.out.json && !!process.stdin.isTTY);
        const r = await loginAndSave(config, io, f);
        const warnings = r.warning ? [r.warning] : [];
        // Remember the adviser of the user who logged in, unless one is pinned in the environment.
        const adviser = r.me?.globalAdviserId;
        if (adviser && adviser !== config.adviserId && !process.env.NMBRS_ADVISER_ID) {
          writeCredentials(credentialsPath(), { NMBRS_ADVISER_ID: adviser });
          if (config.adviserId) warnings.push(`The adviser changed from ${config.adviserId} to ${adviser}.`);
        }
        rt.success(
          {
            loggedIn: true,
            environment: config.environment,
            email: r.me?.email ?? null,
            adviserId: adviser ?? config.adviserId ?? null,
            refreshTokenExpiresAt: new Date(r.session.refreshTokenExpiresAt).toISOString(),
            sessionFile: sessionPath(config),
          },
          warnings.length ? { warnings } : undefined,
        );
        return Exit.OK;
      }),
    );

  program
    .command("logout")
    .description("Revoke the login at Nmbrs Reporting and delete it from this computer (credentials stay)")
    .action(
      action(async (rt: Runtime) => {
        const s = readSession(rt.config);
        const revoked = s ? await revokeSession(rt.config, s) : false;
        rt.success({ loggedOut: clearSession(rt.config), revoked });
        return Exit.OK;
      }),
    );

  program
    .command("apply")
    .description("Send a change that a write command planned (one plan, one apply)")
    .argument("<plan-id>", "The id from the plan (toApply)")
    .action(action(async (rt: Runtime, _c: Command, id: unknown) => applyPlan(rt, String(id))));

  const plans = program.command("plans").description("Pending plans (writes waiting for `nmbrs apply`)");
  plans
    .command("list")
    .description("Plans that can still be applied")
    .action(
      action(async (rt: Runtime) => {
        rt.success(
          listPlans().map((p) => ({ id: p.id, summary: p.summary, dangerous: p.dangerous.length > 0, expiresAt: p.expiresAt })),
          { dir: plansDir() },
        );
        return Exit.OK;
      }),
    );
  plans
    .command("show")
    .description("Show what a plan would send")
    .argument("<plan-id>")
    .action(
      action(async (rt: Runtime, _c: Command, id: unknown) => {
        rt.success(planView(loadPlan(String(id)), rt.config.apiUrl));
        return Exit.OK;
      }),
    );
  plans
    .command("discard")
    .description("Throw a plan away without sending it")
    .argument("<plan-id>")
    .action(
      action(async (rt: Runtime, _c: Command, id: unknown) => {
        rt.success({ discarded: consumePlan(String(id)), planId: String(id) });
        return Exit.OK;
      }),
    );

  const auth = program.command("auth").description("Credentials and login");
  auth
    .command("status")
    .description("Show which credentials, environment and login are used (no network)")
    .action(
      action(async (rt: Runtime) => {
        const c = rt.config;
        const s = readSession(c);
        const warnings: string[] = [];
        if (!s) warnings.push("Not logged in: run `nmbrs login`.");
        else if (s.refreshTokenExpiresAt < Date.now()) warnings.push("The login expired: run `nmbrs login`.");
        else if (s.refreshTokenExpiresAt - Date.now() < 14 * DAY) {
          warnings.push("The login expires within 14 days unless nmbrs is used before then (any command renews it).");
        }
        rt.success(
          {
            clientId: mask(c.clientId),
            environment: c.environment,
            apiUrl: c.apiUrl,
            authUrl: c.authUrl,
            redirectUri: c.redirectUri,
            adviserId: c.adviserId ?? null,
            credentialsFile: c.credentialsFile ?? credentialsPath(),
            fromEnvironment: ["NMBRS_CLIENT_ID", "NMBRS_CLIENT_SECRET", "NMBRS_ENVIRONMENT", "NMBRS_ADVISER_ID"].filter((k) => !!process.env[k]),
            configDir: configDir(),
            login: s
              ? {
                  loggedIn: true,
                  email: s.user?.email ?? null,
                  since: s.loggedInAt,
                  accessTokenExpiresAt: new Date(s.accessTokenExpiresAt).toISOString(),
                  refreshTokenExpiresAt: new Date(s.refreshTokenExpiresAt).toISOString(),
                  scope: s.scope.split(" "),
                  file: sessionPath(c),
                }
              : { loggedIn: false },
          },
          warnings.length ? { warnings } : undefined,
        );
        return Exit.OK;
      }),
    );
  auth
    .command("test")
    .description("Refresh the login and read /v1/me, to check everything works")
    .action(
      action(async (rt: Runtime) => {
        const s = await getSession(rt.config, { forceRefresh: true });
        const me = await fetchMe(rt.config);
        rt.success({
          ok: true,
          environment: rt.config.environment,
          email: me.email ?? null,
          globalAdviserId: me.globalAdviserId ?? null,
          adviserIdUsed: rt.config.adviserId ?? null,
          accessTokenExpiresAt: new Date(s.accessTokenExpiresAt).toISOString(),
          refreshTokenExpiresAt: new Date(s.refreshTokenExpiresAt).toISOString(),
        });
        return Exit.OK;
      }),
    );
  auth
    .command("refresh")
    .description("Get a new access token now (this also renews the 180-day login)")
    .action(
      action(async (rt: Runtime) => {
        const s = await getSession(rt.config, { forceRefresh: true });
        rt.success({
          refreshed: true,
          accessTokenExpiresAt: new Date(s.accessTokenExpiresAt).toISOString(),
          refreshTokenExpiresAt: new Date(s.refreshTokenExpiresAt).toISOString(),
        });
        return Exit.OK;
      }),
    );

  program
    .command("whoami")
    .description("The logged-in user and their adviser (GET /v1/me)")
    .action(action(async (rt: Runtime) => runRead(rt, { path: "/v1/me", query: {} })));
}
