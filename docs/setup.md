# Setup guide

This takes about five minutes: make an API connection in Nmbrs Reporting, install `nmbrs`, and run
`nmbrs setup`. You need to be an adviser admin in Nmbrs Reporting to add the connection.

## 1. Create an API connection in Connect Center

1. In Nmbrs Reporting, open the adviser settings and go to **Connect Center**.
2. Click **+ Connectie toevoegen** to add an "API connection".
3. Give it a name (e.g. "nmbrs CLI") and set the **Callback URL** to:

   ```text
   http://localhost:47615/callback
   ```

   This is where the browser login hands control back to `nmbrs` on your own computer. You can list more
   than one Callback URL, separated by commas. (Using another one? Pass it to setup with `--redirect-uri`.)
4. Open the connection and go to the **Eigenschappen** (Properties) tab. Copy the **Client ID** and the
   **Client Secret**. Treat the secret like a password.

An API connection works for the adviser it was created in. That is all you need for your own firm.
(Integration partners whose connection must work for other advisers ask Nmbrs Reporting support to upgrade it.)

For the **sandbox**, create the connection in the sandbox environment and run `nmbrs setup --sandbox`
(setup also notices on its own when the Client ID belongs to the sandbox).

## 2. Install nmbrs

### macOS and Linux

```bash
curl -fsSL https://github.com/ig-shadow-walker/nmbrsCLI/releases/latest/download/install.sh | sh
```

Options go after `sh -s --`, e.g. `| sh -s -- --dir ~/bin --no-setup`:
`--version <tag>`, `--dir <path>` (default `~/.local/bin`), `--no-setup`, `--no-modify-path`.

### Windows

In PowerShell (no administrator rights needed):

```powershell
powershell -ExecutionPolicy Bypass -c "iex ((New-Object Net.WebClient).DownloadString('https://github.com/ig-shadow-walker/nmbrsCLI/releases/latest/download/install.ps1'))"
```

It installs to `%LOCALAPPDATA%\Programs\nmbrs` and adds that folder to your user PATH. Open a new terminal
afterwards.

Both installers verify the download against `SHA256SUMS` and start `nmbrs setup` when they're done. Running
them again updates `nmbrs` and keeps your login.

## 3. Run the setup wizard

The installer starts it; otherwise run:

```bash
nmbrs setup
```

It:

1. asks for the **Client ID** and **Client Secret** (the secret is hidden while you type or paste it),
2. checks them with Nmbrs Reporting (and asks again if they're wrong),
3. opens your browser to **log in** to Nmbrs Reporting as yourself, then catches the answer on
   `http://localhost:47615/callback`,
4. reads who you are (`/v1/me`) and saves your **adviser**, so commands don't need it,
5. installs the **Claude skill** in `~/.claude/skills/nmbrs`.

Everything is saved in `~/.config/nmbrs/` (`%APPDATA%\nmbrs\` on Windows), readable only by you. The login lasts
180 days and renews itself every time `nmbrs` is used; if it ever expires, run `nmbrs login`.

**No browser on this machine** (e.g. over SSH)? Use `nmbrs setup --manual`: it prints the login address. Open it
on any computer, log in, and paste the address the browser ends up on (it starts with the Callback URL and may show
"can't connect"; that's fine, the code is in the address).

**Unattended**, with the secret from a password manager (still logs in in the browser):

```bash
op read op://Finance/Nmbrs/secret | nmbrs setup --client-id <id> --client-secret-stdin --json
```

## 4. Check that it works

```bash
nmbrs auth test
nmbrs administrations list --limit 5
```

`nmbrs auth status` shows the environment, adviser, and when the login expires, without calling the API.

## 5. Connect your AI agent

If you said yes to the skill, Claude Code already knows `nmbrs`. Ask it:
"Which administrations do we have, and which of their 2025 dossiers are still open?"

For other agents, point them at [skill/nmbrs/SKILL.md](../skill/nmbrs/SKILL.md) and
[reference.md](../skill/nmbrs/reference.md), or install them anywhere with `nmbrs skill install --dir <dir>`.

## Install with an AI agent

You can ask an agent to install it. Paste this:

> Install the nmbrs CLI from https://github.com/ig-shadow-walker/nmbrsCLI following docs/setup.md
> ("Instructions for AI agents"). Then tell me how to finish the setup myself.

### Instructions for AI agents

1. Install without starting the wizard:
   - macOS/Linux: `curl -fsSL https://github.com/ig-shadow-walker/nmbrsCLI/releases/latest/download/install.sh | sh -s -- --no-setup`
   - Windows: set `$env:NMBRS_NO_SETUP = "1"`, then run the PowerShell one-liner above.
2. Run `nmbrs skill install --json` so the skill is in place.
3. **Do not** run `nmbrs setup` yourself, and never ask the user for the Client Secret in chat. Tell the user to
   run `nmbrs setup` in their own terminal: it asks for the Client ID and Secret and opens their browser to log in.
   Mention the Callback URL `http://localhost:47615/callback` they must add to the API connection in Connect Center.
4. After they're done, check with `nmbrs auth test --json` (exit 0 means ready; exit 3 means setup or login is not finished).

## Servers and CI

The login needs a person in a browser once; after that the refresh token keeps it alive for 180 days at a time.
To use `nmbrs` on a server: run `nmbrs setup --manual` there (or set up on your laptop and copy
`~/.config/nmbrs/` across), and set `NMBRS_CONFIG_DIR` if it lives elsewhere. Don't share one config folder
between machines that run at the same time: each refresh replaces the refresh token, and the other machine's copy
stops working.

## Updating, changing and removing

- **Update:** run the installer again.
- **Change credentials, environment or adviser:** run `nmbrs setup` again (`--adviser-id` to pin another adviser).
- **Log out:** `nmbrs logout` (revokes the login at Nmbrs Reporting).
- **Remove:** delete the binary (`~/.local/bin/nmbrs`, or `%LOCALAPPDATA%\Programs\nmbrs`), `~/.config/nmbrs`
  (`%APPDATA%\nmbrs`) and `~/.claude/skills/nmbrs`.

## Troubleshooting

| Problem | Fix |
|---|---|
| The login page shows an error about the redirect/callback, or setup waits until it times out | Add `http://localhost:47615/callback` as a Callback URL of the API connection in Connect Center, then `nmbrs login` |
| "did not accept that Client ID and Secret" | Copy both again from the Eigenschappen tab. Sandbox connection? `nmbrs setup --sandbox` |
| "Can't listen on localhost:47615" | Something else uses that port. Close it, or `nmbrs login --manual` |
| Exit 3 "login expired" / `invalid_grant` | The 180 days passed, or the same session was used on another machine. `nmbrs login` |
| Exit 4 not authorized | Your user lacks the rights for that adviser or administration; an adviser admin can grant them |
| "No adviser id is known" | `nmbrs setup` again, or pass `--adviser-id` |
| `nmbrs: command not found` | Open a new terminal, or add the install folder to PATH (setup prints how) |
