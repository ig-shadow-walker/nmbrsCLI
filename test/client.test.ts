import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getSession, readSession } from "../src/auth.ts";
import { NmbrsClient } from "../src/http.ts";
import { FakeNmbrs, json, loggedIn, testEnv } from "./helpers.ts";

describe("login session and HTTP client", () => {
  let env: ReturnType<typeof testEnv>;
  let fake: FakeNmbrs;
  beforeEach(() => {
    env = testEnv();
    fake = new FakeNmbrs().on("GET", "/v1/me", { data: { type: "me", attributes: { email: "a@b.nl" } } }).install();
  });
  afterEach(() => {
    fake.restore();
    env.cleanup();
  });

  test("uses a fresh access token without refreshing", async () => {
    const config = loggedIn(fake);
    const s = await getSession(config);
    expect(s.accessToken).toBe("access-1");
    expect(fake.refreshes).toBe(0);
  });

  test("an expired access token is refreshed and the new refresh token is saved", async () => {
    const config = loggedIn(fake, { expired: true });
    const s = await getSession(config);
    expect(fake.refreshes).toBe(1);
    expect(s.accessToken).toBe("access-2");
    expect(readSession(config)!.refreshToken).toBe("refresh-2");
  });

  test("parallel commands refresh only once (refresh tokens are single use)", async () => {
    const config = loggedIn(fake, { expired: true });
    const results = await Promise.all([getSession(config), getSession(config), getSession(config)]);
    expect(fake.refreshes).toBe(1);
    expect(new Set(results.map((r) => r.accessToken))).toEqual(new Set(["access-2"]));
  });

  test("a used or expired refresh token says to log in again (exit 3)", async () => {
    const config = loggedIn(fake, { expired: true });
    fake.refreshToken = "something-else";
    const e = await getSession(config).catch((x) => x);
    expect(e.exitCode).toBe(3);
    expect(e.extra.key).toBe("token.invalid_grant");
    expect(e.extra.hint).toContain("nmbrs login");
  });

  test("not logged in at all is exit 3", async () => {
    const config = loggedIn(fake);
    const { rmSync } = await import("node:fs");
    rmSync(`${env.dir}/session.json`);
    const e = await getSession(config).catch((x) => x);
    expect(e.exitCode).toBe(3);
    expect(e.extra.key).toBe("session.missing");
  });

  test("a rejected access token is refreshed once and the request retried", async () => {
    const config = loggedIn(fake);
    // The API stops accepting access-1 (e.g. revoked); the fake only accepts the newest token.
    fake.issued = 1;
    let first = true;
    fake.on("GET", "/v1/dossiers-test", () => {
      if (first) {
        first = false;
        return new Response(null, { status: 401 });
      }
      return json(200, { data: [] });
    });
    const res = await new NmbrsClient(config, { sleep: async () => {} }).request({ method: "GET", path: "/v1/dossiers-test" });
    expect(res.status).toBe(200);
    expect(fake.refreshes).toBe(1);
  });

  test("number paging follows links.next", async () => {
    const config = loggedIn(fake);
    fake.on("GET", "/v1/list", (c) => {
      const page = Number(c.url.searchParams.get("page[number]"));
      expect(c.url.searchParams.get("page[size]")).toBe("2");
      return json(200, { data: [{ type: "x", attributes: { n: page * 2 - 1 } }, { type: "x", attributes: { n: page * 2 } }], links: page < 3 ? { next: "…" } : {} });
    });
    const r = await new NmbrsClient(config).paginate({ method: "GET", path: "/v1/list" }, "number", { size: 2, all: true });
    expect(r.items).toHaveLength(6);
    expect(r.pagesFetched).toBe(3);
    expect(r.nextPage).toBeNull();
  });

  test("offset paging without links stops at a short page", async () => {
    const config = loggedIn(fake);
    const offsets: string[] = [];
    fake.on("GET", "/v1/list", (c) => {
      offsets.push(c.url.searchParams.get("page[offset]")!);
      expect(c.url.searchParams.get("page[limit]")).toBe("2");
      const off = Number(c.url.searchParams.get("page[offset]"));
      return json(200, { data: off < 4 ? [{}, {}] : [{}] });
    });
    const r = await new NmbrsClient(config).paginate({ method: "GET", path: "/v1/list" }, "offset", { size: 2, all: true });
    expect(offsets).toEqual(["0", "2", "4"]);
    expect(r.items).toHaveLength(5);
  });

  test("refuses to send the token anywhere but the API", async () => {
    const config = loggedIn(fake);
    const e = await new NmbrsClient(config).request({ method: "GET", path: "https://evil.example/v1/me" }).catch((x) => x);
    expect(e.message).toContain("Refusing");
  });

  test("retries a throttled GET, then maps errors to exit codes", async () => {
    const config = loggedIn(fake);
    let n = 0;
    fake.on("GET", "/v1/busy", () => (++n < 2 ? json(429, {}, { "retry-after": "1" }) : json(200, { data: { type: "x", attributes: {} } })));
    fake.on("GET", "/v1/gone", () => json(404, { errors: [{ status: "404", title: "Not Found", detail: "No such dossier" }] }));
    fake.on("GET", "/v1/forbidden", () => json(403, { title: "Forbidden" }));
    const client = new NmbrsClient(config, { sleep: async () => {} });
    expect((await client.request({ method: "GET", path: "/v1/busy" })).status).toBe(200);
    const gone = await client.request({ method: "GET", path: "/v1/gone" }).catch((x) => x);
    expect(gone.exitCode).toBe(6);
    expect(gone.message).toBe("Not Found: No such dossier");
    expect((await client.request({ method: "GET", path: "/v1/forbidden" }).catch((x) => x)).exitCode).toBe(4);
  });
});
