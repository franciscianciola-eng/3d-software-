#!/bin/sh
# Easy3D Studio launcher for Mac / Linux — run with:  sh start.sh
cd "$(dirname "$0")" || exit 1
URL="http://localhost:8080"

echo
echo "  Easy3D Studio → $URL   (Ctrl+C here to stop)"
echo

# open the browser once the server is up
(
  sleep 1
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  fi
) &

if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server 8080
elif command -v node >/dev/null 2>&1; then
  exec node serve.mjs
elif command -v python >/dev/null 2>&1; then
  exec python -m http.server 8080
else
  echo "  This app needs Python or Node.js (either one)."
  echo "  Install from https://www.python.org or https://nodejs.org and rerun."
  exit 1
fi
