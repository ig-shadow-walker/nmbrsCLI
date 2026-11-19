import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ADVISER, FakeNmbrs, json, loggedIn, runCli, testEnv } from "./helpers.ts";

const ADMIN = "22222222-2222-2222-2222-222222222222";
const HOOK = "33333333-3333-3333-3333-333333333333";

const admin = (n: number) => ({
  type: "administrations",
  attributes: { administrationId: `${ADMIN.slice(0, -1)}${n}`, name: `Klant ${n}`, clientIdentifier: `K${n}`, cocNumber: `1234567${n}` },
});

describe("nmbrs commands", () => {
  let env: ReturnType<typeof testEnv>;
  let fake: FakeNmbrs;
  beforeEach(() => {
    env = testEnv();
    fake = new FakeNmbrs().install();
    loggedIn(fake);
  });
  afterEach(() => {
    fake.restore();
    env.cleanup();
  });

  test("not set up: exit 3 with a hint to run setup", async () => {
    for (const k of ["NMBRS_CLIENT_ID", "NMBRS_CLIENT_SECRET"]) delete process.env[k];
    const r = await runCli("administrations", "list", "--json");
    expect(r.code).toBe(3);
    expect(r.json.error.hint).toContain("nmbrs setup");
  });

  test("set up but not logged in: exit 3 with a hint to log in", async () => {
    rmSync(join(env.dir, "session.json"));
    const r = await runCli("whoami", "--json");
    expect(r.code).toBe(3);
    expect(r.json.error.hint).toContain("nmbrs login");
  });

  test("administrations list: saved adviser, paging, filters, flattened JSON:API", async () => {
    fake.on("GET", `/v1/advisers/${ADVISER}/administrations`, (c) => {
      expect(c.url.searchParams.get("administrationName")).toBe("klant");
      expect(c.url.searchParams.get("page[number]")).toBe("1");
      expect(c.url.searchParams.get("page[size]")).toBe("100");
      return json(200, { data: [admin(1), admin(2)] });
    });
    const r = await runCli("administrations", "list", "--name", "klant", "--json", "--fields", "administrationId,name");
    expect(r.code).toBe(0);
    expect(r.json.data).toEqual([
      { administrationId: `${ADMIN.slice(0, -1)}1`, name: "Klant 1" },
      { administrationId: `${ADMIN.slice(0, -1)}2`, name: "Klant 2" },
    ]);
    expect(r.json.meta).toMatchObject({ count: 2, page: 1, next_page: null });
  });

  test("--adviser-id overrides the saved adviser; --raw keeps JSON:API", async () => {
    fake.on("GET", "/v1/advisers/other/webhooks", { data: [{ type: "webhooks", attributes: { webhookId: HOOK } }] });
    const r = await runCli("webhooks", "list", "--adviser-id", "other", "--raw", "--json");
    expect(r.json.data).toEqual([{ type: "webhooks", attributes: { webhookId: HOOK } }]);
  });

  test("dossiers list sends JSON:API filters and sort, with limit/offset paging", async () => {
    fake.on("GET", `/v1/advisers/${ADVISER}/administrations/${ADMIN}/dossiers`, (c) => {
      expect(c.url.searchParams.getAll("filter")).toEqual(["[year]=eq:2025", "[dossierType]=in:CMP,ADT"]);
      expect(c.url.searchParams.get("sort")).toBe("-lastUpdatedDate");
      expect(c.url.searchParams.get("page[limit]")).toBe("10");
      expect(c.url.searchParams.get("page[offset]")).toBe("10");
      return json(200, { data: [{ type: "dossiers", attributes: { name: "Jaarrekening 2025", year: 2025 } }] });
    });
    const r = await runCli(
      "dossiers", "list", ADMIN,
      "--filter", "year=eq:2025", "--filter", "[dossierType]=in:CMP,ADT",
      "--sort", "-lastUpdatedDate", "--page", "2", "--page-size", "10", "--json",
    );
    expect(r.code).toBe(0);
    expect(r.json.data[0].name).toBe("Jaarrekening 2025");
  });

  test("a filter without an operation is refused before calling the API", async () => {
    const r = await runCli("dossiers", "list", ADMIN, "--filter", "year=2025", "--json");
    expect(r.code).toBe(1);
    expect(r.json.error.message).toContain("no operation");
    expect(fake.apiCalls()).toHaveLength(0);
  });

  test("webhooks create makes a plan (secret hidden), apply sends it once", async () => {
    let sent: unknown;
    fake.on("POST", `/v1/advisers/${ADVISER}/webhooks`, (c) => {
      sent = c.body;
      return json(200, { data: { type: "string", attributes: HOOK } });
    });
    const plan = await runCli(
      "webhooks", "create", "--type", "3085ef58-f84d-4808-a2f8-cf2e20afd7f4", "--name", "Signing",
      "--url", "https://sign.example.com/hook", "--secret", "s3cret", "--json",
    );
    expect(plan.code).toBe(2);
    expect(plan.json.data.planMade).toBe(true);
    expect(plan.json.data.wouldSend.body.callbackSecret).toBe("****");
    expect(plan.json.data.dangerous.join(" ")).toContain("callback URL");
    expect(fake.apiCalls()).toHaveLength(0);

    const applied = await runCli("apply", plan.json.data.planId, "--json");
    expect(applied.code).toBe(0);
    expect(applied.json.data).toBe(HOOK);
    expect(sent).toEqual({
      webhookTypeId: "3085ef58-f84d-4808-a2f8-cf2e20afd7f4",
      webhookName: "Signing",
      callbackUrl: "https://sign.example.com/hook",
      callbackSecret: "s3cret",
    });
    const again = await runCli("apply", plan.json.data.planId, "--json");
    expect(again.code).toBe(6);
  });

  test("required body fields are checked before a plan is made", async () => {
    const r = await runCli("webhooks", "create", "--name", "x", "--json");
    expect(r.code).toBe(1);
    expect(r.json.error.message).toContain("webhookTypeId");
  });

  test("webhooks delete reads the webhook first and warns", async () => {
    fake.on("GET", `/v1/advisers/${ADVISER}/webhooks/${HOOK}`, {
      data: { type: "webhooks", attributes: { webhookId: HOOK, webhookName: "Signing", callbackUrl: "https://sign.example.com/hook" } },
    });
    const r = await runCli("webhooks", "delete", HOOK, "--json");
    expect(r.code).toBe(2);
    expect(r.json.data.target).toMatchObject({ webhookName: "Signing" });
    expect(r.json.data.summary).toContain("Signing");
    expect(r.json.data.dangerous.join(" ")).toContain("can't be undone");
  });

  test("deleting a webhook that doesn't exist fails with exit 6 and no plan", async () => {
    const r = await runCli("webhooks", "delete", HOOK, "--json");
    expect(r.code).toBe(6);
  });

  test("update-client-card finds the administration in the list as its target", async () => {
    fake.on("GET", `/v1/advisers/${ADVISER}/administrations`, (c) => {
      expect(c.url.searchParams.get("globalAdministrationId")).toBe(ADMIN);
      return json(200, { data: [admin(1)] });
    });
    const r = await runCli("administrations", "update-client-card", ADMIN, "--website", "https://klant.nl", "--set", "address.city=Utrecht", "--json");
    expect(r.code).toBe(2);
    expect(r.json.data.target.name).toBe("Klant 1");
    expect(r.json.data.wouldSend).toMatchObject({ method: "PATCH", body: { website: "https://klant.nl", address: { city: "Utrecht" } } });
  });

  test("enum values from the docs are checked (warning, not an error)", async () => {
    const r = await runCli("administrations", "create", "--name", "Nieuw BV", "--period-type", "weekly", "--json");
    expect(r.code).toBe(2);
    expect(r.json.data.warnings.join(" ")).toContain("periodType: weekly (one of month, 4weeks)");
  });

  test("api fills {globalAdviserId} and pages known list endpoints", async () => {
    fake.on("GET", `/v1/advisers/${ADVISER}/administrations`, (c) => {
      expect(c.url.searchParams.get("page[size]")).toBe("100");
      return json(200, { data: [admin(1)] });
    });
    const r = await runCli("api", "GET", "/v1/advisers/{globalAdviserId}/administrations", "--json");
    expect(r.code).toBe(0);
    expect(r.json.data[0].name).toBe("Klant 1");
  });

  test("api writes make a plan too", async () => {
    const r = await runCli("api", "DELETE", `/v1/advisers/{globalAdviserId}/webhooks/${HOOK}`, "--json");
    // The target read 404s on the fake, so no plan is made for something that isn't there.
    expect(r.code).toBe(6);
    const p = await runCli("api", "POST", "/v1/unknown", "-d", '{"a":1}', "--json");
    expect(p.code).toBe(2);
    expect(p.json.data.warnings[0]).toContain("not in the Nmbrs Reporting docs catalog");
  });

  test("whoami flattens /v1/me", async () => {
    fake.on("GET", "/v1/me", { data: { type: "me", attributes: { email: "anna@kantoor.nl", globalAdviserId: ADVISER } } });
    const r = await runCli("whoami", "--json");
    expect(r.json.data).toEqual({ email: "anna@kantoor.nl", globalAdviserId: ADVISER });
  });

  test("signing documents --save-dir writes the files and leaves base64 out", async () => {
    const pdf = Buffer.from("%PDF-1.7 fake").toString("base64");
    fake.on("GET", "/v1/document-signing/documents", (c) => {
      expect(c.url.searchParams.get("requestId")).toBe("req-1");
      return json(200, {
        data: {
          type: "documents",
          attributes: {
            documents: [{ name: "Jaarrekening 2025", type: "pdf", content: pdf, xbrl: pdf, signers: [{ name: "Jan", email: "jan@klant.nl" }] }],
            attachments: [{ name: "bijlage.pdf", content: pdf }],
          },
        },
      });
    });
    const dir = join(env.dir, "docs");
    const r = await runCli("signing", "documents", "--request-id", "req-1", "--save-dir", dir, "--json");
    expect(r.code).toBe(0);
    expect(r.json.meta.saved).toHaveLength(3);
    expect(readFileSync(join(dir, "Jaarrekening 2025.pdf"), "utf8")).toBe("%PDF-1.7 fake");
    expect(existsSync(join(dir, "Jaarrekening 2025.xbrl"))).toBe(true);
    expect(r.json.data.documents[0].content).toStartWith("saved: ");
    expect(r.json.data.documents[0].signers[0].name).toBe("Jan");
  });

  test("signing documents needs --request-id", async () => {
    const r = await runCli("signing", "documents", "--json");
    expect(r.code).toBe(1);
    expect(r.json.error.message).toContain("--request-id");
  });

  test("endpoints and describe work offline", async () => {
    const list = await runCli("endpoints", "webhook", "--json");
    expect(list.json.data.map((e: { id: string }) => e.id)).toContain("register-a-webhook");
    expect(list.json.data.find((e: { id: string }) => e.id === "register-a-webhook").command).toBe("nmbrs webhooks create");
    const d = await runCli("describe", "list-of-dossiers");
    expect(d.stdout).toContain("page[limit]");
    expect(d.stdout).toContain("dossierType");
  });

  test("auth status shows the login without calling the API", async () => {
    const r = await runCli("auth", "status", "--json");
    expect(r.code).toBe(0);
    expect(r.json.data.login.loggedIn).toBe(true);
    expect(r.json.data.adviserId).toBe(ADVISER);
    expect(fake.calls).toHaveLength(0);
  });

  test("logout revokes and deletes the session", async () => {
    const r = await runCli("logout", "--json");
    expect(r.json.data).toEqual({ loggedOut: true, revoked: true });
    expect(existsSync(join(env.dir, "session.json"))).toBe(false);
  });
});
