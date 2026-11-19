# Changelog

## 0.1.0

First release.

- **`nmbrs setup`**: asks for the Client ID and Client Secret of an API connection from Connect Center, checks
  them (and detects sandbox connections), logs in in the browser with OAuth authorization code + PKCE, saves the
  adviser of the user who logged in, and installs the Claude skill. `--manual` for machines without a browser,
  `--client-secret-stdin` for password managers.
- **Login that looks after itself**: single-use refresh tokens are rotated under a lock, so parallel commands never
  spend the same one; every use renews the 180-day login. `nmbrs login`, `nmbrs logout`, `nmbrs auth status/test/refresh`.
- **Commands for every endpoint** of the public API, generated from the published OpenAPI spec:
  administrations (list, create, update-client-card, mapping, modified), dossiers (with JSON:API filters, sort and
  both paging styles), webhooks, digital signing (with `--save-dir` for documents), plus `api`, `endpoints`, `describe`.
- **Plan, then apply** for every change, with the current state read first and warnings for risky changes.
- Installers for macOS, Linux and Windows that verify `SHA256SUMS`.
