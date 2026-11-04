#!/bin/sh
# Start the Steel developer connector in the background (POSIX).
# Usage: scripts/start.sh [--home DIR] [--max-iterations N]
# Writes a pidfile under the connector home; stop with scripts/stop.sh.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
HOME_DIR="${STEEL_CONNECTOR_HOME:-$HOME/.steel-connector}"
EXTRA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --home) HOME_DIR="$2"; shift 2;;
    --max-iterations) EXTRA="$EXTRA --max-iterations $2"; shift 2;;
    *) echo "unknown arg $1" >&2; exit 1;;
  esac
done
PIDFILE="$HOME_DIR/connector.pid"
LOGFILE="$HOME_DIR/connector.log"
mkdir -p "$HOME_DIR"
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "already running (pid $(cat "$PIDFILE")); stop it first" >&2; exit 1
fi
STEEL_CONNECTOR_HOME="$HOME_DIR" nohup node "$ROOT/src/cli.js" run --home "$HOME_DIR" $EXTRA >>"$LOGFILE" 2>&1 &
echo $! > "$PIDFILE"
echo "started pid $(cat "$PIDFILE"); log $LOGFILE"
