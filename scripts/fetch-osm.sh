#!/usr/bin/env bash
# Download OpenStreetMap pharmacies + clinics for AB and BC as Overpass JSON tiles.
# Usage: scripts/fetch-osm.sh <out-dir>   then   npm run build:facilities -- <out-dir>
# Province membership is decided later from data/boundaries/ab_bc.geojson.
set -u
OUT=${1:-.osm-cache}; mkdir -p "$OUT"; cd "$OUT"
EP=${OVERPASS_URL:-https://maps.mail.ru/osm/tools/overpass/api/interpreter}
fetch() { s=$1; w=$2; n=$3; e=$4; f=t_${s}_${w}_${n}_${e}.json
  [ -s "$f" ] && grep -q '"elements"' "$f" && return
  Q="[out:json][timeout:100];(nwr[\"amenity\"~\"^(pharmacy|clinic|doctors)$\"]($s,$w,$n,$e);nwr[\"healthcare\"~\"^(pharmacy|clinic|doctor|centre)$\"]($s,$w,$n,$e););out center tags;"
  for i in 1 2 3 4; do
    code=$(curl -sS -m 130 -o "$f" -w "%{http_code}" --data-urlencode "data=$Q" "$EP")
    [ "$code" = 200 ] && grep -q '"elements"' "$f" && { echo "$f ok"; return; }
    sleep $((i*5))
  done; rm -f "$f"; echo "$f FAIL $code"; }
for s in 48 49 50 51 52 53; do for w in $(seq -126 1 -110); do fetch $s $w $((s+1)) $((w+1)); done; done
for s in 54 56 58; do for w in -134 -132 -130 -128 -126 -124 -122 -120 -118 -116 -114 -112; do fetch $s $w $((s+2)) $((w+2)); done; done
for s in 48 50 52; do for w in -134 -132 -130 -128; do fetch $s $w $((s+2)) $((w+2)); done; done
for s in 54 56 58; do fetch $s -140 $((s+2)) -134; done
