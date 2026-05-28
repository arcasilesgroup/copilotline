#!/usr/bin/env bash
#
# copilotline installer: downloads the right Bun-compiled binary for this host
# from the latest GitHub release, verifies the SHA256 sidecar, installs it on
# PATH, and runs `copilotline install` unless opted out.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/arcasilesgroup/copilotline/main/scripts/install.sh | bash
#
# Env vars:
#   COPILOTLINE_VERSION   pin to a tag, for example "v0.1.0"; default = latest
#   COPILOTLINE_PREFIX    install prefix, default $HOME/.local/bin
#   COPILOTLINE_NO_WIRE   set to "1" to skip `copilotline install`

set -euo pipefail

REPO="arcasilesgroup/copilotline"
PREFIX="${COPILOTLINE_PREFIX:-$HOME/.local/bin}"
TAG="${COPILOTLINE_VERSION:-}"

err() {
  echo "copilotline-install: error: $*" >&2
}

info() {
  echo "copilotline-install: $*"
}

require() {
  command -v "$1" >/dev/null 2>&1 || {
    err "missing required command: $1"
    exit 1
  }
}

require curl
require uname
require mktemp

SHA_CMD=""
if command -v sha256sum >/dev/null 2>&1; then
  SHA_CMD="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  SHA_CMD="shasum -a 256"
else
  err "need sha256sum or shasum to verify the download"
  exit 1
fi

detect_target() {
  local os arch
  os=$(uname -s | tr '[:upper:]' '[:lower:]')
  arch=$(uname -m)

  case "$os" in
    darwin)
      case "$arch" in
        arm64|aarch64) echo "copilotline-darwin-arm64" ;;
        x86_64) echo "copilotline-darwin-x64" ;;
        *) echo "" ;;
      esac
      ;;
    linux)
      case "$arch" in
        x86_64) echo "copilotline-linux-x64" ;;
        aarch64|arm64) echo "copilotline-linux-arm64" ;;
        *) echo "" ;;
      esac
      ;;
    *)
      echo ""
      ;;
  esac
}

ASSET="$(detect_target)"
if [ -z "$ASSET" ]; then
  err "unsupported platform: $(uname -s) $(uname -m). Use npm or the Windows release asset."
  exit 2
fi

if [ -z "$TAG" ]; then
  TAG=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | grep -m 1 '"tag_name"' \
    | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')
  if [ -z "$TAG" ]; then
    err "could not resolve latest tag from GitHub API"
    exit 1
  fi
fi

info "installing copilotline $TAG ($ASSET) to $PREFIX"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

BIN_URL="https://github.com/$REPO/releases/download/$TAG/$ASSET"
SHA_URL="$BIN_URL.sha256"

curl -fsSL --retry 3 --retry-delay 1 -o "$TMP/$ASSET" "$BIN_URL"
curl -fsSL --retry 3 --retry-delay 1 -o "$TMP/$ASSET.sha256" "$SHA_URL"

( cd "$TMP" && $SHA_CMD --check --status "$ASSET.sha256" )
info "checksum OK"

mkdir -p "$PREFIX"
install -m 0755 "$TMP/$ASSET" "$PREFIX/copilotline"

if ! command -v copilotline >/dev/null 2>&1 \
   || [ "$(command -v copilotline)" != "$PREFIX/copilotline" ]; then
  info "installed to $PREFIX/copilotline"
  info "add this to your shell rc to put it on PATH:"
  echo "  export PATH=\"$PREFIX:\$PATH\""
else
  info "installed to $PREFIX/copilotline (already on PATH)"
fi

if [ "${COPILOTLINE_NO_WIRE:-0}" = "1" ]; then
  info "skipped \`copilotline install\` per COPILOTLINE_NO_WIRE=1"
else
  info "wiring copilotline as the GitHub Copilot CLI statusLine"
  if ! "$PREFIX/copilotline" install; then
    err "\`copilotline install\` failed; you can re-run it manually"
  fi
fi

info "done. Try \`copilotline doctor\` to verify the install."
