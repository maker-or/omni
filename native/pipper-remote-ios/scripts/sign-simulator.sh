#!/bin/sh
# Xcode ad-hoc signs every simulator build, which leaves the bundle with no
# Team ID. App Intents then cannot register the app's AppEntity types
# ("ProjectEntity is not a registered AppEntity identifier"), every entity
# parameter arrives nil, and the intent fails with LNContextErrorDomain 2004.
# The project disables Xcode's simulator signing and this phase signs with a
# development identity instead so linkd sees a Team ID. Device builds are
# untouched: they are always team-signed.
#
# Re-signing by hand also drops the entitlements Xcode would have generated,
# and the Keychain refuses every write without an application-identifier /
# keychain-access-groups (SecItemAdd returns errSecMissingEntitlement, -34018).
# Regenerate those before signing.
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

BUNDLE_ID=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" \
  "$CODESIGNING_FOLDER_PATH/Info.plist" 2>/dev/null || echo "com.maker-or.omni.remote")

# Team prefix comes from the signing certificate so the keychain access group
# is valid; an ad-hoc build (no identity) falls back to a bare bundle id.
TEAM=$(security find-certificate -c "Apple Development" -p 2>/dev/null \
  | openssl x509 -noout -subject 2>/dev/null \
  | tr ',' '\n' | sed -n 's/^ *OU=//p' | head -1)
GROUP="${TEAM:+$TEAM.}$BUNDLE_ID"

ENTITLEMENTS=$(mktemp)
trap 'rm -f "$ENTITLEMENTS"' EXIT
cat > "$ENTITLEMENTS" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>application-identifier</key>
  <string>$GROUP</string>
  <key>keychain-access-groups</key>
  <array>
    <string>$GROUP</string>
  </array>
  <key>com.apple.developer.team-identifier</key>
  <string>$TEAM</string>
  <key>get-task-allow</key>
  <true/>
</dict>
</plist>
PLIST

IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null \
  | grep -o '"Apple Development[^"]*"' | head -1 | tr -d '"')
if [ -z "$IDENTITY" ]; then
  echo "warning: no 'Apple Development' identity in the keychain; App Intents entity parameters will fail on the simulator. Sign in to Xcode > Settings > Accounts once to create one."
  codesign --force --deep --sign - --timestamp=none --entitlements "$ENTITLEMENTS" "$CODESIGNING_FOLDER_PATH"
  exit 0
fi
echo "Signing simulator build with: $IDENTITY"
codesign --force --deep --sign "$IDENTITY" --timestamp=none --entitlements "$ENTITLEMENTS" "$CODESIGNING_FOLDER_PATH"
