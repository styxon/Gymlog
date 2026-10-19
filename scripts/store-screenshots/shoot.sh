#!/usr/bin/env bash
# Raw App Store screenshots from the screenshots build, on fresh simulators.
#
#   scripts/store-screenshots/shoot.sh <Vinha.app> <out-dir>
#
# For each device: a new simulator, the status bar set to 9:41 and full
# battery, and per language and theme a fresh install, a launch with
# -vinhaLanguage/-vinhaTheme, and the Maestro flow. A fresh install is a first
# launch, so the seed writes the same reader every time
# (src/screenshots/screenshotSeed.ts).
#
# Writes <out-dir>/<device>/<language>-<theme>/NN-name.png at the simulator's
# own resolution, with Maestro's logs beside them (maestro-<attempt>/).
# Override the matrix with DEVICES ("Name|folder,..."), LANGUAGES and THEMES. macOS only: xcrun, simctl and maestro on PATH.
#
# FLOW=ui-check walks every list and menu screen instead of taking the store
# shots (.maestro/ui-check/, docs/store-screenshots.md). Its shots land in
# <device>/<language>-<theme>[-<content size>]/. CONTENT_SIZE (default
# "default", the phone's own) sets the simulator's text size for the run
# (xcrun simctl ui <udid> content_size). A device named "small" is the
# smallest iPhone the runner's Xcode can create (iPhone SE 3rd generation,
# else iPhone 16e).
set -euo pipefail

APP=${1:?usage: shoot.sh <Vinha.app> <out-dir>}
OUT=${2:?usage: shoot.sh <Vinha.app> <out-dir>}
FLOW=${FLOW:-store}
case "$FLOW" in
  store) FLOW_DIR=store-screenshots; MAIN=store.yaml ;;
  ui-check) FLOW_DIR=ui-check; MAIN=ui-check.yaml ;;
  *) echo "::error::unknown FLOW: $FLOW"; exit 2 ;;
esac
FLOWS="$(cd "$(dirname "$0")/../.." && pwd)/.maestro/$FLOW_DIR"
CONTENT_SIZE=${CONTENT_SIZE:-default}
case "$CONTENT_SIZE" in
  *[!a-z-]*) echo "::error::bad CONTENT_SIZE: $CONTENT_SIZE"; exit 2 ;;
esac
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
    --batteryState discharging --batteryLevel 100
}

failures=0
IFS=',' read -ra SPECS <<< "$DEVICES"
for spec in "${SPECS[@]}"; do
  name=${spec%%|*}
  folder=${spec##*|}
  if [ "$name" = small ]; then
    udid=""
    for candidate in "iPhone SE (3rd generation)" "iPhone 16e"; do
      if udid=$(xcrun simctl create "shots $folder" "$candidate" "$RUNTIME" 2>/dev/null); then
        name=$candidate
        break
      fi
      udid=""
    done
    if [ -z "$udid" ]; then
      echo "::error::no small iPhone could be created on $RUNTIME"
      xcrun simctl list devicetypes | grep -i iphone || true
      failures=$((failures + 1))
      continue
    fi
  else
    udid=$(xcrun simctl create "shots $folder" "$name" "$RUNTIME")
  fi
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
    # The phone's text size. "default" leaves it alone.
    if [ "$CONTENT_SIZE" != default ]; then
      xcrun simctl ui "$udid" content_size "$CONTENT_SIZE"
    fi
    for theme in $THEMES; do
      dir="$OUT/$folder/$language-$theme"
      if [ "$FLOW" = ui-check ] && [ "$CONTENT_SIZE" != default ]; then
        dir="$dir-$CONTENT_SIZE"
      fi
      mkdir -p "$dir"
      echo "-- $folder $language $theme"
      # A fresh install every run: the seed only writes on a first launch.
      xcrun simctl uninstall "$udid" app.vinha 2>/dev/null || true
      xcrun simctl install "$udid" "$APP"
      cp "$FLOWS"/*.yaml "$dir/"
      check=$([ "$language" = fi ] && echo Koti || echo Home)
      sed -i '' "s/@LANGUAGE_CHECK@/$check/" "$dir/$MAIN"
      # The coach answer starts under the see-through header on the 6.3"
      # phone only; there the flow drags the thread down a little.
      nudge=$([ "$folder" = iphone-6.3 ] && echo true || echo false)
      sed -i '' "s/@CHAT_NUDGE@/$nudge/" "$dir/$MAIN"
      ok=0
      # Twice: the first Maestro run on a fresh boot builds its driver, and
      # on the runner that has outlasted any timeout (2026-10-18).
      for attempt in 1 2; do
        xcrun simctl terminate "$udid" app.vinha 2>/dev/null || true
        if [ "$attempt" = 2 ]; then
          xcrun simctl uninstall "$udid" app.vinha 2>/dev/null || true
          xcrun simctl install "$udid" "$APP"
        fi
        xcrun simctl launch "$udid" app.vinha -vinhaLanguage "$language" -vinhaTheme "$theme" >/dev/null
        if (cd "$dir" && maestro --device "$udid" test --test-output-dir "$dir/maestro-$attempt" "$MAIN"); then
          # takeScreenshot writes under the test output, not beside the flow.
          find "$dir/maestro-$attempt" -path '*/takeScreenshot/*.png' -exec cp {} "$dir/" \;
          ok=1
          break
        fi
        echo "attempt $attempt failed: $folder $language $theme"
      done
      if [ "$ok" = 0 ]; then
        echo "::error::Maestro failed: $folder $language $theme"
        # What the attempts did get is still worth having (the second wins).
        find "$dir/maestro-1" "$dir/maestro-2" -path '*/takeScreenshot/*.png' -exec cp {} "$dir/" \; 2>/dev/null || true
        xcrun simctl io "$udid" screenshot "$dir/failure.png" || true
        failures=$((failures + 1))
      fi
      rm -f "$dir"/*.yaml
    done
    xcrun simctl shutdown "$udid"
  done
  xcrun simctl delete "$udid"
done

echo "failed runs: $failures"
exit $((failures > 0 ? 1 : 0))
