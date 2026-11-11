# Security and privacy

TripKit is built to keep a trip, which is a list of where you'll be and when, on your own phone.

## What stays on the phone

- **Your trip** (places, journeys, flights, stays, bookings, spending, checklists) is in the app's WebView local storage. Nothing is synced or uploaded.
- **Your own photos** are in the app's IndexedDB, resized on the phone. They never leave it and aren't in backups.
- **Caches** (map tiles, Wikipedia photos, routes, station exits, directions) are in the app's private storage.
- **Backups** are a JSON file written only when you tap *Export backup*, to wherever you choose in the system save dialog. Treat the file like the trip itself: it holds anything you typed in, including booking references.

There are no accounts, analytics, ads, crash reporting or third-party SDKs.

## What goes online, and what it reveals

Requests are only made with signal, and everything is cached after the first time.

| Service | Sent | Notes |
|---|---|---|
| `tiles.openfreemap.org` | map tile coordinates for the areas you view or save | no key; reveals which areas you look at |
| `en.wikipedia.org`, `upload.wikimedia.org` | place names / Wikipedia titles | for photos, descriptions and local names |
| `overpass-api.de` | a station or line name and a bounding box | train-line shapes, station entrances |
| `routing.openstreetmap.de` (FOSSGIS OSRM) | start and end coordinates of walks and drives | rate-limited to 1 request/s, as the service asks |

- **Every request is anonymous.** It carries the User-Agent `TripKit/1.8 (Android; personal offline trip planner)`: no name, email or device ID. These operators can still see your IP address and the places you asked about, as with any map app.
- **Links you tap** (Navigate, photo credits) open outside the app. Navigate uses a `geo:` link, so your own maps app decides what happens next.

## Android app

- **Where the app files come from:** inside the APK, served from the fake secure origin `https://appassets.androidplatform.net/`. Nothing is loaded from a remote server at start-up.
- **WebView settings:** file access is off. JavaScript, DOM storage and content access (for the import file picker) are on.
- **The JavaScript bridge** (`window.Android`) offers only:
  - `isApp`, `exportJson` (opens the system save dialog);
  - `tileCount` / `clearTiles` (the map cache);
  - `shareText`, `openUrl`.

  It can't read files, contacts or anything else.
- **Network:** only GET requests to the four hosts above are passed through natively. Map tiles and photos are cached in the app's private `filesDir`.
- **Permissions:** `INTERNET` and location (`ACCESS_FINE/COARSE_LOCATION`). Location is used only for the ◎ "where am I" dot and never leaves the phone.
- **Android backup:** `android:allowBackup="true"`, so a system backup (Google, Seedvault on GrapheneOS) can include the app's storage. Set it to `false` in `apk/AndroidManifest.xml` if you don't want your trip in device backups.

## Signing keys

- `apk/build.sh` makes a **new random key per developer** in `apk/signing/` (key file plus `keystore.env` with its password). The folder is git-ignored, along with `*.keystore`, `*.jks` and `*.env`.
- **Never commit it.** Anyone with the key could sign an "update" that installs over your app and reads its data.
- The APK in `dist/` is signed with the repo owner's key. A build signed with a different key can't install over it. Either change the app id so both can be installed, or export a backup, uninstall, install yours and import.

## Personal data in this repo

The demo trip (`app/demo-trip.js`) is a real itinerary **with all bookings removed**: no flights, hotels, tickets, prices paid, booking references, phone numbers or names. Before each commit, the rules in [CLAUDE.md](../CLAUDE.md) say to grep for personal data.

## Reporting a problem

Open a private security advisory on GitHub (Security → Report a vulnerability) rather than a public issue.
