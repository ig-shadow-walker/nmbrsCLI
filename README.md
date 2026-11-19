<h1 align="center">nmbrs</h1>

<p align="center">
  <b>Nmbrs Reporting on your command line, and in Claude Code.</b><br>
  Clients, client cards, dossiers, mappings, webhooks and digital signing, from one small tool that is safe to hand to an AI agent.
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-0.1.0-6b5dff">
  <img alt="platforms" src="https://img.shields.io/badge/macOS%20%C2%B7%20Linux%20%C2%B7%20Windows-x64%20%26%20ARM64-010149">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-green">
</p>

<p align="center">
  <a href="#-setup-in-3-steps">Setup</a> ·
  <a href="#-use-it-with-claude-code">Claude Code</a> ·
  <a href="#-commands">Commands</a> ·
  <a href="#-troubleshooting">Troubleshooting</a> ·
  <a href="docs/setup.md">Full setup guide</a> ·
  <a href="skill/nmbrs/reference.md">Command reference</a>
</p>

---

```console
$ nmbrs administrations list --fields name,clientIdentifier,cocNumber
name                  clientIdentifier  cocNumber
--------------------  ----------------  ---------
Bakkerij de Vries BV  K1042             12345678
Studio Noord          K1077             87654321
(2 rows)

$ nmbrs dossiers list <administration-id> --filter year=eq:2025 --fields name,dossierType,status,dueDate
name                    dossierType  status      dueDate
----------------------  -----------  ----------  -------------------------
Jaarrekening 2025       CMP          InProgress  2026-06-30T00:00:00+00:00
(1 row)
```

