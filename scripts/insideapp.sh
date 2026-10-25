#!/bin/sh
# Avvia InsideApp dal checkout locale con il Node della toolchain isolata.
# Non usa npx, npm install -g né il Node globale. INSIDEAPP_NODE può indicare
# un altro eseguibile Node compatibile con package.json#engines.
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(tr -d '[:space:]' <"$root/.nvmrc")"
case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) os="$(uname -s | tr '[:upper:]' '[:lower:]')" ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) arch="$(uname -m)" ;;
esac
node="${INSIDEAPP_NODE:-$HOME/.insideapp/toolchain/node-v$version-$os-$arch/bin/node}"

if [ ! -x "$node" ]; then
  printf 'InsideApp: Node %s non trovato in %s.\n' "$version" "$node" >&2
  printf 'Installa la toolchain isolata (vedi README.md) o imposta INSIDEAPP_NODE.\n' >&2
  exit 1
fi

exec "$node" "$root/scripts/rea.mjs" "$@"
