#!/usr/bin/env bash
# Builds dist/TripKit.apk with Debian/Ubuntu's Android tools — no Gradle or Android Studio needed.
#   sudo apt-get update && sudo apt-get install -y openjdk-17-jdk-headless aapt apksigner dalvik-exchange android-sdk-platform-23 zipalign
#
# Signing: the first build creates your own key in apk/signing/ (git-ignored). Keep that folder safe —
# Android only installs an update over an existing install if it is signed with the same key.
set -euo pipefail
cd "$(dirname "$0")"
SDK=/usr/lib/android-sdk/platforms/android-23/android.jar
[ -f "$SDK" ] || { echo "Missing $SDK — install android-sdk-platform-23 (see the top of this file)"; exit 1; }

rm -rf build assets && mkdir -p build/classes build/dex assets/www
cp -r ../app/. assets/www/

javac -nowarn -Xlint:-options -source 8 -target 8 -bootclasspath "$SDK" -d build/classes src/app/tripkit/*.java
dalvik-exchange --dex --min-sdk-version=23 --output=build/dex/classes.dex build/classes

aapt package -f -M AndroidManifest.xml -S res -A assets -I "$SDK" -F build/unsigned.apk
(cd build/dex && zip -q ../unsigned.apk classes.dex)
zipalign -f -p 4 build/unsigned.apk build/aligned.apk

mkdir -p signing
if [ ! -f signing/tripkit.keystore ]; then
  PASS=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)
  echo "KS_PASS=$PASS" > signing/keystore.env && chmod 600 signing/keystore.env
  keytool -genkeypair -keystore signing/tripkit.keystore -alias tripkit -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$PASS" -keypass "$PASS" -dname "CN=TripKit" >/dev/null 2>&1
  echo "Created a new signing key in apk/signing/ — back it up."
fi
# shellcheck disable=SC1091
. signing/keystore.env
mkdir -p ../dist
apksigner sign --ks signing/tripkit.keystore --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --min-sdk-version 23 --out ../dist/TripKit.apk build/aligned.apk
rm -f ../dist/TripKit.apk.idsig
apksigner verify --print-certs ../dist/TripKit.apk | head -2
ls -la ../dist/TripKit.apk
