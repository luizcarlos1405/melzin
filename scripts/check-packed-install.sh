#!/usr/bin/env bash
# Packs both packages with `bun pm pack` (which rewrites `workspace:` ranges), installs the tarballs
# into a fresh project and fails if any packed or installed manifest still contains "workspace:".
# Never publishes. Usage: scripts/check-packed-install.sh [temp-dir]
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="${1:-$(mktemp -d)}"
rm -rf "$work"
mkdir -p "$work/pack" "$work/app/views"

for package in melzin cli; do
  (cd "$root/packages/$package" && bun pm pack --quiet --destination "$work/pack")
done

fail=0
for tarball in "$work"/pack/*.tgz; do
  if tar xzOf "$tarball" package/package.json | grep -q 'workspace:'; then
    echo "error: $(basename "$tarball") still has a workspace: range in its package.json" >&2
    fail=1
  fi
done
[ "$fail" = 0 ] || exit 1

cd "$work/app"
echo '{ "name": "packed-install", "private": true, "type": "module" }' > package.json
bun add "$work"/pack/melzin-[0-9]*.tgz "$work"/pack/melzin-cli-[0-9]*.tgz
cp "$root/examples/poll/views/poll.mel.html" views/

for manifest in node_modules/melzin/package.json node_modules/@melzin/cli/package.json; do
  if grep -q 'workspace:' "$manifest"; then
    echo "error: installed $manifest contains workspace:" >&2
    fail=1
  fi
done
[ "$fail" = 0 ] || exit 1

bunx melzin check
echo "packed install ok"
