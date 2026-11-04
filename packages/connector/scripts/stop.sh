#!/bin/sh
# Stop the Steel developer connector started by start.sh.
# Preserves config/credentials/data; removes only the pidfile.
set -eu
HOME_DIR="${STEEL_CONNECTOR_HOME:-$HOME/.steel-connector}"
if [ "${1:-}" = "--home" ]; then HOME_DIR="${2:-$HOME_DIR}"; fi
PIDFILE="$HOME_DIR/connector.pid"
if [ ! -f "$PIDFILE" ]; then echo 'not running (no pidfile)'; exit 0; fi
PIDVAL=$(cat "$PIDFILE")
if kill -0 "$PIDVAL" 2>/dev/null; then kill "$PIDVAL"; echo "stopped pid $PIDVAL"; else echo "pid $PIDVAL already gone"; fi
rm -f "$PIDFILE"
