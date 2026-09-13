#!/bin/sh
# Build, install, and launch PipperRemote on an iOS simulator.
# Usage: scripts/run-simulator.sh [device-name-or-udid]   (default: iPhone 17 Pro)
set -e
cd "$(dirname "$0")/.."
DEVICE="${1:-iPhone 17 Pro}"
BUNDLE_ID=com.maker-or.omni.remote
OUT="$PWD/.build/sim"

UDID=$(xcrun simctl list devices available -j | python3 -c "
import json,sys
want=sys.argv[1]
for devs in json.load(sys.stdin)['devices'].values():
  for d in devs:
    if d['udid']==want or d['name']==want:
      print(d['udid']); sys.exit(0)
sys.exit(1)" "$DEVICE") || { echo "No available simulator named '$DEVICE'"; exit 1; }

xcrun simctl bootstatus "$UDID" -b >/dev/null
open -a Simulator

xcodebuild -project PipperRemote.xcodeproj -target PipperRemote -configuration Debug \
  -sdk iphonesimulator -arch arm64 CONFIGURATION_BUILD_DIR="$OUT" build \
  | grep -E "error|warning: no|Signing simulator|BUILD" || true

# Final re-sign after every build step so the seal covers Metadata.appintents
# (the in-project phase can run before Xcode finishes writing it).
PLATFORM_NAME=iphonesimulator CODESIGNING_FOLDER_PATH="$OUT/PipperRemote.app" scripts/sign-simulator.sh
codesign --verify --deep --strict "$OUT/PipperRemote.app"
codesign -dvv "$OUT/PipperRemote.app" 2>&1 | grep -E "TeamIdentifier" || true

xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl install "$UDID" "$OUT/PipperRemote.app"
xcrun simctl launch "$UDID" "$BUNDLE_ID"
