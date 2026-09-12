#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")"
test -s .local/cxx-runtime-path
export LD_LIBRARY_PATH="$(cat .local/cxx-runtime-path)/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
if [ "${REPLIT_DEPLOYMENT:-0}" = "1" ]; then
  exec .local/venv/bin/python start_production.py
fi
test -x .local/venv/bin/python
exec .local/venv/bin/python start.py
