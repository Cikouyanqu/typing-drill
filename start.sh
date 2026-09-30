#!/usr/bin/env sh
# ===========================================================================
#  typing-drill — local static server launcher (macOS / Linux)
#
#  Opening index.html directly works. But some browsers disable localStorage
#  on file:// URLs, which means practice records cannot be saved. Serving over
#  http://127.0.0.1 gives the page a normal origin, so records persist.
#
#  Press Ctrl+C to stop the server.
# ===========================================================================

set -e
cd "$(dirname "$0")"

PORT="${PORT:-8777}"
URL="http://127.0.0.1:${PORT}/"

if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "Python was not found on PATH."
  echo
  echo "You can still use the tool: open index.html in a browser."
  echo "The only difference is that practice records may not be saved."
  echo "(Settings - Data has Export/Import JSON as a manual backup.)"
  exit 1
fi

echo
echo "  typing-drill - local static server"
echo "  ---------------------------------"
echo "  Serving: ${URL}"
echo "  Files:   $(pwd)"
echo
echo "  Press Ctrl+C in this window to stop."
echo

# Open a browser without blocking the server. Fall back silently if the
# platform has no opener available.
if command -v xdg-open >/dev/null 2>&1; then
  (sleep 1; xdg-open "${URL}") >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then
  (sleep 1; open "${URL}") >/dev/null 2>&1 &
fi

exec "$PY" -m http.server "${PORT}" --bind 127.0.0.1
