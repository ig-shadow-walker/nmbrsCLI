# nmbrs command reference

Generated from the CLI itself (`bun run reference`, `nmbrs skill install`); don't edit by hand.
Endpoint catalog synced from the Nmbrs Reporting docs on 2026-11-19.

Global options (put them anywhere): `--json`, `--fields a,b.c`, `--limit n`, `--raw`, `-v/--verbose`.
Paged list commands also take `--page n`, `--page-size n` and `--all`. Commands under
`/v1/advisers/{globalAdviserId}` act for the adviser saved by setup unless `--adviser-id` is given.
Write commands also take `-d/--data <json>`, `--data-file <path|->`, `--set key.path=value`
(repeatable) and `--no-validate`, and make a plan (exit 2) that `nmbrs apply <plan-id>` sends.
`*` marks required body fields.

## Contents

- System: setup, skill, login, logout, apply, plans, auth, whoami
- administrations
- dossiers
- webhooks
- signing
- api, endpoints, describe

## setup

`nmbrs setup`  (alias: init)

Connect nmbrs to Nmbrs Reporting: asks for the Client ID and Secret, logs you in, installs the Claude skill

- `--client-id <id>` Client ID of the API connection (otherwise asked, or the saved one)
- `--client-secret-stdin` Read the Client Secret from stdin (e.g. from a password manager)
- `--sandbox` Use the sandbox environment (same as --environment sandbox)
- `--environment <name>` production (default) or sandbox
- `--redirect-uri <url>` Callback URL registered on the API connection (default http://localhost:47615/callback)
- `--skill` Install the Claude skill without asking
- `--no-skill` Don't install the Claude skill
- `--skill-dir <dir>` Install the skill here instead of ~/.claude/skills/nmbrs
- `--no-check` Don't check the Client ID and Secret with Nmbrs Reporting
- `--no-login` Save the credentials but don't log in yet (run `nmbrs login` later)
- `--manual` Log in by pasting the address the browser ends on, instead of a localhost listener
- `--no-browser` Print the login address instead of opening a browser
- `--no-interactive` Never ask; use flags, environment and the saved file

## skill

The Claude skill that teaches Claude Code to use nmbrs

### skill install

`nmbrs skill install`

Install or update the skill (SKILL.md and a reference generated from this nmbrs)

- `--dir <dir>` Install here instead of ~/.claude/skills/nmbrs
- `--force` Replace a development symlink with a copy

## login

`nmbrs login`

Log in to Nmbrs Reporting in the browser (again), e.g. after the 180-day login expired

- `--manual` Paste the address the browser ends on, instead of a localhost listener
- `--no-browser` Print the login address instead of opening a browser

## logout

`nmbrs logout`

Revoke the login at Nmbrs Reporting and delete it from this computer (credentials stay)

## apply

`nmbrs apply <plan-id>`

Send a change that a write command planned (one plan, one apply)

## plans

Pending plans (writes waiting for `nmbrs apply`)

### plans list

`nmbrs plans list`

Plans that can still be applied

### plans show

`nmbrs plans show <plan-id>`

Show what a plan would send

### plans discard

`nmbrs plans discard <plan-id>`

Throw a plan away without sending it

## auth

Credentials and login

### auth status

`nmbrs auth status`

Show which credentials, environment and login are used (no network)

### auth test

`nmbrs auth test`

Refresh the login and read /v1/me, to check everything works

### auth refresh

`nmbrs auth refresh`

Get a new access token now (this also renews the 180-day login)

## whoami

`nmbrs whoami`

The logged-in user and their adviser (GET /v1/me)

## administrations

Administrations: the adviser's clients, their client cards and mappings

### administrations list

`nmbrs administrations list`

List of Administrations

Calls `GET /v1/advisers/{globalAdviserId}/administrations`.

- `--global-administration-id <value>` globalAdministrationId
- `--administration-name <value>` administrationName
- `--client-identifier <value>` clientIdentifier
- `--coc-number <value>` cocNumber
- `--name <value>` Same as --administration-name
- `--id <value>` Same as --global-administration-id

### administrations create

`nmbrs administrations create`

Create an Administration

Calls `POST /v1/advisers/{globalAdviserId}/administrations` (makes a plan).

- `--compilation-subscription <CompilationNone|CompilationProfessional|CompilationPremium|CompilationUltimate>` compilationSubscription
- `--insights-subscription <InsightsNone|InsightsProfessional|InsightsPremium|InsightsUltimate>` insightsSubscription
- `--period-type <month|4weeks>` periodType
- `--template-name <value>` templateName
- `--start-fiscal-year <value>` In case of periodType == "month": - The name of the month like "january" or "february", etc.
- `--round-imported-financial-figures <true|false>` roundImportedFinancialFigures
- `--use-dimensions <true|false>` useDimensions
- `--is-private <true|false>` isPrivate
- `--name <value>` name (required)

Body fields:

```
compilationSubscription (string)  [CompilationNone|CompilationProfessional|CompilationPremium|CompilationUltimate]
insightsSubscription (string)  [InsightsNone|InsightsProfessional|InsightsPremium|InsightsUltimate]
periodType (string)  [month|4weeks]
templateName (string)
startFiscalYear (string)  In case of periodType == "month": - The name of the month like "january" or "february", e…
roundImportedFinancialFigures (boolean)
useDimensions (boolean)
isPrivate (boolean)
name* (string)
```

### administrations update-client-card

`nmbrs administrations update-client-card <administration-id>`  (alias: update)

Update the client card (legal and contact details) of an administration

Calls `PATCH /v1/advisers/{globalAdviserId}/administrations/{globalAdministrationId}/client-card` (makes a plan).

- `--administration-name <value>` administrationName
- `--legal-name <value>` legalName
- `--client-identifier <value>` clientIdentifier
- `--phone-number <value>` phoneNumber
- `--website <value>` website
- `--legal-form <value>` legalForm
- `--legal-entity-classification <micro|small|medium|large>` legalEntityClassification
- `--foundation-or-association-type <CommercialFoundationOrAssociation|SmallOrganizationWithoutProfitGoal|LargeOrganizationWithoutProfitGoal>` foundationOrAssociationType
- `--coc-number <value>` cocNumber
- `--legal-identification-number <value>` legalIdentificationNumber
- `--sbi <value>` sbi
- `--sector <other|healthcare>` sector
- `--registered-office <value>` registeredOffice
- `--risk-profile <NoImpact|LowImpact|NormalImpact|HighImpact|UnacceptableImpact>` riskProfile
- `--last-assessment-date-risk-profile <value>` lastAssessmentDateRiskProfile
- `--address <json>` address
- `--client-descriptions <json>` clientDescriptions

Body fields:

```
administrationName (string)
legalName (string)
clientIdentifier (string)
phoneNumber (string)
website (string)
legalForm (string)  [association|firm|lp|npo|pf|ltd|plc|sp]
legalEntityClassification (string)  [micro|small|medium|large]
foundationOrAssociationType (string)  [CommercialFoundationOrAssociation|SmallOrganizationWithoutProfitGoal|LargeOrganizationWithoutProfitGoal]
cocNumber (string)
legalIdentificationNumber (string)
sbi (string)
sector (string)  [other|healthcare]
registeredOffice (string)
riskProfile (string)  [NoImpact|LowImpact|NormalImpact|HighImpact|UnacceptableImpact]
lastAssessmentDateRiskProfile (string, date-time)
address (object)
  street (string)
  houseNumber (integer)
  houseNumberAddition (string)
  zipCode (string)
  city (string)
clientDescriptions (object)
  generalDescription (string)
  companyActivitiesDescription (string)
  internalControlDescription (string)
  administrativeIssuesDescription (string)
```

### administrations mapping

`nmbrs administrations mapping <administration-id>`

Rubric and period mappings of an administration (ledger accounts to Nmbrs Reporting rubrics)

Calls `GET /v1/advisers/{globalAdviserId}/administrations/{globalAdministrationId}/mapping`.

### administrations modified

`nmbrs administrations modified`

Ids of administrations whose mappings changed after a moment

Calls `GET /v1/advisers/{globalAdviserId}/administrations-with-modified-mappings`.

- `--modified-after <value>` modifiedAfter (required)
- `--since <value>` Same as --modified-after

## dossiers

Dossiers (compilation, audit, tax) of an administration

### dossiers list

`nmbrs dossiers list <administration-id>`

List of Dossiers

Calls `GET /v1/advisers/{globalAdviserId}/administrations/{globalAdministrationId}/dossiers`.

- `--filter <field=op:value>` Filter, e.g. year=eq:2025 or dossierType=in:CMP,ADT (repeatable)
- `--sort <fields>` Sort by these fields; - in front for descending, e.g. -year,name

## webhooks

Webhook registrations: where Nmbrs Reporting sends event notifications

### webhooks list

`nmbrs webhooks list`

List of webhooks

Calls `GET /v1/advisers/{globalAdviserId}/webhooks`.

### webhooks show

`nmbrs webhooks show <webhook-id>`

Details of a webhook

Calls `GET /v1/advisers/{globalAdviserId}/webhooks/{webhookId}`.

### webhooks create

`nmbrs webhooks create`  (alias: register)

Register a webhook

Calls `POST /v1/advisers/{globalAdviserId}/webhooks` (makes a plan).

- `--global-client-id <value>` globalClientId
- `--webhook-type-id <value>` webhookTypeId (required)
- `--webhook-name <value>` webhookName (required)
- `--callback-url <value>` callbackUrl (required)
- `--callback-secret <value>` callbackSecret (required)
- `--type <value>` Same as --webhook-type-id
- `--name <value>` Same as --webhook-name
- `--url <value>` Same as --callback-url
- `--secret <value>` Same as --callback-secret

Body fields:

```
globalClientId (string, guid)
webhookTypeId* (string, guid)
webhookName* (string)
callbackUrl* (string)
callbackSecret* (string)
```

### webhooks update

`nmbrs webhooks update <webhook-id>`

Change a webhook's name, callback URL and secret (all three are required)

Calls `PUT /v1/advisers/{globalAdviserId}/webhooks/{webhookId}` (makes a plan).

- `--webhook-name <value>` webhookName (required)
- `--callback-url <value>` callbackUrl (required)
- `--callback-secret <value>` callbackSecret (required)
- `--name <value>` Same as --webhook-name
- `--url <value>` Same as --callback-url
- `--secret <value>` Same as --callback-secret

Body fields:

```
webhookName* (string)
callbackUrl* (string)
callbackSecret* (string)
```

### webhooks delete

`nmbrs webhooks delete <webhook-id>`

Delete a webhook registration

Calls `DELETE /v1/advisers/{globalAdviserId}/webhooks/{webhookId}` (makes a plan).

## signing

Digital signing: fetch documents to sign, hand back signed ones, post status

### signing documents

`nmbrs signing documents`

Documents (and attachments and signers) of a signing request

Calls `GET /v1/document-signing/documents`.

- `--request-id <value>` This requestId is received as payload of the callback. (required)
- `--save-dir <dir>` Save the base64 documents in the answer as files here (and leave them out of the output)

### signing send-signed

`nmbrs signing send-signed`

Hand the signed documents of a signing request back to Nmbrs Reporting

Calls `POST /v1/document-signing/documents` (makes a plan).

- `--request-id <value>` requestId (required)
- `--documents <json>` documents (required)

Body fields:

```
documents* (array[object])
  content (string)  Base64 encoded.
  xbrl (string)  Base64 encoded xbrl document.
  name* (string)
  type* (string)
  cocNumber* (string)
  financialYear* (string)
  signers* (array[object])
    email* (string)
    name* (string)
    datetime* (string, date-time)
    message* (string)
```

### signing status

`nmbrs signing status`

Post a status update for a signing request

Calls `POST /v1/document-signing/status` (makes a plan).

- `--request-id <value>` requestId (required)
- `--status <value>` status (required)
- `--content <value>` content (required)

Body fields:

```
status* (string)
content* (string)
```

## api

`nmbrs api <method> <path>`

Call any Nmbrs Reporting endpoint directly (escape hatch for anything without a friendly command)

- `-q, --query <key=value>` Query parameter (repeatable)
- `--filter <field=op:value>` JSON:API filter, e.g. year=eq:2025 (repeatable)

## endpoints

`nmbrs endpoints [words...]`

List or search every Nmbrs Reporting API endpoint (from the bundled docs catalog)

- `--group <name>` Only this docs group, e.g. Webhooks

## describe

`nmbrs describe <endpoint>`

Show an endpoint's parameters, body fields and response fields

