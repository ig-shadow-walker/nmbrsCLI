---
name: nmbrs
description: Use for anything in Nmbrs Reporting (formerly Visionplanner), the financial reporting platform for accountancy firms - the adviser's administrations (clients, klanten) and their client cards (legal form, KvK/CoC number, SBI, address, risk profile), rubric and period mappings of an administration's ledger accounts, dossiers (samenstel/compilation, audit/controle, tax/fiscaal; year, status, due date), administrations with changed mappings, webhooks, and the digital signing flow (documents to be signed, handing back signed documents, signing status). Runs the `nmbrs` command-line tool against the Nmbrs Reporting public API.
---

# nmbrs - Nmbrs Reporting

`nmbrs` talks to the Nmbrs Reporting public API as the user who logged in during `nmbrs setup`, for one
adviser (accountancy firm). Every command and its options: [reference.md](reference.md), or
`nmbrs <group> <command> --help` (the help lists every body field, with `*` for required ones).

## Calling it

- Add `--json`. Output is `{"ok":true,"data":…,"meta":…}` or `{"ok":false,"error":{"message","key","hint","exitCode"}}`.
- Results are flattened from JSON:API: each item is the resource's attributes (`administrationId`, `name`, …).
  `--raw` keeps the `{type, attributes}` shape.
- Keep answers small with `--fields a,b.c` and `--limit n`. Paged lists return 100 per page; `meta.next_page`
  says if there is more. `--all` fetches every page (combine with `--limit`), `--page-size n` changes the size.
- Commands under an adviser (administrations, dossiers, webhooks) use the adviser saved by setup. Only pass
  `--adviser-id` when the user names another adviser.
- Ids are GUIDs. Find them with a read first (`administrations list --name …`). Never guess or invent an id.
- Dates/times are ISO 8601 with an offset, e.g. `2026-11-01T00:00:00+00:00`.
- Top-level body fields are flags in kebab-case (`--administration-name`, `--coc-number`, `--is-private false`).
  For nested data pass JSON with `--data '{…}'` or `--data-file body.json`; `--set address.city=Utrecht`
  tweaks one field. On Windows PowerShell, use `--data-file` (PowerShell 5.1 strips quotes inside `--data`).

## Filtering and sorting (dossiers)

`--filter field=operation:value`, repeatable. Operations: `eq ne gt ge lt le like startswith endswith in`.
`in` takes comma-separated values (`dossierType=in:CMP,ADT`); escape a comma inside a value as `\,`; `null`
matches empty. Several fields with `|` search them all: `--filter "name|administrationName=like:bakker"`.
Sort with `--sort -lastUpdatedDate,name` (`-` = descending).

Dossier types: `CMP` compilation (samenstel), `ADT` audit (controle), `TXI` income tax, `TXC` corporate tax,
`CMP_FE` compilation (foreign entity).

## Reads run; changes come back as a plan

Reads run straight away. Any command that changes something sends nothing: it exits with code 2 and
returns `planMade: true`, a `summary`, `dangerous` reasons, the `target` it changes (read from the API),
what it `wouldSend`, and `toApply` (`nmbrs apply <plan-id>`).

1. Tell the user the summary in plain words, the `dangerous` reasons and any `warnings`, and ask.
2. Only after a clear yes **in this conversation**, run `toApply` exactly as given, as its own command.
   One apply per yes; never apply a plan the user hasn't seen. Claude Code will also ask them.
3. Plans expire after 15 minutes and can be applied once. If one expired, run the command again.

Never put `apply` anywhere but first (`nmbrs apply <plan>`), and never chain it with other commands.
Take extra care when `dangerous` is not empty:
- **Creating an administration** can't be undone through the API, and subscription fields may change billing.
- **Updating a client card** overwrites legal details; read the current values first (`administrations list --id <id>`).
- **Webhooks** make Nmbrs Reporting POST to a URL with a secret. Put the secret in a `--data-file`, not on the
  command line (it would land in shell history). Leave `globalClientId` empty.
- **Signing** (`signing send-signed`, `signing status`) changes a client's dossier; only for a real signing request.

