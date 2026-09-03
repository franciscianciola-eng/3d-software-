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

# macOS ships a fake /usr/bin/python3 that only offers to install developer
# tools — treat python3 as real only if it actually is
have_python3() {
  command -v python3 >/dev/null 2>&1 || return 1
  if [ "$(uname)" = "Darwin" ] && [ "$(command -v python3)" = "/usr/bin/python3" ]; then
    xcode-select -p >/dev/null 2>&1 || return 1
  fi
  return 0
}

if have_python3; then
  exec python3 serve.py
elif command -v node >/dev/null 2>&1; then
  exec node serve.mjs
elif command -v python >/dev/null 2>&1; then
  exec python serve.py
else
  echo "  This app needs Python or Node.js (either one, both free)."
  if [ "$(uname)" = "Darwin" ]; then
    echo
    echo "  Easiest on a Mac: Apple can install it for you."
    echo "  An install window should pop up now - click Install, wait for it"
    echo "  to finish, then double-click 'Start Easy3D.command' again."
    xcode-select --install >/dev/null 2>&1
    echo
    echo "  (No window? Install Python from https://www.python.org instead.)"
  else
    echo "  Install from https://www.python.org or https://nodejs.org, then rerun."
  fi
  echo
  echo "  Press Enter to close."
  read -r _
  exit 1
fi
