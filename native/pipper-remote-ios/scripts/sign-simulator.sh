#!/bin/sh
# Xcode ad-hoc signs every simulator build, which leaves the bundle with no
# Team ID. App Intents then cannot register the app's AppEntity types
# ("ProjectEntity is not a registered AppEntity identifier"), every entity
# parameter arrives nil, and the intent fails with LNContextErrorDomain 2004.
# The project disables Xcode's simulator signing and this phase signs with a
# development identity instead so linkd sees a Team ID. Device builds are
# untouched: they are always team-signed.
#
# The signature must carry no entitlements. The macOS host refuses to spawn a
# certificate-signed binary whose signature claims entitlements without a
# provisioning profile (launchd error 163 "Security policy issue", shown by
# Xcode as "No such process"), even just get-task-allow. The keychain
# entitlements the simulator needs are linked into the __TEXT,__entitlements
# section instead (LD_ENTITLEMENTS_SECTION -> App/Simulator.entitlements),
# which is where Xcode itself puts them for simulator builds.
#
# Xcode may still write Metadata.appintents after this phase (its ordering
# against the SSU/NLU step is not declarable), which leaves the resource seal
# stale. The simulator does not enforce seals, so Xcode's Run button works;
# scripts/run-simulator.sh re-runs this script after xcodebuild for a fully
# valid signature.
set -e
if [ "$PLATFORM_NAME" != "iphonesimulator" ]; then
  exit 0
fi

IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null \
  | grep -o '"Apple Development[^"]*"' | head -1 | tr -d '"')
if [ -z "$IDENTITY" ]; then
  echo "warning: no 'Apple Development' identity in the keychain; App Intents entity parameters will fail on the simulator. Sign in to Xcode > Settings > Accounts once to create one."
  codesign --force --deep --sign - --timestamp=none "$CODESIGNING_FOLDER_PATH"
  exit 0
fi
echo "Signing simulator build with: $IDENTITY"
codesign --force --deep --sign "$IDENTITY" --timestamp=none "$CODESIGNING_FOLDER_PATH"
