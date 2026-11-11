# CLAUDE.md: TripKit

Offline trip planner for Android: a plain-JS web app in an APK shell. Start with `docs/HANDOFF.md` (state, architecture, next steps), then `docs/TRIP-FORMAT.md` (data) and `CHANGELOG.md`.

## Layout
- `app/`: the whole app. No framework and no build step.
  - `app.js`: all logic (rendering, Guide, maps, routes, exits, themes, splash).
  - `demo-trip.js`: the demo trip (`window.DEMO_TRIP`).
  - `styles.css`, `themes.css`, `index.html`, `sw.js` (PWA mode only), `vendor/` (MapLibre 4.7.1).
- `apk/`: Android shell.
  - `src/app/tripkit/MainActivity.java`: WebView, asset origin, tile/photo caches, the JS bridge.
  - `build.sh`: no Gradle.
  - `signing/`: git-ignored, created on first build.
- `dist/TripKit.apk`: the current build.
- `tests/test_app.py` + `tests/mocks.py`: Playwright browser checks with every external service faked.

## Rules
- **Run `python tests/test_app.py` before every commit**, and add a check with every change. Refresh screenshots with `--shots` when the UI changes.
- **No personal data in the repo, ever.** The demo trip has no flights, hotels, booking refs, prices paid, names, emails or phone numbers. Before committing, grep for anything that looks like a booking reference, phone number, email or a real hotel/airline, and look at the screenshots.
- **Never commit signing keys** (`apk/signing/`, `*.keystore`, `*.jks`, `*.env`). Keep the same key for every release, or updates won't install.
- **Data changes must not lose user data.** `migrate()` runs on every start and on import. It may add or fill in fields, never drop or overwrite what's there. Bump `v` when a real migration step is needed.
- **Java:** `android-23` jar, Java 8, **no lambdas** (dx can't handle them).
- **Network etiquette:**
  - OSRM (FOSSGIS) at most 1 request/s.
  - Cache every Overpass/OSRM/Wikipedia result in IndexedDB.
  - Never retry failures in a loop. This caused the v1.16 map-shaking bug.
  - The User-Agent stays generic (no personal identifiers).
  - Never use tile.openstreetmap.org.
- **Guide map:** build `gmap` once per step and update it in place. Don't re-render the step for new data (see v1.16 in the changelog).
- **Version bump** on every release: `versionCode` and `versionName` in `apk/AndroidManifest.xml`, plus a `CHANGELOG.md` entry.
- **Commits:** clear messages, push to `main`.
