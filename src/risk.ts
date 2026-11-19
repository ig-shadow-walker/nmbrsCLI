import type { Endpoint } from "./catalog-types.ts";

/** Endpoints whose effect reaches outside this CLI or is hard to undo. */
const RISKY: Record<string, string> = {
  "create-an-administration":
    "Creates a new administration (client) for the adviser. The API has no delete for it; remove it in Nmbrs Reporting if needed.",
  "update-client-card": "Overwrites the client card (legal and contact details) of this administration.",
  "signed-documents":
    "Hands the signed documents back to Nmbrs Reporting for this signing request; this completes the signing step of the dossier.",
  "signing-status": "Posts a signing status update to the dossier's signing request.",
  "register-a-webhook": "Nmbrs Reporting will POST events (with the callback secret) to this callback URL from now on.",
  "update-webhook-details": "Changes where (and with which secret) Nmbrs Reporting delivers this webhook's events.",
  "delete-a-webhook-registration": "Nmbrs Reporting stops delivering events to this webhook's callback URL.",
};

export function riskReasons(endpoint: Endpoint | undefined, method: string, body: unknown): string[] {
  const reasons: string[] = [];
  if (endpoint && RISKY[endpoint.id]) reasons.push(RISKY[endpoint.id]!);
  if (method.toUpperCase() === "DELETE") reasons.push("Deletes this in Nmbrs Reporting. This can't be undone.");
  const b = (body ?? {}) as Record<string, unknown>;
  if (endpoint?.id === "register-a-webhook" && b.globalClientId) {
    reasons.push("globalClientId is set; the docs say to leave it empty, or the API answers BadRequest.");
  }
  for (const k of ["compilationSubscription", "insightsSubscription"]) {
    const v = b[k];
    if (typeof v === "string" && v && !/None$/.test(v)) reasons.push(`Sets ${k}=${v}, which may affect what the adviser is billed.`);
  }
  return [...new Set(reasons)];
}
