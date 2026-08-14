#!/usr/bin/env bash
# install.sh — one-command installation of the dsh-enhance toolkit into a
# DeepSeek Harness profile, reproducing the full production chain:
#
#   1. toolchain check (dsh / npm / pnpm / realpath / GNU sed — missing tools
#      FAIL LOUDLY, never skip)
#   2. npm pack both plugins into $DSH_HOME/enhance-pkgs (stable file: targets)
#   3. dsh plugin add into the target profile (the real pnpm install path)
#   4. idempotent mount of the two rows in the profile's cordis.patch.yml
#      (pure mount points — all configuration stays in the Web settings form)
#   5. create the `enhance` agent preset: a copy of the installation's own
#      shipped `standard` preset with the built-in web_search disabled
#      (deliberately NOT based on the cordis preset: two cordis-family presets
#      in one process collide on the host inspect provider)
#   6. set the new preset as the default for future sessions (settings.yaml)
#   7. optional --restart (web profile only) and --verify (npm test)
#
# Idempotent: safe to re-run on an already-installed machine — every step
# detects its own previous result and becomes a no-op (an installed profile
# short-circuits steps 2–3 entirely).
#
# Usage:
#   ./install.sh                     # install for the web profile
#   ./install.sh --profile headless  # another profile
#   ./install.sh --restart --verify  # full chain incl. restart + regression tests
#   DSH_HOME=/path ./install.sh      # custom harness home (fresh-machine test)
#
# Environment: Linux + GNU coreutils + bash. GNU sed is required for the
# preset edit (detected explicitly, with a clear error otherwise).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
PROFILE="web"
PRESET_ID="enhance"
PRESET_NAME="标准模式+dsh-enhance"
RESTART=0
VERIFY=0

usage() {
  cat <<'EOF'
Usage: ./install.sh [--profile NAME] [--preset-id ID] [--restart] [--verify]

  --profile NAME   target profile under $DSH_HOME/profiles (default: web)
  --preset-id ID   agent-preset directory id (default: enhance)
  --restart        restart `dsh web` afterwards (web profile only)
  --verify         run the regression suite (npm test) afterwards
EOF
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) [[ $# -ge 2 ]] || { echo "install.sh: --profile needs a value" >&2; usage 2; }; PROFILE="$2"; shift 2 ;;
    --preset-id) [[ $# -ge 2 ]] || { echo "install.sh: --preset-id needs a value" >&2; usage 2; }; PRESET_ID="$2"; shift 2 ;;
    --restart) RESTART=1; shift ;;
    --verify) VERIFY=1; shift ;;
    -h|--help) usage 0 ;;
    *) echo "install.sh: unknown argument: $1" >&2; usage 2 ;;
  esac
done

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PKG_DIR="$DSH_HOME/enhance-pkgs"

log() { echo "[dsh-enhance] $*"; }
die() { echo "[dsh-enhance] ERROR: $*" >&2; exit 1; }

# ── 1. toolchain — hard requirements, loud failure ──────────────────────────
for bin in dsh npm pnpm realpath; do
  command -v "$bin" >/dev/null 2>&1 || die "missing required tool: $bin (install it first; the install path needs all of them)"
done
sed --version >/dev/null 2>&1 || die "GNU sed is required (BSD/macOS sed breaks the preset edit silently — install coreutils first)"

# Resolve the shipped `standard` preset directory from the dsh installation
# itself, so the copied preset always matches the installed harness version.
DSH_BIN="$(command -v dsh)"
DSH_REAL="$(realpath "$DSH_BIN")"
SHIPPED_PRESET=""
DIR="$(dirname "$DSH_REAL")"
while [[ "$DIR" != "/" ]]; do
  CANDIDATE="$DIR/config/agent-presets/standard"
  if [[ -f "$CANDIDATE/agent.cordis.yml" && -f "$CANDIDATE/preset.yml" ]]; then
    SHIPPED_PRESET="$CANDIDATE"
    break
  fi
  DIR="$(dirname "$DIR")"
