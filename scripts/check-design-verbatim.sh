#!/usr/bin/env bash
# CI guard: the served UI must be byte-identical to the Claude Design bundle.
set -e
cd "$(dirname "$0")/.."
cmp design/"WEWE ERP.dc.html" apps/web/index.html
cmp design/support.js apps/web/support.js
echo "OK: apps/web serves the design bundle VERBATIM."
