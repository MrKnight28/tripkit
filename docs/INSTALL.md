# Install guide

TripKit runs on **Android 6.0 or newer**. iPhone isn't supported: Apple doesn't allow installing an app file from outside the App Store.

## 1. Install the APK

1. **Get the file.** On your phone, open [`dist/TripKit.apk`](../dist/TripKit.apk) in this repo and tap **Download** ("Download raw file"). For a private repo, sign in to GitHub first. You can also download it on a computer and send it to your phone over USB, Signal or similar.
2. **Open it** from your notifications or your Files / Downloads app.
3. **Allow installs from that app** when Android asks:
   - **Pixel / stock Android:** Settings → Apps → *your browser or Files app* → Install unknown apps → Allow.
   - **GrapheneOS:** the same path. It works with Vanadium, the default browser.
   - **Samsung:** the prompt takes you to *Install unknown apps*. Switch on the browser or My Files.
4. Tap **Install**. If Play Protect warns about an unknown developer, choose **More details → Install anyway**. The app is signed with the repo owner's key, not a Play Store key.
5. When TripKit asks for **location**, allow it "while using the app" if you want the ◎ "where am I" button. Everything else works without it.

**Updating:** install a newer APK the same way and your trip is kept. An update only installs over the old one if both were signed with the same key (see *Build it yourself*).

## 2. Make it work offline (do this on Wi-Fi before you go)

1. Open **Trip → Settings → Save cities + my places**. This downloads, a few at a time:
   - the maps for every city in your trip, plus the area around every pin and station;
   - the place photos and descriptions;
   - the train lines, walking and driving routes, station exits and turn-by-turn directions.

   Leave the app open until the counter stops (a few minutes).
2. Open the **Guide** for each day once. This fills in anything the bulk download missed.
3. Switch on flight mode and check a day. The maps, photos and Guide should all still be there.

Map areas you scroll through later are saved automatically too. To save one area on purpose, use **⬇ Save area** on the Map tab.

## 3. Put your own trip in

A fresh install shows the demo trip. To use your own:

1. Write a trip file (see [TRIP-FORMAT.md](TRIP-FORMAT.md)). Easiest is to ask an AI assistant to fill in the template there.
2. Send the `.json` file to your phone.
3. **Trip → Settings → Import backup** and pick the file. Importing replaces what's on the phone.

From then on, edit inside the app: **+ Place** and **+ Train** on Today, or the ✎ buttons in Trip.

## 4. Two phones

TripKit has no cloud sync, on purpose. Before you travel, **Export backup** on your main phone, send the file to the second phone (Signal, USB, Syncthing) and **Import backup** there. Do it again after big changes.

Your own photos (the ones you add with *Use my photo*) stay on the phone that took them. They aren't part of the backup.

## Build it yourself

On Debian or Ubuntu (WSL works too):

```bash
sudo apt-get update
sudo apt-get install -y openjdk-17-jdk-headless aapt apksigner dalvik-exchange android-sdk-platform-23 zipalign zip
bash apk/build.sh        # → dist/TripKit.apk
```

- **No Gradle or Android Studio needed:** the script copies `app/` into the APK, compiles the one Java file, then packs, aligns and signs.
- **The first build creates your own signing key** in `apk/signing/` (key and a random password), which is git-ignored. **Back that folder up.** Lose it and phones with your build need an uninstall (and a backup/import) before they'll take your next build.
- **Changing the app id:** edit `package=` in `apk/AndroidManifest.xml` and the `package` line in `MainActivity.java`, then move the Java file to the matching folder.

## Run it as a web app instead

`app/` is also a Progressive Web App. Serve the folder over **HTTPS** (a service worker needs it, except on `localhost`) from any static host, open it in the phone's browser, and choose **Add to Home screen / Install app**. It caches itself and the maps you view.

The APK is still the better option offline: it stores map tiles in its own storage, which Android doesn't clear, and it can open your maps app for navigation.

## Troubleshooting

- **The map is blank:** you're offline and that area wasn't saved. Go online once and scroll over it, or use *Save cities + my places*.
- **A train line is drawn straight:** OpenStreetMap had no match for that line's name. The line still works, it just isn't drawn along the track. See *Real routes* in [HANDOFF.md](HANDOFF.md).
- **"Loading turn-by-turn directions…" never finishes:** the directions service was unreachable. The walk still shows its distance and a dotted line; open the step again once you have signal.
- **Wrong exit suggested:** at big stations with several operators, the nearest exit can belong to another line. Open the journey (✎) and fill in *Exit to go in at* / *Exit to leave by*.