done
[[ -n "$SHIPPED_PRESET" ]] || die "cannot locate the shipped 'standard' preset next to the dsh installation ($DSH_REAL)"
log "toolchain OK (dsh: $DSH_REAL, shipped standard preset found)"

# ── 2 + 3. pack and install — short-circuited when already installed ────────
ALREADY_INSTALLED=0
if [[ -f "$PROFILE_DIR/package.json" ]] \
  && grep -q '"@vcxmug/dsh-vision"' "$PROFILE_DIR/package.json" \
  && grep -q '"@vcxmug/dsh-native-web"' "$PROFILE_DIR/package.json"; then
  ALREADY_INSTALLED=1
  log "both plugins already installed in profile '$PROFILE' — skipping pack+install (true no-op)"
else
  mkdir -p "$PKG_DIR" /tmp/dsh-enhance-pack
  PACK_TMP="$(mktemp -d /tmp/dsh-enhance-pack/XXXXXX)"
  trap 'rm -rf "$PACK_TMP"' EXIT
  for pkg in dsh-vision dsh-native-web; do
    ( cd "$REPO_ROOT/packages/$pkg" && npm pack --pack-destination "$PACK_TMP" >/dev/null )
  done
  TARBALLS=()
  for tgz in "$PACK_TMP"/*.tgz; do
    cp -f "$tgz" "$PKG_DIR/"
    TARBALLS+=("$PKG_DIR/$(basename "$tgz")")
  done
  [[ ${#TARBALLS[@]} -eq 2 ]] || die "expected exactly 2 tarballs, got ${#TARBALLS[@]}"
  log "packed ${#TARBALLS[@]} tarballs into $PKG_DIR"

  mkdir -p "$PROFILE_DIR"
  dsh plugin --profile "$PROFILE" add "${TARBALLS[@]}" \
    || die "dsh plugin add failed (see output above)"
  log "packages installed into profile '$PROFILE'"
fi

# ── 4. patch layer: idempotent insert of the two mount rows ─────────────────
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"
row_block() { # $1 = id, $2 = package name
  printf '    - id: %s\n      name: %s\n' "$1" "'$2'"
}
INSERT_BLOCK="- insert:
$(row_block vision @vcxmug/dsh-vision)$(row_block native-web @vcxmug/dsh-native-web)"

has_row() { grep -q "name: '@vcxmug/$1'" "$PATCH_FILE" 2>/dev/null; }

if [[ ! -f "$PATCH_FILE" ]]; then
  printf '%s\n' "$INSERT_BLOCK" > "$PATCH_FILE"
  log "created $PATCH_FILE with the two mount rows"
elif has_row dsh-vision && has_row dsh-native-web; then
  log "patch layer already mounts both rows — leaving it untouched"
else
  # Add only the MISSING rows: a half-mounted state (e.g. an interrupted
  # earlier run) must self-heal without duplicating the row that exists.
  MISSING_BLOCK="- insert:"
  has_row dsh-vision   || MISSING_BLOCK="$MISSING_BLOCK
$(row_block vision @vcxmug/dsh-vision)"
  has_row dsh-native-web || MISSING_BLOCK="$MISSING_BLOCK
$(row_block native-web @vcxmug/dsh-native-web)"
  if grep -q '^\[\]$' "$PATCH_FILE"; then
    # dsh's own template ("comments + []"): replace the empty-list line itself,
    # so the file stays ONE yaml document the loader reads.
    awk -v block="$MISSING_BLOCK" 'BEGIN{replaced=0} /^\[\]$/ && !replaced { print block; replaced=1; next } { print }' \
      "$PATCH_FILE" > "$PATCH_FILE.tmp" && mv "$PATCH_FILE.tmp" "$PATCH_FILE"
    log "replaced the empty template with the mount rows in $PATCH_FILE"
  else
    { printf '\n'; printf '%s\n' "$MISSING_BLOCK"; } >> "$PATCH_FILE"
    log "added the missing mount rows to $PATCH_FILE"
  fi
fi

# ── 5. the `enhance` agent preset: shipped-standard copy + web_search off ───
PRESET_DIR="$DSH_HOME/.agent-presets/$PRESET_ID"
PRESET_COMPLETE=0
if [[ -f "$PRESET_DIR/agent.cordis.yml" && -f "$PRESET_DIR/preset.yml" ]]; then
  PRESET_COMPLETE=1
fi
if [[ "$PRESET_COMPLETE" -eq 1 ]]; then
  log "preset '$PRESET_ID' already exists — leaving it untouched"
else
  # Half-created directories (interrupted earlier run) are rebuilt; an
  # intentional user edit is never overwritten because completeness is only
  # about the two files existing.
  rm -rf "$PRESET_DIR"
  mkdir -p "$PRESET_DIR"
  cp "$SHIPPED_PRESET/agent.cordis.yml" "$PRESET_DIR/agent.cordis.yml"
  # Disable the built-in web_search: the per-session tool-web row is the one
  # that counts (the host copy is disabled by the web-app bundle).
  sed -i '/- id: tool-web/,/searchTimeoutMs: 60000/ s/^    searchTimeoutMs: 60000/    search: false\n    searchTimeoutMs: 60000/' \
    "$PRESET_DIR/agent.cordis.yml"
  grep -q 'search: false' "$PRESET_DIR/agent.cordis.yml" \
    || die "could not apply the search:false edit to the copied standard preset — the shipped file changed; adapt install.sh"
  {
    printf 'name: %s\n' "$PRESET_NAME"
    printf 'description: %s\n' '标准模式全部能力 + dsh-enhance 原生联网与识图（由 profile 宿主补丁层挂载）；内置 web_search 已关闭，联网统一走自托管实例的 native_search / native_scrape。'
    printf 'order: 2\n'
  } > "$PRESET_DIR/preset.yml"
  log "created preset '$PRESET_ID' ($PRESET_NAME) — shipped-standard copy with built-in web_search disabled"
fi

# ── 6. default preset for future sessions ───────────────────────────────────
SETTINGS_FILE="$DSH_HOME/settings.yaml"
if grep -q "^agent-presets:" "$SETTINGS_FILE" 2>/dev/null; then
  if grep -A5 "^agent-presets:" "$SETTINGS_FILE" | grep -q "default: $PRESET_ID"; then
    log "settings.yaml already defaults to '$PRESET_ID' — leaving it untouched"
  else
    log "WARNING: settings.yaml has an agent-presets section with a DIFFERENT default — leaving the user's choice untouched (set default preset to '$PRESET_ID' in the Web UI if wanted)"
  fi
else
  mkdir -p "$(dirname "$SETTINGS_FILE")"
  NEED_NL=0
  if [[ -s "$SETTINGS_FILE" ]]; then
    LAST="$(tail -c1 "$SETTINGS_FILE")"
    [[ "$LAST" == $'\n' ]] || NEED_NL=1
  fi
  { [[ "$NEED_NL" -eq 1 ]] && printf '\n' || true; printf 'agent-presets:\n  default: %s\n' "$PRESET_ID"; } >> "$SETTINGS_FILE"
  log "set default preset to '$PRESET_ID' in $SETTINGS_FILE (applies to sessions created afterwards)"
fi

# ── 7. optional restart / verification ──────────────────────────────────────
if [[ "$RESTART" -eq 1 ]]; then
  [[ "$PROFILE" == "web" ]] || die "--restart only makes sense for the web profile"
  bash "$REPO_ROOT/bin/restart-web.sh" || die "restart failed (see /tmp/restart-web.log)"
fi
if [[ "$VERIFY" -eq 1 ]]; then
  ( cd "$REPO_ROOT" && npm test ) || die "regression suite failed"
fi

log "done. Tool configuration (vision endpoint / web instance) lives in the Web settings form: Settings → Plugins → dsh-vision / dsh-native-web."
