#!/bin/sh
# Installa Ghidra per InsideApp in ~/.insideapp, senza privilegi né modifiche
# globali: scarica la release ufficiale (Apache-2.0) dal repository della NSA,
# ne verifica l'impronta SHA-256, la estrae in ~/.insideapp/tools e, su macOS,
# compila il decompilatore nativo dai sorgenti inclusi con il compilatore di
# Xcode. Non installa Java: usa un JDK 21 o successivo già presente.
# La configurazione scelta va in ~/.insideapp/ghidra.env, letto dal launcher.
set -eu

version=12.1.4
archive=ghidra_12.1.4_PUBLIC_20260921.zip
sha256=ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db
url="https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_${version}_build/$archive"

base="${INSIDEAPP_HOME:-$HOME/.insideapp}"
download="$base/download/ghidra"
tools="$base/tools"
ghidra="$tools/ghidra_${version}_PUBLIC"

fail() {
  printf 'InsideApp: %s\n' "$1" >&2
  exit 1
}

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) platform=mac_arm_64 build=1 arch="-arch arm64" ;;
  Darwin-x86_64) platform=mac_x86_64 build=1 arch="-arch x86_64" ;;
  Linux-x86_64) platform=linux_x86_64 build=0 arch="" ;;
  *) fail "sistema non previsto da questo script: $(uname -s) $(uname -m). Vedi docs/installation.md#ghidra." ;;
esac

# 1. Archivio ufficiale con impronta verificata.
mkdir -p "$download" "$tools"
if [ ! -d "$ghidra" ]; then
  if [ ! -f "$download/$archive" ]; then
    printf 'InsideApp: download di Ghidra %s (circa 570 MB)…\n' "$version"
    curl -fL --proto '=https' --tlsv1.2 -o "$download/$archive.part" "$url"
    mv "$download/$archive.part" "$download/$archive"
  fi
  if ! printf '%s  %s\n' "$sha256" "$download/$archive" | shasum -a 256 -c - >/dev/null; then
    rm -f "$download/$archive"
    fail "l'impronta SHA-256 di $archive non corrisponde: file rimosso, riprova."
  fi
  unzip -q "$download/$archive" -d "$tools"
fi
[ -x "$ghidra/support/analyzeHeadless" ] || fail "installazione di Ghidra incompleta in $ghidra"

# 2. Decompilatore nativo: le release recenti lo includono solo per Linux x86_64 e Windows.
decompiler="$ghidra/Ghidra/Features/Decompiler/os/$platform/decompile"
if [ "$build" = 1 ] && [ ! -x "$decompiler" ]; then
  command -v clang++ >/dev/null && command -v make >/dev/null ||
    fail "servono clang++ e make (Strumenti da riga di comando di Xcode: xcode-select --install)."
  work="$base/build/ghidra-decompiler"
  rm -rf "$work"
  mkdir -p "$work"
  cp -R "$ghidra/Ghidra/Features/Decompiler/src/decompile/cpp" "$ghidra/Ghidra/Features/Decompiler/src/decompile/zlib" "$work/"
  printf 'InsideApp: compilazione del decompilatore di Ghidra per %s…\n' "$platform"
  (cd "$work/cpp" && make -j4 ghidra_opt ARCH_TYPE="$arch" \
    ADDITIONAL_FLAGS="-mmacosx-version-min=11.0 -w" CXX="clang++ -std=c++11" >"$work/build.log" 2>&1) ||
    fail "compilazione non riuscita; dettagli in $work/build.log"
  mkdir -p "$(dirname "$decompiler")"
  cp "$work/cpp/ghidra_opt" "$decompiler"
fi
[ -x "$decompiler" ] || fail "decompilatore nativo assente: $decompiler"

# 3. JDK 21 o successivo già installato; nessuna installazione automatica.
java_major() {
  "$1/bin/java" -XshowSettings:properties -version 2>&1 |
    sed -n 's/^ *java\.specification\.version = \([0-9]*\).*/\1/p' | head -n 1
}
jdk=""
for candidate in "${JAVA_HOME:-}" \
  "$(/usr/libexec/java_home -v 21+ 2>/dev/null || true)" \
  /opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home \
  /usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home \
  /usr/lib/jvm/default-java; do
  [ -n "$candidate" ] && [ -x "$candidate/bin/java" ] && [ -x "$candidate/bin/javac" ] || continue
  major="$(java_major "$candidate")"
  [ -n "$major" ] && [ "$major" -ge 21 ] && { jdk="$candidate"; break; }
done
[ -n "$jdk" ] || fail "nessun JDK 21 o successivo trovato. Installane uno gratuito (ad esempio Eclipse Temurin) e riprova, oppure imposta JAVA_HOME."

# 4. Configurazione letta da scripts/insideapp.sh.
{
  printf 'GHIDRA_INSTALL_DIR=%s\n' "$ghidra"
  printf 'JAVA_HOME=%s\n' "$jdk"
} >"$base/ghidra.env"
printf 'InsideApp: Ghidra %s pronto (%s, JDK %s).\n' "$version" "$platform" "$(java_major "$jdk")"
printf 'InsideApp: configurazione in %s; verifica con ./scripts/insideapp.sh doctor\n' "$base/ghidra.env"
