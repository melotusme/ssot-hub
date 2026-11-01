#!/bin/sh
# Optional runner for machines with a broken global Cargo source replacement.
set -eu
ssot_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ssot_cache="${TMPDIR:-/tmp}/ssot-hub-cargo"
ssot_registry="${CARGO_HOME:-$HOME/.cargo}/registry"
mkdir -p "$ssot_cache"
if [ ! -e "$ssot_cache/registry" ] && [ -d "$ssot_registry" ]; then
  ln -s "$ssot_registry" "$ssot_cache/registry"
fi
export CARGO_HOME="$ssot_cache"
cd "${TMPDIR:-/tmp}"
exec cargo "$@" --manifest-path "$ssot_root/src-tauri/Cargo.toml"