**nmbrs** is an unofficial, open-source command-line tool for **Nmbrs Reporting** (formerly Visionplanner), the
financial reporting platform for accountancy firms. It covers the whole
[public API](https://visionplanner.stoplight.io/docs/visionplanner-public-api-s) and comes with a
[Claude skill](skill/nmbrs/SKILL.md), so you can ask Claude Code about your clients and dossiers in plain language.

> **Heads-up:** this is for *Nmbrs Reporting* (reports, compilation and audit dossiers), not Nmbrs payroll.
> It is not affiliated with or endorsed by Nmbrs or Visma.

## Contents

- [What you get](#-what-you-get)
- [Setup in 3 steps](#-setup-in-3-steps)
- [Check that it works](#-check-that-it-works)
- [Use it with Claude Code](#-use-it-with-claude-code)
- [Commands](#-commands)
- [How changes work: plan, then apply](#-how-changes-work-plan-then-apply)
- [Your login and your data](#-your-login-and-your-data)
- [Troubleshooting](#-troubleshooting)
- [Reference: settings and exit codes](#-reference-settings-and-exit-codes)
- [Update or uninstall](#-update-or-uninstall)
- [Development](#-development)

## ✨ What you get

- **One command to set up.** `nmbrs setup` asks for your Client ID and Secret, logs you in through the browser,
  remembers your firm (adviser) and installs the Claude skill.
- **Log in once, then forget about it.** The login lasts 180 days and renews itself every time you use `nmbrs`.
- **Nothing changes by accident.** Reading is instant. Every change is shown to you as a *plan* first and only
  happens when you run `nmbrs apply`.
- **Built for AI agents.** `--json` output, clear exit codes, small answers with `--fields`, and a skill that tells
  Claude to check with you before it changes anything.
- **Everything from the official spec.** Every command's `--help` lists its fields, required ones marked `*`.

## 🚀 Setup in 3 steps

You need about five minutes, and you must be an **adviser admin** in Nmbrs Reporting (to add an API connection).

### Step 1: Create an API connection in Nmbrs Reporting

1. In Nmbrs Reporting, open the **adviser settings** and go to **Connect Center**.
2. Click **+ Connectie toevoegen** (add connection) and give it a name, e.g. `nmbrs CLI`.
3. In the **Callback URL** field, enter exactly:

   ```text
   http://localhost:47615/callback
   ```

   > ⚠️ **This is the step people miss.** It must be exactly this text: `http://` (not https), no trailing slash,
   > no spaces. Already have other callback URLs? Separate them with commas. Without it, the login page shows
   > **"Sorry, there was an error: invalid_request"**.

4. Save, open the connection, and go to the **Eigenschappen** (Properties) tab. Keep the **Client ID** and
   **Client Secret** at hand for step 3. Treat the secret like a password.

### Step 2: Install nmbrs

**macOS or Linux:**

```bash
curl -fsSL https://github.com/ig-shadow-walker/nmbrsCLI/releases/latest/download/install.sh | sh
```

**Windows** (PowerShell, no administrator rights needed):

```powershell
powershell -ExecutionPolicy Bypass -c "iex ((New-Object Net.WebClient).DownloadString('https://github.com/ig-shadow-walker/nmbrsCLI/releases/latest/download/install.ps1'))"
```

The installer checks the download against `SHA256SUMS`, puts `nmbrs` on your PATH and starts step 3 for you.
Open a new terminal afterwards so the `nmbrs` command is found.

<details>
<summary><b>The repository is private, or the one-liner gives a 404</b></summary>

The one-liners only work while the repository is public. If you have access through GitHub, download the release
with the [GitHub CLI](https://cli.github.com) and install from that folder:

```bash
gh release download v0.1.0 --repo ig-shadow-walker/nmbrsCLI --dir ~/Downloads/nmbrs-release
NMBRS_DOWNLOAD_URL=~/Downloads/nmbrs-release sh ~/Downloads/nmbrs-release/install.sh
```

Or install the binary by hand. Pick the file for your computer (e.g. `nmbrs-darwin-arm64` on an Apple-silicon Mac):

```bash
mkdir -p ~/.local/bin
mv ~/Downloads/nmbrs-darwin-arm64 ~/.local/bin/nmbrs
chmod +x ~/.local/bin/nmbrs
xattr -d com.apple.quarantine ~/.local/bin/nmbrs 2>/dev/null   # macOS only
nmbrs setup
```

| Your computer | File |
|---|---|
| Mac with Apple silicon (M1 and newer) | `nmbrs-darwin-arm64` |
| Mac with Intel | `nmbrs-darwin-x64` |
| Linux x64 / ARM64 | `nmbrs-linux-x64` / `nmbrs-linux-arm64` (`-musl` for Alpine) |
| Windows x64 / ARM64 | `nmbrs-windows-x64.exe` / `nmbrs-windows-arm64.exe` |

</details>

<details>
<summary><b>Installer options</b></summary>

macOS/Linux: add them after `sh -s --`, e.g. `curl … | sh -s -- --dir ~/bin --no-setup`.

| Option | Environment variable | Meaning |
|---|---|---|
| `--version v0.1.0` | `NMBRS_VERSION` | Install a specific release (default: latest) |
| `--dir <path>` | `NMBRS_INSTALL_DIR` | Where the binary goes (default `~/.local/bin`, Windows `%LOCALAPPDATA%\Programs\nmbrs`) |
| `--no-setup` | `NMBRS_NO_SETUP=1` | Don't start `nmbrs setup` afterwards |
| `--no-modify-path` | `NMBRS_NO_MODIFY_PATH=1` | Don't add the folder to your PATH |
| | `NMBRS_DOWNLOAD_URL` | Download from another URL or a local folder |

</details>

### Step 3: Run the setup

The installer starts it. Otherwise, run:

```bash
nmbrs setup
```

It walks you through everything:

```text
Nmbrs Reporting CLI setup

This connects the `nmbrs` command to Nmbrs Reporting. You need an API connection from Connect Center
(adviser settings > Connect Center > + Connectie toevoegen; its Eigenschappen tab shows the Client ID
and Client Secret). Give that connection this Callback URL:

  http://localhost:47615/callback

Client ID: cfc8…
Client Secret (hidden): ****************
Checking the Client ID and Secret…
Log in to Nmbrs Reporting now (your browser opens)? [Y/n]
Install the Claude skill, so Claude Code knows how to use nmbrs? [Y/n]

Your browser opens to log in to Nmbrs Reporting. If it doesn't, open this address: …
Waiting for the login to finish (Ctrl-C to cancel)…

✓ Logged in to Nmbrs Reporting (production) as anna@kantoor.nl.
✓ Commands act for adviser 0b6c…
✓ Saved to ~/.config/nmbrs/credentials (only you can read it).
  The login lasts 180 days and renews itself whenever nmbrs is used.
✓ Claude skill installed in ~/.claude/skills/nmbrs.

You're set. Try:
  nmbrs administrations list
```

When your browser shows **"Logged in to Nmbrs Reporting. You can close this tab"**, you're done.

<details>
<summary><b>Special cases: sandbox, no browser, password manager, another callback URL</b></summary>

| Situation | Run |
|---|---|
| Your API connection is in the **sandbox** | `nmbrs setup --sandbox` (setup also notices this itself) |
| **No browser** on this machine (SSH, server) | `nmbrs setup --manual`: open the printed address anywhere, log in, then paste the address the browser lands on (it may say "can't connect"; the code is in the address) |
| Secret from a **password manager** | `op read op://Vault/Nmbrs/secret \| nmbrs setup --client-id <id> --client-secret-stdin` |
| Connect Center **won't accept** an `http://localhost` callback | Register an https URL you own (the page doesn't need to exist), then `nmbrs setup --redirect-uri https://your-site.nl/nmbrs-callback`; it switches to paste mode automatically |
| Save credentials now, **log in later** | `nmbrs setup --no-login`, later `nmbrs login` |
| Act for **another adviser** | `nmbrs setup --adviser-id <globalAdviserId>`, or `--adviser-id` on a single command |

Run `nmbrs setup` again any time to change something; it offers to reuse what's saved.

</details>

## ✅ Check that it works

```bash
nmbrs auth test                       # refreshes the login and asks Nmbrs Reporting who you are
nmbrs administrations list --limit 5  # your first five clients
```

`nmbrs auth status` shows the environment, your adviser and when the login expires, without contacting the API.

## 🤖 Use it with Claude Code

If you said yes to the skill during setup, Claude Code already knows how to use `nmbrs`. (Missed it? Run
`nmbrs skill install`.) Just ask:

- *"Which of our clients have a 2025 compilation dossier that isn't finished yet?"*
- *"Show me the client card of Bakkerij de Vries."*
- *"Which administrations had mapping changes since 1 November?"*
- *"Change the website on the client card of Studio Noord to studionoord.nl."*
- *"Register our signing portal as a webhook."*

The skill makes Claude:

- use `--json` and fetch only the fields it needs,
- look up ids instead of guessing them,
- **show you every change as a plan and only apply it after you say yes**,
- send you to your own terminal for `nmbrs setup` / `nmbrs login`, so it never sees your Client Secret.

Other agents (Cursor, Codex, your own scripts) can read [`skill/nmbrs/SKILL.md`](skill/nmbrs/SKILL.md) the same way,
or install it anywhere with `nmbrs skill install --dir <folder>`.

## 📋 Commands

| You want to… | Command |
|---|---|
| See who you're logged in as | `nmbrs whoami` |
| List all clients | `nmbrs administrations list --all` |
| Find a client | `nmbrs administrations list --name bakkerij` (or `--coc-number`, `--client-identifier`, `--id`) |
| See a client's details (legal form, address, SBI…) | `nmbrs administrations list --id <administration-id>` |
| Update a client card | `nmbrs administrations update-client-card <administration-id> --website https://…` |
| Add a client | `nmbrs administrations create --name "Nieuw BV" --period-type month --start-fiscal-year january` |
| See how a client's ledger maps to rubrics and periods | `nmbrs administrations mapping <administration-id>` |
| Find clients whose mappings changed | `nmbrs administrations modified --since 2026-11-01T00:00:00+00:00` |
| List a client's dossiers | `nmbrs dossiers list <administration-id>` |
| Manage webhooks | `nmbrs webhooks list` · `show` · `create` · `update` · `delete` |
| Get documents waiting for a signature | `nmbrs signing documents --request-id <id> --save-dir ./to-sign` |
| Hand back signed documents | `nmbrs signing send-signed --request-id <id> --data-file signed.json` |
| Anything else in the API | `nmbrs endpoints <words>` → `nmbrs describe <endpoint>` → `nmbrs api GET <path>` |

**Handy options on every command:**

| Option | What it does |
|---|---|
| `--json` | Machine-readable output: `{"ok": true, "data": …, "meta": …}` |
| `--fields name,cocNumber` | Only these fields |
| `--limit 10` | At most 10 results |
| `--all` / `--page 2` / `--page-size 50` | Paging through long lists |
| `--help` | Every option and field of a command, with examples |

**Filtering and sorting dossiers:**

```bash
nmbrs dossiers list <id> --filter year=eq:2025                    # equal
nmbrs dossiers list <id> --filter dossierType=in:CMP,ADT          # one of several
nmbrs dossiers list <id> --filter "name=like:jaarrekening"        # contains
nmbrs dossiers list <id> --sort -lastUpdatedDate                  # newest first
```

Operations: `eq` `ne` `gt` `ge` `lt` `le` `like` `startswith` `endswith` `in`. Dossier types: `CMP` compilation,
`ADT` audit, `TXI` income tax, `TXC` corporate tax, `CMP_FE` compilation (foreign entity).

The complete list of commands, options and fields is in [skill/nmbrs/reference.md](skill/nmbrs/reference.md).

## 🛡️ How changes work: plan, then apply

Anything that would change data in Nmbrs Reporting **sends nothing**. It shows you a plan instead:

```console
$ nmbrs administrations update-client-card 2f1c… --website https://devries.nl
Plan 6f2a91c0de (nothing has been sent yet)
  Update Client Card on Bakkerij de Vries BV, K1042
  ! Overwrites the client card (legal and contact details) of this administration.
  PATCH https://vpc-nl.reporting.nmbrs.com/public-api/v1/advisers/0b6c…/administrations/2f1c…/client-card
  {
    "website": "https://devries.nl"
  }
To do it: nmbrs apply 6f2a91c0de   (expires …)

$ nmbrs apply 6f2a91c0de
```

- The plan reads the current state first, so you see **which** client or webhook you're about to change, and it
  refuses if it doesn't exist.
- Risky changes get a `!` warning (creating clients, overwriting client cards, webhooks, signing).
- A plan works **once** and **expires after 15 minutes**. `nmbrs plans list` shows pending plans,
  `nmbrs plans discard <id>` throws one away.
- Secrets (like a webhook's `callbackSecret`) are shown as `****`.

## 🔐 Your login and your data

| What | Where | Notes |
|---|---|---|
| Client ID, Secret, environment, adviser | `~/.config/nmbrs/credentials` (Windows: `%APPDATA%\nmbrs\credentials`) | Readable only by you |
| Your login (tokens) | `session.json` in the same folder | Readable only by you |
| Pending plans | `plans/` in the same folder | Deleted after apply or 15 minutes |
| Claude skill | `~/.claude/skills/nmbrs` | |

- You log in as **yourself**, through Nmbrs Reporting's own login page (OAuth with PKCE). `nmbrs` only ever sees
  the resulting tokens, never your password.
- The login lasts **180 days** and every command renews it. If it lapses, run `nmbrs login`.
- The Client Secret is never accepted as a command-line argument, so it can't end up in your shell history.
- Tokens are only sent to Nmbrs Reporting's own servers.
- `nmbrs logout` revokes the login at Nmbrs Reporting and removes it from your computer.

## 🩺 Troubleshooting

| You see | What to do |
|---|---|
| **"Sorry, there was an error: invalid_request"** on the Nmbrs Reporting page during login | The Callback URL is missing or slightly different. In Connect Center, set it to exactly `http://localhost:47615/callback` (http, no trailing slash), save, then run `nmbrs login` |
| **"Sorry, there was an error: unauthorized_client"** | The Client ID isn't known in this environment. Check you copied it fully; for a sandbox connection use `nmbrs setup --sandbox` |
| "did not accept that Client ID and Secret" | Copy both again from the Eigenschappen tab |
| Setup waits and then says the login "did not come back within 5 minutes" | The browser login didn't finish, or the page showed an error (see the first row). Run `nmbrs login` to try again |
| "Can't listen on localhost:47615" | Another program uses that port. Close it, or use `nmbrs login --manual` |
| The browser doesn't open | Copy the address that `nmbrs` prints into your browser, or use `--manual` |
| Exit code 3: "login expired" or `invalid_grant` | Run `nmbrs login`. This also happens if you copied your config folder to another machine and used it there |
| Exit code 4: not authorized | Your user lacks rights for that client or adviser; an adviser admin can grant them |
| "No adviser id is known" | Run `nmbrs setup` again, or add `--adviser-id <id>` |
| `nmbrs: command not found` | Open a new terminal. Still missing? Add `~/.local/bin` to your PATH (setup prints the exact line) |

Still stuck? Run the command again with `-v --json` and check the output; it never contains your secret or tokens.

## 📖 Reference: settings and exit codes

<details>
<summary><b>Environment variables</b> (override the saved settings; handy for CI and containers)</summary>

| Variable | Meaning |
|---|---|
| `NMBRS_CLIENT_ID`, `NMBRS_CLIENT_SECRET` | The API connection |
| `NMBRS_ENVIRONMENT` | `production` (default) or `sandbox` |
| `NMBRS_ADVISER_ID` | The adviser (globalAdviserId) commands act for |
| `NMBRS_REDIRECT_URI` | Callback URL for the login (default `http://localhost:47615/callback`) |
| `NMBRS_CONFIG_DIR` | Where credentials, login and plans are kept |
| `NMBRS_OUTPUT=json` | Always print JSON |
| `NMBRS_API_URL`, `NMBRS_AUTH_URL` | Point at other servers (testing) |

</details>

<details>
<summary><b>Exit codes</b> (scripts and agents can branch on these)</summary>

| Code | Meaning |
|---|---|
| 0 | OK |
| 1 | Bad input, or Nmbrs Reporting refused it |
| 2 | A plan was made; nothing was sent |
| 3 | Not set up, not logged in, or the login expired |
| 4 | Not authorized |
| 5 | Nmbrs Reporting unavailable, throttled or timed out (a change may or may not have happened) |
| 6 | Not found |

</details>

<details>
<summary><b>Supported platforms</b></summary>

| | x64 | ARM64 |
|---|---|---|
| macOS 11+ | ✓ | ✓ (Apple silicon) |
| Linux (glibc and musl/Alpine) | ✓ | ✓ |
| Windows 10 1809+ / 11 | ✓ | ✓ |

One self-contained binary per platform; nothing else to install.

</details>

## 🔄 Update or uninstall

- **Update:** run the install command again. Your settings and login are kept.
- **Change credentials, environment or adviser:** `nmbrs setup`.
- **Log out:** `nmbrs logout`.
- **Uninstall:** delete the binary (`~/.local/bin/nmbrs`, or `%LOCALAPPDATA%\Programs\nmbrs` on Windows), the
  settings folder (`~/.config/nmbrs`, or `%APPDATA%\nmbrs`) and the skill (`~/.claude/skills/nmbrs`).

## 🛠️ Development

```bash
bun install
bun test               # unit tests and a fake Nmbrs Reporting (login server and API); no network
bun run typecheck
bun run dev -- administrations list --help
bun run sync-docs      # rebuild catalog/endpoints.json from the published OpenAPI spec
bun run reference      # regenerate skill/nmbrs/reference.md (a test checks it's current)
bun run install:local  # build, install ~/.local/bin/nmbrs and link the skill
```

The friendly commands are thin: [`src/registry.ts`](src/registry.ts) names them and maps each one to an endpoint in
[`catalog/endpoints.json`](catalog/endpoints.json). Options, required fields, help and validation all come from
the catalog.

<details>
<summary><b>Releasing</b></summary>

1. Bump `version` in `package.json` (and the badge at the top of this file), and add a `CHANGELOG.md` entry.
2. `bun test && bun run build:release` builds every platform, the installers and `SHA256SUMS` into `dist/release/`.
   To try the installer against them first:
   `NMBRS_DOWNLOAD_URL=dist/release sh install.sh --dir /tmp/nmbrs-try --no-setup`.
3. Commit, push, tag `v<version>` and push the tag.
4. Create a GitHub release for that tag (not a draft or pre-release, or the `latest` links won't find it) and attach
   every file in `dist/release/`. With the GitHub CLI:
   `gh release create v<version> dist/release/* --title v<version> --notes-file CHANGELOG.md`.

Alternatively, Actions > Release > Run workflow with an existing release tag builds and uploads on GitHub.

</details>

## License

MIT. Not affiliated with or endorsed by Nmbrs or Visma; you connect it with your own API connection and log in as yourself.
