#!/usr/bin/env bash
# Usage: scaffold.sh <packages|apps> <name> [lib|node-app|web-app]
set -euo pipefail

KIND="${1:?kind (packages|apps) required}"
NAME="${2:?name required}"
FLAVOR="${3:-lib}"

case "$KIND" in packages|apps) ;; *) echo "kind must be packages or apps" >&2; exit 1 ;; esac
case "$FLAVOR" in lib|node-app|web-app) ;; *) echo "flavor must be lib|node-app|web-app" >&2; exit 1 ;; esac
[[ "$NAME" =~ ^[a-z][a-z0-9-]*$ ]] || { echo "name must be kebab-case" >&2; exit 1; }

ROOT="$(git rev-parse --show-toplevel)"
REF="$ROOT/.claude/skills/scaffold-package/references"
DEST="$ROOT/$KIND/$NAME"
[[ -e "$DEST" ]] && { echo "$DEST already exists" >&2; exit 1; }

PASCAL="$(echo "$NAME" | awk -F- '{for(i=1;i<=NF;i++){$i=toupper(substr($i,1,1)) substr($i,2)}}1' OFS='')"

render() { sed -e "s/__NAME__/$NAME/g" -e "s/__PASCAL__/$PASCAL/g" -e "s/__KIND__/$KIND/g" "$1" > "$2"; }

mkdir -p "$DEST/src"
render "$REF/package.json.tmpl"     "$DEST/package.json"
render "$REF/tsconfig.json.tmpl"    "$DEST/tsconfig.json"
render "$REF/vitest.config.ts.tmpl" "$DEST/vitest.config.ts"
render "$REF/index.test.ts.tmpl"    "$DEST/src/index.test.ts"
render "$REF/CLAUDE.md.tmpl"        "$DEST/CLAUDE.md"
render "$REF/README.md.tmpl"        "$DEST/README.md"
echo "export {};" > "$DEST/src/index.ts"

if [[ "$FLAVOR" != "lib" ]]; then
	# Runnable apps: add start/dev scripts and a bin entry for the CLI.
	node -e '
		const fs = require("fs"); const p = process.argv[1]; const name = process.argv[2];
		const j = JSON.parse(fs.readFileSync(p, "utf8"));
		j.scripts.start = "node dist/index.js";
		j.scripts.dev = "tsx watch src/index.ts";
		if (name === "cli") j.bin = { idp: "./dist/index.js" };
		fs.writeFileSync(p, JSON.stringify(j, null, "\t") + "\n");
	' "$DEST/package.json" "$NAME"
fi

echo "Scaffolded @idp/$NAME at $KIND/$NAME ($FLAVOR):"
find "$DEST" -type f | sed "s|$ROOT/||" | sort
