#!/usr/bin/env bash
# restart-web.sh — restart `dsh web` with a health check, fully automatic.
# Used by install.sh --restart and safe to run standalone:
#   bash bin/restart-web.sh     (logs: /tmp/restart-web.log and ~/.dsh/web.log)
#
# NOTE: restarting ends every session the current process carries — those
# conversations persist on disk and resume after reconnect. A SIGKILL fallback
# may drop not-yet-flushed session writes.
set -uo pipefail

PORT="${DSH_WEB_PORT:-3080}"
WEB_LOG="${DSH_HOME:-$HOME/.dsh}/web.log"
RUN_LOG=/tmp/restart-web.log

# Hard requirements — a missing piece must abort loudly, never fake a result.
[[ "$PORT" =~ ^[0-9]+$ ]] || { echo "[restart] invalid DSH_WEB_PORT: $PORT" >&2; exit 2; }
for bin in dsh curl setsid seq pkill tail; do
  command -v "$bin" >/dev/null 2>&1 || { echo "[restart] missing required tool: $bin" >&2; exit 2; }
done
DSH_BIN="$(command -v dsh)"
[[ -n "$DSH_BIN" ]] || { echo "[restart] dsh not found on PATH" >&2; exit 2; }

log() { echo "[restart $(date '+%F %T')] $*" | tee -a "$RUN_LOG"; }

# Match BOTH argv forms of the web app: `dsh web` and `dsh --profile web`.
# Anchored on the PATH-resolved launcher (the exact path the kernel records
# in the node shebang cmdline), so no unrelated process can match.
PATTERN="$DSH_BIN (web|--profile web)"

log "stopping the old dsh web (pattern: $DSH_BIN) ..."
pkill -f "$PATTERN" 2>/dev/null || true
for _ in $(seq 1 20); do
  curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null || break
  sleep 0.5
done
if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then
  log "old process still holds the port — SIGKILL (may drop unflushed session writes)"
  pkill -9 -f "$PATTERN" 2>/dev/null || true
  sleep 1
fi
if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then
  log "FAIL — port :$PORT is still held after SIGKILL; refusing to start on top of an unknown server"
  exit 1
fi

log "starting a fresh dsh web on :$PORT ..."
mkdir -p "$(dirname "$WEB_LOG")"
setsid nohup dsh web --port "$PORT" > "$WEB_LOG" 2>&1 < /dev/null &
NEW_PID=$!
log "new pid=$NEW_PID (setsid wrapper pid), waiting for health ..."
for _ in $(seq 1 90); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then
    log "OK — dsh web is serving on :$PORT"
    exit 0
  fi
  if ! kill -0 "$NEW_PID" 2>/dev/null; then
    log "FAIL — the new process exited early; tail of $WEB_LOG:"
    tail -40 "$WEB_LOG" | tee -a "$RUN_LOG"
    exit 1
  fi
  sleep 1
done
log "FAIL — still not serving after 90s; tail of $WEB_LOG:"
tail -40 "$WEB_LOG" | tee -a "$RUN_LOG"
exit 1