## When something goes wrong

| Exit | Meaning | What to do |
|---|---|---|
| 1 | Bad input or the API said no (400/422) | Read `error.details`; fix the fields. `--help` lists them |
| 2 | Plan made, nothing sent | Ask the user, then `nmbrs apply <id>` |
| 3 | Not set up, not logged in, or login expired | Ask the user to run `nmbrs setup` (first time) or `nmbrs login` in their own terminal; it opens a browser. Don't run it for them, and never ask for the Client Secret in chat |
| 4 | Not authorized | Tell the user (`error.hint`); an adviser admin grants it in Nmbrs Reporting. Don't work around it |
| 5 | API down, throttled or timed out | For a change: it may or may not have happened. Don't repeat it; check with a read first |
| 6 | Not found | Re-check the id with a list |

`nmbrs auth test` checks the whole setup (refresh + `/v1/me`). `nmbrs auth status` shows the environment,
adviser and when the login expires, without calling the API. A login lasts 180 days and every command renews it.

## Which command for what

| The user wants to… | Use |
|---|---|
| Check the connection / who is logged in | `auth test`, `whoami` |
| All clients of the firm | `administrations list --all --fields administrationId,name,clientIdentifier,cocNumber` |
| Find a client | `administrations list --name <text>` (or `--coc-number`, `--client-identifier`, `--id`) |
| A client's details (legal form, address, SBI…) | `administrations list --id <administration-id>` |
| Change a client's details | `administrations update-client-card <administration-id> --…` |
| Add a client | `administrations create --name "…" …` |
| How a client's ledger maps to rubrics/periods | `administrations mapping <administration-id>` |
| Which clients had mapping changes | `administrations modified --since <date-time>` |
| A client's dossiers (year reports, audits, tax) | `dossiers list <administration-id> --all` (filter/sort as above) |
| Webhooks | `webhooks list/show/create/update/delete` |
| Documents waiting for a signature | `signing documents --request-id <id> --save-dir <dir>` |
| Anything else in the API | `nmbrs endpoints <words>` → `nmbrs describe <endpoint-id>` → `nmbrs api <METHOD> <path>` |

## Recipes

Open dossiers of one client this year:

```bash
nmbrs administrations list --name "de vries" --json --fields administrationId,name
nmbrs dossiers list <administration-id> --filter year=eq:2026 --sort -lastUpdatedDate --json \
  --fields name,dossierType,status,dueDate,lastUpdatedDate
```

Dossiers across all clients (loop over administrations; there is no adviser-wide dossier list):

```bash
nmbrs administrations list --all --json --fields administrationId,name
# then per administration: nmbrs dossiers list <id> --filter year=eq:2025 --json
```

Register the digital-signing webhook (type `3085ef58-f84d-4808-a2f8-cf2e20afd7f4`, the only type so far):

```bash
cat > webhook.json <<'EOF'
{"webhookTypeId":"3085ef58-f84d-4808-a2f8-cf2e20afd7f4","webhookName":"Signing portal",
 "callbackUrl":"https://sign.example.com/nmbrs","callbackSecret":"<secret from the user>"}
EOF
nmbrs webhooks create --data-file webhook.json --json
# exit 2 -> show the summary, ask, then: nmbrs apply <plan-id>
```

Signing flow: the webhook callback carries a `RequestId`. `signing documents --request-id <id> --save-dir ./sign`
saves the PDFs/XBRL and lists the signers. When signed, `signing send-signed --request-id <id> --data-file signed.json`
with `{"documents":[{"name","type","cocNumber","financialYear","content":"<base64>","signers":[…]}]}`
(see `nmbrs signing send-signed --help`), and `signing status` for progress updates.

## Notes

- The endpoint catalog comes from the published OpenAPI spec; `nmbrs endpoints` lists every endpoint with the
  friendly command for it. If the API rejects a field the docs call optional (or the other way round),
  `--no-validate` skips the local required-field check; the API still validates.
- `nmbrs plans list` shows plans waiting to be applied; `nmbrs plans discard <id>` drops one.
