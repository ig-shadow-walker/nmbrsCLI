#!/bin/sh
# Installs the built binary and the Claude skill for this user only. Nothing is uploaded anywhere.
#   bun run install:local
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
BIN_DIR="${NMBRS_BIN_DIR:-$HOME/.local/bin}"
SKILL_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"

[ -x "$ROOT/dist/nmbrs" ] || { echo "dist/nmbrs is missing; run 'bun run build' first" >&2; exit 1; }

mkdir -p "$BIN_DIR"
cp "$ROOT/dist/nmbrs" "$BIN_DIR/nmbrs"
chmod 755 "$BIN_DIR/nmbrs"
echo "binary:  $BIN_DIR/nmbrs"

mkdir -p "$SKILL_DIR"
if [ -e "$SKILL_DIR/nmbrs" ] && [ ! -L "$SKILL_DIR/nmbrs" ]; then
  echo "skill:   $SKILL_DIR/nmbrs exists and is not a link; leaving it alone" >&2
else
  ln -sfn "$ROOT/skill/nmbrs" "$SKILL_DIR/nmbrs"
  echo "skill:   $SKILL_DIR/nmbrs -> $ROOT/skill/nmbrs"
fi

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "note:    $BIN_DIR is not on your PATH" ;;
esac
echo "next:    nmbrs setup"
