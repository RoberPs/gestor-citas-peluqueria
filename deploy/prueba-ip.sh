#!/usr/bin/env bash
# Whether the app sees each visitor's real IP behind Cloudflare and Caddy
# (deploy/README.md, «Prueba de la IP»). Run ON THE PC, in Git Bash:
#
#   bash deploy/prueba-ip.sh https://niza.automatizacionro.work
#
# The booking limit (5 per hour per IP, FR-039) is counted before the body is
# read, so empty POSTs spend it without booking anything: five answer 400 and
# the sixth 429. Every request forges a different X-Forwarded-For; if the app
# believed it, the sixth would not be 429. Then the same POST from another
# network (the PC tethered to a phone on mobile data) must answer 400: a
# different IP has its own counter.
#
# It leaves this PC's IP without online bookings for an hour. Restarting the
# app empties the counters: sudo docker compose -f … restart app
set -euo pipefail

url=${1:?usage: bash deploy/prueba-ip.sh https://<domain>}
url=${url%/}

for i in 1 2 3 4 5 6; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$url/api/appointments" \
    -H 'Content-Type: application/json' -H "X-Forwarded-For: 203.0.113.$i" --data '{}')
  expected=400
  [[ $i -eq 6 ]] && expected=429
  if [[ "$code" == "$expected" ]]; then
    echo "  ok    request $i: $code"
  else
    echo "  MAL   request $i: $code, expected $expected"
    exit 1
  fi
done

echo
echo 'The forged X-Forwarded-For was ignored and this IP has its own counter.'
echo 'Now connect this PC to a phone hotspot on mobile data and, within the hour, run:'
echo "  curl -s -o /dev/null -w '%{http_code}\\n' -X POST $url/api/appointments -H 'Content-Type: application/json' --data '{}'"
echo 'It must print 400. A 429 means every visitor shares one counter.'
