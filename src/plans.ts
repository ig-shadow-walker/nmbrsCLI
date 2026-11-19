import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./config.ts";
import { Exit, NmbrsError } from "./errors.ts";
import type { QueryValue } from "./http.ts";

/** How long a plan can be applied after it was made. */
export const PLAN_TTL_MS = 15 * 60 * 1000;

export interface Plan {
  id: string;
  createdAt: string;
  expiresAt: string;
  /** The nmbrs command that made the plan, for the record. */
  command: string;
  endpointId?: string;
  method: string;
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** One line, plain words. */
  summary: string;
  /** Why this is risky (emails a customer, deletes data, ...). Empty when it isn't. */
  dangerous: string[];
  /** What the change applies to, read from Nmbrs Reporting when the plan was made. */
  target?: Record<string, unknown>;
  warnings: string[];
}

export function plansDir(env: Record<string, string | undefined> = process.env): string {
  return join(configDir(env), "plans");
}

function planFile(id: string): string {
  if (!/^[a-z0-9]{6,32}$/.test(id)) throw new NmbrsError(`"${id}" is not a plan id.`);
  return join(plansDir(), `${id}.json`);
}

export function newPlanId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

export function savePlan(p: Omit<Plan, "id" | "createdAt" | "expiresAt">): Plan {
  pruneExpired();
  const now = Date.now();
  const plan: Plan = {
    id: newPlanId(),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PLAN_TTL_MS).toISOString(),
    ...p,
  };
  mkdirSync(plansDir(), { recursive: true, mode: 0o700 });
  writeFileSync(planFile(plan.id), JSON.stringify(plan, null, 2), { mode: 0o600 });
  return plan;
}

export function loadPlan(id: string): Plan {
  const file = planFile(id);
  if (!existsSync(file)) {
    throw new NmbrsError(`Plan ${id} does not exist (already applied, discarded or expired).`, Exit.NOT_FOUND, {
      key: "plan.not_found",
      hint: "Run the original command again to make a new plan.",
    });
  }
  const plan = JSON.parse(readFileSync(file, "utf8")) as Plan;
  if (Date.parse(plan.expiresAt) < Date.now()) {
    rmSync(file, { force: true });
    throw new NmbrsError(`Plan ${id} expired at ${plan.expiresAt}.`, Exit.ERROR, {
      key: "plan.expired",
      hint: "Run the original command again to make a new plan.",
    });
  }
  return plan;
}

/** Removes a plan so it can never be applied twice. Returns false if it was already gone. */
export function consumePlan(id: string): boolean {
  const file = planFile(id);
  if (!existsSync(file)) return false;
  rmSync(file, { force: true });
  return true;
}

export function listPlans(): Plan[] {
  pruneExpired();
  const dir = plansDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Plan)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function pruneExpired() {
  const dir = plansDir();
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const p = JSON.parse(readFileSync(join(dir, f), "utf8")) as Plan;
      if (Date.parse(p.expiresAt) < Date.now()) rmSync(join(dir, f), { force: true });
    } catch {
      rmSync(join(dir, f), { force: true });
    }
  }
}
