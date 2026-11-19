/** Exit codes. Agents branch on these, so never renumber them. */
export const Exit = {
  OK: 0,
  /** Usage, validation (400/422) or other error. */
  ERROR: 1,
  /** A write was turned into a plan; nothing was sent. */
  PLAN: 2,
  /** Not set up, not logged in, login expired, or Nmbrs Reporting rejected the credentials. */
  AUTH: 3,
  /** The logged-in user lacks the authorization for this action. */
  FORBIDDEN: 4,
  /** Nmbrs Reporting unavailable, throttled after retries, timed out or network failure. A write may or may not have happened. */
  UNAVAILABLE: 5,
  /** The resource does not exist. */
  NOT_FOUND: 6,
} as const;

export type ExitCode = (typeof Exit)[keyof typeof Exit];

export interface ErrorDetail {
  param?: string;
  key?: string;
  message?: string;
}

export class NmbrsError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode = Exit.ERROR,
    readonly extra: {
      status?: number;
      key?: string;
      details?: ErrorDetail[];
      hint?: string;
    } = {},
  ) {
    super(message);
    this.name = "NmbrsError";
  }

  toJSON() {
    return {
      message: this.message,
      ...(this.extra.status !== undefined ? { status: this.extra.status } : {}),
      ...(this.extra.key ? { key: this.extra.key } : {}),
      ...(this.extra.details?.length ? { details: this.extra.details } : {}),
      ...(this.extra.hint ? { hint: this.extra.hint } : {}),
      exitCode: this.exitCode,
    };
  }
}

const LOGIN_HINT = "Run `nmbrs login` in a terminal to log in to Nmbrs Reporting again.";

/**
 * Reads the error out of a response body. The API answers with JSON:API errors
 * ({errors: [{status, code, title, detail, source}]}), ASP.NET problem details
 * ({title, detail, errors: {field: [messages]}}) or nothing at all.
 */
function parseErrorBody(body: unknown): { message?: string; key?: string; details: ErrorDetail[] } {
  const b = (body ?? {}) as Record<string, unknown>;
  const details: ErrorDetail[] = [];
  if (Array.isArray(b.errors)) {
    for (const e of b.errors as Record<string, unknown>[]) {
      const source = (e.source ?? {}) as Record<string, unknown>;
      details.push({
        param: (source.parameter ?? source.pointer) as string | undefined,
        key: (e.code as string | undefined) ?? undefined,
        message: [e.title, e.detail].filter((x) => typeof x === "string" && x).join(": ") || undefined,
      });
    }
    const first = details[0];
    return { message: first?.message, key: first?.key, details };
  }
  if (b.errors && typeof b.errors === "object") {
    for (const [param, msgs] of Object.entries(b.errors as Record<string, unknown>)) {
      for (const m of Array.isArray(msgs) ? msgs : [msgs]) details.push({ param, message: String(m) });
    }
  }
  const message = [b.title, b.detail].filter((x) => typeof x === "string" && x).join(": ") || (b.message as string | undefined) || (b.raw as string | undefined);
  return { message, key: (b.code ?? b.type) as string | undefined, details };
}

/** Maps an API error response to an NmbrsError with the right exit code. */
export function fromApiError(status: number, body: unknown): NmbrsError {
  const parsed = parseErrorBody(body);
  const message = parsed.message || `Nmbrs Reporting returned HTTP ${status}`;
  const extra = { status, key: parsed.key, details: parsed.details };

  if (status === 401) return new NmbrsError(message, Exit.AUTH, { ...extra, key: extra.key ?? "auth.rejected", hint: LOGIN_HINT });
  if (status === 403) {
    return new NmbrsError(message, Exit.FORBIDDEN, {
      ...extra,
      hint: "The logged-in user (or the API connection) is not authorized for this. An adviser admin can change it in Nmbrs Reporting.",
    });
  }
  if (status === 404) return new NmbrsError(message, Exit.NOT_FOUND, extra);
  if (status === 429 || status >= 500) return new NmbrsError(message, Exit.UNAVAILABLE, extra);
  return new NmbrsError(message, Exit.ERROR, extra);
}

export { LOGIN_HINT };
