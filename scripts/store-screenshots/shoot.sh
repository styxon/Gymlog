#!/usr/bin/env bash
# Raw App Store screenshots from the screenshots build, on fresh simulators.
#
#   scripts/store-screenshots/shoot.sh <Vinha.app> <out-dir>
#
# For each device: a new simulator, the status bar set to 9:41 and full
# battery, the app installed, and the Maestro flow run once per language and
# theme. Each run starts from clearState, so the seed writes the same reader
# every time (src/screenshots/screenshotSeed.ts).
#
# Writes <out-dir>/<device>/<language>-<theme>/NN-name.png at the simulator's
# own resolution. Override the matrix with DEVICES ("Name|folder,..."),
# LANGUAGES and THEMES. macOS only: xcrun, simctl and maestro on PATH.
set -euo pipefail

APP=${1:?usage: shoot.sh <Vinha.app> <out-dir>}
OUT=${2:?usage: shoot.sh <Vinha.app> <out-dir>}
FLOW="$(cd "$(dirname "$0")/../.." && pwd)/.maestro/store-screenshots/store.yaml"
DEVICES=${DEVICES:-"iPhone 17 Pro Max|iphone-6.9,iPhone 17|iphone-6.3"}
LANGUAGES=${LANGUAGES:-"fi en"}
THEMES=${THEMES:-"dark light"}
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)

# The newest iOS runtime installed.
RUNTIME=$(xcrun simctl list runtimes -j | python3 -c '
import json, sys
runtimes = [r for r in json.load(sys.stdin)["runtimes"] if r.get("platform") == "iOS" and r.get("isAvailable")]
runtimes.sort(key=lambda r: [int(p) for p in r["version"].split(".")])
print(runtimes[-1]["identifier"])')
echo "runtime: $RUNTIME"

boot() {
  xcrun simctl boot "$1" 2>/dev/null || true
  xcrun simctl bootstatus "$1" -b >/dev/null
}

status_bar() {
  xcrun simctl status_bar "$1" override \
    --time "9:41" --dataNetwork wifi --wifiMode active --wifiBars 3 \
    --cellularMode active --cellularBars 4 --operatorName "" \
    --batteryState charged --batteryLevel 100
}

failures=0
IFS=',' read -ra SPECS <<< "$DEVICES"
for spec in "${SPECS[@]}"; do
  name=${spec%%|*}
  folder=${spec##*|}
  udid=$(xcrun simctl create "shots $folder" "$name" "$RUNTIME")
  echo "== $name ($folder) $udid"
  for language in $LANGUAGES; do
    # The phone's own language too, for anything the app leaves to the system
    # (the clock's format, a system sheet). Read at boot, so boot again.
    boot "$udid"
    locale=$([ "$language" = fi ] && echo fi_FI || echo en_US)
    xcrun simctl spawn "$udid" defaults write "Apple Global Domain" AppleLanguages -array "$language"
    xcrun simctl spawn "$udid" defaults write "Apple Global Domain" AppleLocale -string "$locale"
    xcrun simctl shutdown "$udid"
    boot "$udid"
    status_bar "$udid"
    xcrun simctl install "$udid" "$APP"
    for theme in $THEMES; do
      dir="$OUT/$folder/$language-$theme"
      mkdir -p "$dir"
      echo "-- $folder $language $theme"
      if ! maestro --device "$udid" test \
        -e LANGUAGE="$language" -e THEME="$theme" -e OUT="$dir" \
        --test-output-dir "$OUT/maestro/$folder-$language-$theme" \
        "$FLOW"; then
        echo "::error::Maestro failed: $folder $language $theme"
        xcrun simctl io "$udid" screenshot "$dir/failure.png" || true
        failures=$((failures + 1))
      fi
    done
    xcrun simctl shutdown "$udid"
  done
  xcrun simctl delete "$udid"
done

echo "failed runs: $failures"
exit $((failures > 0 ? 1 : 0))
