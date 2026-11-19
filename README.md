<h1 align="center">nmbrs</h1>

<p align="center">
  <b>The Nmbrs Reporting public API on your command line, built so AI agents can work with it safely.</b>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/setup.md">Setup guide</a> ·
  <a href="docs/setup.md#install-with-an-ai-agent">Install with an AI agent</a> ·
  <a href="#what-it-can-do">What it can do</a> ·
  <a href="skill/nmbrs/reference.md">Command reference</a> ·
  <a href="LICENSE">MIT license</a>
</p>

---

`nmbrs` is an unofficial, open-source command-line tool for [Nmbrs Reporting](https://visionplanner.stoplight.io/docs/visionplanner-public-api-s)
(formerly Visionplanner), the financial reporting platform for accountancy firms. It covers every endpoint of
the public API: administrations (clients) and their client cards, rubric and period mappings, dossiers,
webhooks and digital signing. It also comes with a [Claude skill](skill/nmbrs/SKILL.md) that teaches
Claude Code (or any agent that runs shell commands) how to use it well.

```console
$ nmbrs administrations list --fields name,clientIdentifier,cocNumber
name                  clientIdentifier  cocNumber
--------------------  ----------------  ---------
Bakkerij de Vries BV  K1042             12345678
Studio Noord          K1077             87654321
(2 rows)
```

> Not affiliated with or endorsed by Nmbrs or Visma. You connect it with your own API connection from
> Connect Center and log in as yourself.

## Why

- **One command to get going.** `nmbrs setup` asks for the Client ID and Client Secret, checks them, opens the
  browser to log in, remembers your adviser and installs the Claude skill. After that, every command just works.
- **The login looks after itself.** Nmbrs Reporting uses OAuth with PKCE and single-use refresh tokens that last
  180 days. `nmbrs` refreshes them for you, never spends the same refresh token twice (even with parallel
  commands), and renews the 180 days every time it is used.
- **Nothing changes by accident.** Reading runs straight away. Anything that would change data comes back as a
  *plan* first: what it will send, which administration or webhook it touches, and a warning when it is hard to
  undo. Only `nmbrs apply <plan-id>` sends it, once, within 15 minutes.
- **Made for agents.** `--json` everywhere, stable exit codes, JSON:API responses flattened to plain objects,
  `--fields` and `--limit` to keep answers small, and help that lists every field from the official spec.

## Quick start

macOS and Linux:

```bash
curl -fsSL https://github.com/ig-shadow-walker/nmbrsCLI/releases/latest/download/install.sh | sh
```

Windows (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -c "iex ((New-Object Net.WebClient).DownloadString('https://github.com/ig-shadow-walker/nmbrsCLI/releases/latest/download/install.ps1'))"
```

The installer checks the download against `SHA256SUMS`, puts `nmbrs` on your PATH and starts `nmbrs setup`:

```text
Nmbrs Reporting CLI setup

This connects the `nmbrs` command to Nmbrs Reporting. You need an API connection from Connect Center
(adviser settings > Connect Center > + Connectie toevoegen; its Eigenschappen tab shows the Client ID
and Client Secret). Give that connection this Callback URL:

  http://localhost:47615/callback

Client ID: 3f1c…
Client Secret (hidden): ****************
Checking the Client ID and Secret…
Log in to Nmbrs Reporting now (your browser opens)? [Y/n]
Install the Claude skill, so Claude Code knows how to use nmbrs? [Y/n]

Your browser opens to log in to Nmbrs Reporting. …
Waiting for the login to finish (Ctrl-C to cancel)…

✓ Logged in to Nmbrs Reporting (production) as anna@kantoor.nl.
✓ Commands act for adviser 0b6c…
✓ Saved to ~/.config/nmbrs/credentials (only you can read it).
✓ Claude skill installed in ~/.claude/skills/nmbrs.
```

The step-by-step version, including where things are in Connect Center, is in the
[setup guide](docs/setup.md).

## Supported platforms

| | x64 | ARM64 |
|---|---|---|
| macOS 11+ | ✓ | ✓ (Apple silicon) |
| Linux (glibc and musl/Alpine) | ✓ | ✓ |
| Windows 10 1809+ / 11 | ✓ | ✓ |

One self-contained binary per platform; nothing else to install.

## How changes work: plan, then apply

```console
$ nmbrs webhooks create --data-file webhook.json
Plan 6f2a91c0de (nothing has been sent yet)
  Register a webhook (webhookName=Signing portal, callbackUrl=https://sign.example.com/nmbrs)
  ! Nmbrs Reporting will POST events (with the callback secret) to this callback URL from now on.
  POST https://vpc-nl.reporting.nmbrs.com/public-api/v1/advisers/0b6c…/webhooks
  { "webhookTypeId": "3085ef58-…", "webhookName": "Signing portal", "callbackUrl": "…", "callbackSecret": "****" }
To do it: nmbrs apply 6f2a91c0de   (expires …)

$ nmbrs apply 6f2a91c0de
```

A write exits with code 2 and sends nothing. For changes to something that exists (a webhook, a client card)
the plan first reads it, so it shows what you are about to change, and refuses when it isn't there. Plans
can be applied once and expire after 15 minutes. `nmbrs plans list` shows pending ones.

## What it can do

| Area | Commands |
|---|---|
| Who am I | `whoami`, `auth test`, `auth status` |
| Administrations (clients) | `administrations list` (filter by name, client id, CoC number, id), `create`, `update-client-card`, `mapping`, `modified --since` |
| Dossiers | `dossiers list <administration-id>` with `--filter year=eq:2025`, `--sort -lastUpdatedDate`, paging |
| Webhooks | `webhooks list/show/create/update/delete` |
| Digital signing | `signing documents --request-id … --save-dir …`, `signing send-signed`, `signing status` |
| Everything else | `endpoints <words>`, `describe <endpoint>`, `api <METHOD> <path>` |

`{globalAdviserId}` is filled in for you: setup saves the adviser of the user who logged in (override with
`--adviser-id`). Every command's `--help` lists its fields from the official OpenAPI spec; the full list is in
[skill/nmbrs/reference.md](skill/nmbrs/reference.md).

## Using it with AI agents

`nmbrs setup` installs a skill in `~/.claude/skills/nmbrs` (or `nmbrs skill install` any time). Claude Code
picks it up automatically, so you can ask things like:

- "Which of our clients have a compilation dossier for 2025 that isn't finished yet?"
- "Update the website on the client card of Bakkerij de Vries."
- "Register our signing portal as a webhook."

The skill tells the agent to use `--json`, to find ids with a read first, to show you every plan and only apply
it after you say yes, and to send you to your own terminal for `nmbrs setup` / `nmbrs login` (the agent never
sees your Client Secret). Other agents can read [SKILL.md](skill/nmbrs/SKILL.md) the same way.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | OK |
| 1 | Bad input, or the API refused it (400/422) |
| 2 | A plan was made; nothing was sent |
| 3 | Not set up, not logged in, or the login expired: run `nmbrs setup` / `nmbrs login` |
| 4 | The user or API connection is not authorized for this |
| 5 | Nmbrs Reporting unavailable, throttled or timed out (a change may or may not have happened) |
| 6 | Not found |

## Security and privacy

- The Client ID and Secret are stored in `~/.config/nmbrs/credentials` (`%APPDATA%\nmbrs\credentials` on
  Windows), the login (refresh and access token) in `session.json` next to it. Both are readable only by you.
  Nothing is read from the current folder, so a stray `.env` can't redirect it.
- The secret is never taken as a command-line argument (it would end up in shell history); setup asks for it
  hidden, or reads it from stdin with `--client-secret-stdin`.
- Tokens are only ever sent to the configured Nmbrs Reporting hosts. Plans hide secrets (`callbackSecret`) when
  shown. `nmbrs logout` revokes the refresh token at Nmbrs Reporting and deletes it locally.
- Login uses the authorization code flow with PKCE (S256) and a random `state`, with a listener on
  `localhost` only for the duration of the login.

## Configuration

`nmbrs setup` writes everything. To override (CI, containers), set environment variables; they win over the file:

| Variable | Meaning |
|---|---|
| `NMBRS_CLIENT_ID`, `NMBRS_CLIENT_SECRET` | The API connection |
| `NMBRS_ENVIRONMENT` | `production` (default) or `sandbox` |
| `NMBRS_ADVISER_ID` | The globalAdviserId commands act for |
| `NMBRS_REDIRECT_URI` | Callback URL for the login (default `http://localhost:47615/callback`) |
| `NMBRS_CONFIG_DIR` | Where credentials, session and plans live |
| `NMBRS_OUTPUT=json` | Always print JSON |
| `NMBRS_API_URL`, `NMBRS_AUTH_URL` | Point at other hosts (testing) |

## Development

```bash
bun install
bun test               # unit tests plus a fake Nmbrs Reporting (login server and API), no network
bun run typecheck
bun run dev -- administrations list --help
bun run sync-docs      # rebuild catalog/endpoints.json from the published OpenAPI spec
bun run reference      # regenerate skill/nmbrs/reference.md (a test checks it is current)
bun run install:local  # build, install ~/.local/bin/nmbrs and link the skill
```

The friendly commands are thin: `src/registry.ts` names them and maps each to an endpoint in
`catalog/endpoints.json`; options, required fields, help and validation come from the catalog.

### Releasing

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry.
2. `bun test && bun run build:release`: builds every platform, the installers and `SHA256SUMS` into
   `dist/release/`. To try the installer against them first:
   `bun run scripts/serve-release.ts dist/release 47812` and, in another terminal,
   `NMBRS_DOWNLOAD_URL=http://127.0.0.1:47812 sh install.sh --dir /tmp/nmbrs-try --no-setup`.
3. Push, then create a GitHub release tagged `v<version>` (not a draft or pre-release, or the `latest` install
   links won't find it) and attach every file in `dist/release/`. With the GitHub CLI:
   `gh release create v<version> dist/release/* --title v<version> --notes-file CHANGELOG.md`.

Alternatively, Actions > Release > Run workflow with an existing release tag does steps 2 and 3's upload on GitHub.

## License

MIT
