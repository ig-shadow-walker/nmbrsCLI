import type { JsonObject } from "./body.ts";

/**
 * Friendly commands. Each maps to one endpoint in catalog/endpoints.json; options, required
 * fields and help text are generated from the catalog, so only naming lives here.
 *
 * The {globalAdviserId} path parameter is never a positional argument: commands use the adviser
 * that setup saved, or --adviser-id.
 */
export interface CommandSpec {
  /** Command name; a space makes a nested command. */
  name: string;
  endpoint: string;
  /** One-line description; defaults to the endpoint summary. */
  summary?: string;
  aliases?: string[];
  /** Display names for the path parameters other than globalAdviserId, in path order. */
  args?: string[];
  /** Extra option names: { name: "administrationName" }. */
  optionAliases?: Record<string, string>;
  /** Body defaults applied before user input. */
  defaults?: JsonObject;
  /** Adds --save-dir to write base64 documents in the answer to files. */
  saveDocuments?: boolean;
  examples?: string[];
}

export interface GroupSpec {
  name: string;
  summary: string;
  aliases?: string[];
  commands: CommandSpec[];
}

/** WebhookTypeId of the only webhook type the docs list so far. */
export const DIGITAL_SIGNING_WEBHOOK_TYPE = "3085ef58-f84d-4808-a2f8-cf2e20afd7f4";

export const groups: GroupSpec[] = [
  {
    name: "administrations",
    summary: "Administrations: the adviser's clients, their client cards and mappings",
    aliases: ["admins", "clients"],
    commands: [
      {
        name: "list",
        endpoint: "list-of-administrations",
        optionAliases: { name: "administrationName", id: "globalAdministrationId" },
        examples: [
          "nmbrs administrations list --all --json --fields administrationId,name,clientIdentifier,cocNumber",
          "nmbrs administrations list --name bakkerij --json",
          "nmbrs administrations list --coc-number 12345678 --json",
        ],
      },
      {
        name: "create",
        endpoint: "create-an-administration",
        examples: [`nmbrs administrations create --name "Bakkerij De Vries BV" --period-type month --start-fiscal-year january --is-private false`],
      },
      {
        name: "update-client-card",
        endpoint: "update-client-card",
        aliases: ["update"],
        args: ["administration-id"],
        summary: "Update the client card (legal and contact details) of an administration",
        examples: [
          `nmbrs administrations update-client-card <administration-id> --website https://devries.nl --phone-number 0201234567`,
          `nmbrs administrations update-client-card <administration-id> --data '{"address":{"street":"Dorpsstraat","houseNumber":1,"zipCode":"1234AB","city":"Amsterdam"}}'`,
        ],
      },
      {
        name: "mapping",
        endpoint: "list-of-rubric-and-period-mappings",
        args: ["administration-id"],
        summary: "Rubric and period mappings of an administration (ledger accounts to Nmbrs Reporting rubrics)",
      },
      {
        name: "modified",
        endpoint: "list-of-administrations-with-modified-mappings",
        optionAliases: { since: "modifiedAfter" },
        summary: "Ids of administrations whose mappings changed after a moment",
        examples: ["nmbrs administrations modified --since 2026-11-01T00:00:00+00:00 --json"],
      },
    ],
  },
  {
    name: "dossiers",
    summary: "Dossiers (compilation, audit, tax) of an administration",
    commands: [
      {
        name: "list",
        endpoint: "list-of-dossiers",
        args: ["administration-id"],
        examples: [
          "nmbrs dossiers list <administration-id> --all --json",
          "nmbrs dossiers list <administration-id> --filter year=eq:2025 --sort -lastUpdatedDate --json",
          "nmbrs dossiers list <administration-id> --filter dossierType=in:CMP,ADT --json",
        ],
      },
    ],
  },
  {
    name: "webhooks",
    summary: "Webhook registrations: where Nmbrs Reporting sends event notifications",
    commands: [
      { name: "list", endpoint: "list-of-webhooks" },
      { name: "show", endpoint: "details-of-a-webhook", args: ["webhook-id"] },
      {
        name: "create",
        endpoint: "register-a-webhook",
        aliases: ["register"],
        optionAliases: { type: "webhookTypeId", name: "webhookName", url: "callbackUrl", secret: "callbackSecret" },
        examples: [
          `nmbrs webhooks create --type ${DIGITAL_SIGNING_WEBHOOK_TYPE} --name "Signing portal" --url https://sign.example.com/nmbrs --secret "<random secret>"`,
        ],
      },
      {
        name: "update",
        endpoint: "update-webhook-details",
        args: ["webhook-id"],
        optionAliases: { name: "webhookName", url: "callbackUrl", secret: "callbackSecret" },
        summary: "Change a webhook's name, callback URL and secret (all three are required)",
      },
      { name: "delete", endpoint: "delete-a-webhook-registration", args: ["webhook-id"] },
    ],
  },
  {
    name: "signing",
    summary: "Digital signing: fetch documents to sign, hand back signed ones, post status",
    commands: [
      {
        name: "documents",
        endpoint: "documents-to-be-signed",
        saveDocuments: true,
        summary: "Documents (and attachments and signers) of a signing request",
        examples: ["nmbrs signing documents --request-id <request-id> --save-dir ./to-sign --json"],
      },
      {
        name: "send-signed",
        endpoint: "signed-documents",
        summary: "Hand the signed documents of a signing request back to Nmbrs Reporting",
        examples: ["nmbrs signing send-signed --request-id <request-id> --data-file signed.json"],
      },
      {
        name: "status",
        endpoint: "signing-status",
        summary: "Post a status update for a signing request",
        examples: [`nmbrs signing status --request-id <request-id> --status "<status>" --content "<details>"`],
      },
    ],
  },
];
