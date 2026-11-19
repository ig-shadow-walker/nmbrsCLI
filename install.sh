#!/bin/sh
# Installs the nmbrs CLI and starts its setup.
#
#   curl -fsSL https://github.com/ig-shadow-walker/nmbrsCLI/releases/latest/download/install.sh | sh
#
# Options (after `sh -s --`), or the matching environment variables:
#   --version <tag>     a specific release, e.g. v0.2.0          (NMBRS_VERSION, default: latest)
#   --dir <path>        where the binary goes                    (NMBRS_INSTALL_DIR, default: ~/.local/bin)
#   --no-setup          don't start `nmbrs setup` afterwards     (NMBRS_NO_SETUP=1)
#   --no-modify-path    don't add the folder to your shell's PATH (NMBRS_NO_MODIFY_PATH=1)
# NMBRS_DOWNLOAD_URL replaces the GitHub release URL, for hosting the files elsewhere. It can also be a
# local folder holding the release files (e.g. from `gh release download`), for a private repository.
#
# Running it again updates nmbrs to the latest release and keeps your credentials.

set -eu

REPO="ig-shadow-walker/nmbrsCLI"

say() { printf '%s\n' "$*"; }
fail() { printf 'nmbrs install: %s\n' "$*" >&2; exit 1; }

# Everything runs inside main, so a download cut off halfway can't run half a script.
main() {
  version="${NMBRS_VERSION:-latest}"
  dir="${NMBRS_INSTALL_DIR:-$HOME/.local/bin}"
  setup=1
  [ -n "${NMBRS_NO_SETUP:-}" ] && setup=0
  modify_path=1
  [ -n "${NMBRS_NO_MODIFY_PATH:-}" ] && modify_path=0

  while [ $# -gt 0 ]; do
    case "$1" in
      --version) [ $# -ge 2 ] || fail "--version needs a value"; version="$2"; shift 2 ;;
      --dir) [ $# -ge 2 ] || fail "--dir needs a value"; dir="$2"; shift 2 ;;
      --no-setup) setup=0; shift ;;
      --no-modify-path) modify_path=0; shift ;;
      -h|--help) say "Options: --version <tag>  --dir <path>  --no-setup  --no-modify-path"; exit 0 ;;
      *) fail "unknown option: $1" ;;
    esac
  done

  asset="nmbrs-$(detect_platform)"

  if [ -n "${NMBRS_DOWNLOAD_URL:-}" ]; then
    base="${NMBRS_DOWNLOAD_URL%/}"
  elif [ "$version" = "latest" ]; then
    base="https://github.com/$REPO/releases/latest/download"
  else
    base="https://github.com/$REPO/releases/download/$version"
  fi

  tmp=$(mktemp -d 2>/dev/null || mktemp -d -t nmbrs)
  trap 'rm -rf "$tmp"' EXIT INT TERM

  say "Downloading $asset ($version)…"
  download "$base/$asset" "$tmp/nmbrs" || fail "could not download $base/$asset"
  download "$base/SHA256SUMS" "$tmp/SHA256SUMS" || fail "could not download $base/SHA256SUMS"

  expected=$(awk -v f="$asset" '$2 == f || $2 == "*"f { print $1 }' "$tmp/SHA256SUMS")
  [ -n "$expected" ] || fail "$asset is not listed in SHA256SUMS"
  actual=$(sha256 "$tmp/nmbrs")
  [ "$expected" = "$actual" ] || fail "checksum mismatch for $asset (expected $expected, got $actual); not installing"

  mkdir -p "$dir"
  chmod 755 "$tmp/nmbrs"
  # Move into place in one step, so a nmbrs that is running keeps working.
  mv -f "$tmp/nmbrs" "$dir/nmbrs.new"
  mv -f "$dir/nmbrs.new" "$dir/nmbrs"
  if [ "$(uname -s)" = "Darwin" ]; then
    xattr -d com.apple.quarantine "$dir/nmbrs" 2>/dev/null || true
  fi

  installed=$("$dir/nmbrs" --version 2>/dev/null) || fail "$dir/nmbrs was installed but does not run on this machine"
  say "Installed nmbrs $installed in $dir/nmbrs"

  case ":$PATH:" in
    *":$dir:"*) ;;
    *)
      if [ "$modify_path" = 1 ]; then add_to_path "$dir"; else say "Note: $dir is not on your PATH."; fi
      ;;
  esac

  if [ "$setup" = 1 ]; then
    # `curl | sh` gives this script the download as stdin, so the wizard reads the keyboard from /dev/tty.
    if [ -r /dev/tty ] && (exec </dev/tty) 2>/dev/null; then
      say ""
      PATH="$dir:$PATH" "$dir/nmbrs" setup </dev/tty || say "Setup didn't finish. Run \`nmbrs setup\` any time to try again."
    else
      say "Next: run \`nmbrs setup\` in a terminal to connect to Nmbrs Reporting."
    fi
  else
    say "Next: run \`nmbrs setup\` to connect to Nmbrs Reporting."
  fi
}

detect_platform() {
  os=$(uname -s)
  arch=$(uname -m)
  case "$os" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    MINGW*|MSYS*|CYGWIN*) fail "on Windows, use the PowerShell installer: powershell -ExecutionPolicy Bypass -c \"iex ((New-Object Net.WebClient).DownloadString('https://github.com/$REPO/releases/latest/download/install.ps1'))\"" ;;
    *) fail "unsupported system: $os" ;;
  esac
  case "$arch" in
    arm64|aarch64) arch=arm64 ;;
    x86_64|amd64) arch=x64 ;;
    *) fail "unsupported processor: $arch" ;;
  esac
  # An Intel shell on Apple silicon (Rosetta) still gets the native build.
  if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
    arch=arm64
  fi
  if [ "$os" = linux ] && { [ -f /etc/alpine-release ] || ldd --version 2>&1 | grep -qi musl; }; then
    arch="$arch-musl"
  fi
  printf '%s-%s' "$os" "$arch"
}

download() {
  case "$1" in
    http://*|https://*|file://*) ;;
    *) cp "$1" "$2"; return ;;  # a local folder of release files
  esac
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1"
  else
    fail "needs curl or wget"
  fi
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  else
    fail "needs sha256sum or shasum to check the download"
  fi
}

add_to_path() {
  line="export PATH=\"$1:\$PATH\""
  case "$(basename "${SHELL:-sh}")" in
    zsh) rc="${ZDOTDIR:-$HOME}/.zshrc" ;;
    bash) if [ "$(uname -s)" = Darwin ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi ;;
    fish)
      rc="$HOME/.config/fish/conf.d/nmbrs.fish"
      line="fish_add_path \"$1\""
      mkdir -p "$(dirname "$rc")"
      ;;
    *) rc="$HOME/.profile" ;;
  esac
  if [ -f "$rc" ] && grep -qF "$line" "$rc"; then
    :
  else
    printf '\n# Added by the nmbrs installer\n%s\n' "$line" >>"$rc"
    say "Added $1 to your PATH in $rc"
  fi
  say "Open a new terminal (or run: $line) so the nmbrs command is found."
}

main "$@"
