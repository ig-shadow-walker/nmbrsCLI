import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { toFlag, toOptKey } from "../src/body.ts";
import { catalog } from "../src/catalog.ts";
import { buildProgram } from "../src/cli.ts";
import { normalizeFilter, pagingStyle } from "../src/commands/resources.ts";
import { normalizeScopes, parseCredentials } from "../src/config.ts";
import { fromApiError } from "../src/errors.ts";
import { buildUrl } from "../src/http.ts";
import { createPkce, isLoopback, parseCallback } from "../src/login.ts";
import { buildReference } from "../src/reference.ts";
import { riskReasons } from "../src/risk.ts";
import { forDisplay, unwrap } from "../src/runtime.ts";
import { getEndpoint } from "../src/catalog.ts";

describe("names and parsing", () => {
  test("field names become kebab-case flags and back", () => {
    expect(toFlag("administrationName")).toBe("administration-name");
    expect(toFlag("globalAdministrationId")).toBe("global-administration-id");
    expect(toFlag("page[size]")).toBe("page-size");
    expect(toFlag("signature_marker")).toBe("signature-marker");
    expect(toOptKey("administration-name")).toBe("administrationName");
  });

  test("filters: friendly and native forms", () => {
    expect(normalizeFilter("year=eq:2025")).toBe("[year]=eq:2025");
    expect(normalizeFilter("name|administrationName=like:bakker")).toBe("[name|administrationName]=like:bakker");
    expect(normalizeFilter("[status]=in:a,b")).toBe("[status]=in:a,b");
    expect(() => normalizeFilter("year")).toThrow();
  });

  test("buildUrl repeats array keys and keeps the API base path", () => {
    const u = new URL(buildUrl("https://x.test/public-api", "/v1/a", { filter: ["[a]=eq:1", "[b]=eq:2"], "page[size]": 5, skip: undefined }));
    expect(u.pathname).toBe("/public-api/v1/a");
    expect(u.searchParams.getAll("filter")).toEqual(["[a]=eq:1", "[b]=eq:2"]);
    expect(u.searchParams.get("page[size]")).toBe("5");
    expect(u.searchParams.has("skip")).toBe(false);
  });

  test("scopes always include offline_access", () => {
    expect(normalizeScopes(undefined)).toBe("public_api offline_access");
    expect(normalizeScopes("public_api, openid")).toBe("public_api openid offline_access");
  });

  test("credentials file parsing", () => {
    expect(parseCredentials('# c\nNMBRS_A=1\nexport NMBRS_B="x \\"y\\" \\\\z"\nNMBRS_C=v # note\n')).toEqual({
      NMBRS_A: "1",
      NMBRS_B: 'x "y" \\z',
      NMBRS_C: "v",
    });
  });
});

describe("login", () => {
  test("PKCE: 64-character verifier, S256 challenge", () => {
    const { verifier, challenge } = createPkce();
    expect(verifier).toHaveLength(64);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toBe(Buffer.from(new Bun.CryptoHasher("sha256").update(verifier).digest()).toString("base64url"));
  });

  test("callback parsing checks state and reports errors", () => {
    expect(parseCallback("http://localhost:1/callback?code=abc&state=s1", "s1")).toBe("abc");
    expect(() => parseCallback("http://localhost:1/callback?code=abc&state=other", "s1")).toThrow("state mismatch");
    expect(() => parseCallback("http://localhost:1/callback?error=access_denied&state=s1", "s1")).toThrow("access_denied");
    expect(() => parseCallback("not a url", "s1")).toThrow();
  });

  test("loopback detection", () => {
    expect(isLoopback("http://localhost:47615/callback")).toBe(true);
    expect(isLoopback("http://127.0.0.1:1/cb")).toBe(true);
    expect(isLoopback("https://app.example.com/callback")).toBe(false);
  });
});

describe("responses and errors", () => {
  test("JSON:API data is flattened", () => {
    expect(unwrap({ data: [{ type: "a", attributes: { x: 1 } }] })).toEqual([{ x: 1 }]);
    expect(unwrap({ data: { type: "a", id: "7", attributes: { x: 1 } } })).toEqual({ id: "7", x: 1 });
    expect(unwrap({ data: [{ type: "guid", attributes: "g-1" }] })).toEqual(["g-1"]);
    expect(unwrap({ data: [{ type: "a", attributes: { x: 1 } }] }, true)).toEqual([{ type: "a", attributes: { x: 1 } }]);
  });

  test("errors map to exit codes, from JSON:API and problem details", () => {
    const a = fromApiError(422, { errors: [{ title: "Invalid", detail: "name is required", source: { parameter: "name" } }] });
    expect(a.exitCode).toBe(1);
    expect(a.extra.details).toEqual([{ param: "name", key: undefined, message: "Invalid: name is required" }]);
    const b = fromApiError(400, { title: "One or more validation errors occurred.", errors: { Name: ["The Name field is required."] } });
    expect(b.message).toBe("One or more validation errors occurred.");
    expect(b.extra.details).toEqual([{ param: "Name", message: "The Name field is required." }]);
    expect(fromApiError(401, null).exitCode).toBe(3);
    expect(fromApiError(403, null).exitCode).toBe(4);
    expect(fromApiError(503, null).exitCode).toBe(5);
  });

  test("secrets and base64 are hidden in plans", () => {
    expect(forDisplay({ callbackSecret: "s", content: "x".repeat(400), name: "n" })).toEqual({
      callbackSecret: "****",
      content: "<400 characters, e.g. base64 file contents>",
      name: "n",
    });
  });

  test("risk reasons", () => {
    expect(riskReasons(getEndpoint("delete-a-webhook-registration"), "DELETE", undefined)).toHaveLength(2);
    expect(riskReasons(getEndpoint("register-a-webhook"), "POST", { globalClientId: "x" }).join(" ")).toContain("leave it empty");
    expect(riskReasons(getEndpoint("create-an-administration"), "POST", { compilationSubscription: "CompilationPremium" }).join(" ")).toContain("billed");
    expect(riskReasons(getEndpoint("create-an-administration"), "POST", { compilationSubscription: "CompilationNone" })).toHaveLength(1);
  });
});

describe("catalog and skill", () => {
  test("catalog covers the documented endpoints, with paging styles", () => {
    expect(catalog.endpoints.length).toBeGreaterThanOrEqual(15);
    expect(pagingStyle(getEndpoint("list-of-administrations"))).toBe("number");
    expect(pagingStyle(getEndpoint("list-of-dossiers"))).toBe("offset");
    expect(pagingStyle(getEndpoint("list-of-webhooks"))).toBeUndefined();
  });

  test("every catalog endpoint has a friendly command or is reachable with `api`", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    for (const g of ["administrations", "dossiers", "webhooks", "signing", "api", "endpoints", "describe"]) expect(names).toContain(g);
  });

  test("skill/nmbrs/reference.md is up to date (run `bun run reference`)", () => {
    const committed = readFileSync(new URL("../skill/nmbrs/reference.md", import.meta.url), "utf8");
    expect(committed).toBe(buildReference(buildProgram()));
  });

  test("SKILL.md has a name and description", () => {
    const skill = readFileSync(new URL("../skill/nmbrs/SKILL.md", import.meta.url), "utf8");
    expect(skill).toStartWith("---\nname: nmbrs\ndescription: ");
  });
});
