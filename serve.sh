#!/bin/sh
cd "$(dirname "$0")/frontend"
exec /usr/bin/python3 -m http.server "${PORT:-5173}"
