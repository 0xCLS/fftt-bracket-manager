#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required; no source or login requests have been made."
  read -r -p "Press Return to close: " _
  exit 1
fi
python3 C7_Readonly_Local_Server.py
status=$?
read -r -p "Press Return to close: " _
exit "$status"
