# Handoff: TripKit

Where the project is and how it fits together, for the next person (or AI session) working on it. Start here, then [TRIP-FORMAT.md](TRIP-FORMAT.md) for the data and [CHANGELOG.md](../CHANGELOG.md) for history.

## Current state (v1.19)

- **Works:** four tabs (Today · Guide · Map · Trip), Guide with walk/ride/place steps and turn-by-turn walks, station exits, real routes, offline maps/photos/routes, budget, checklists, backup/import, country themes, start-up screen.
- **Demo data:** `app/demo-trip.js`. A fresh install starts with it; `migrate()` only fills in missing collections (the private build's migration history was dropped from the public code).
- **Tests:** `python tests/test_app.py` (14 checks, network faked). Run it before every commit.

## Next steps (ideas, not started)

1. **Trip wizard in the app:** paste an AI assistant's reply or a JSON file, review it, and import.
2. **Start-up route graphic from the trip's cities** instead of the fixed LDN → HKT → BKK → TYO arc in `index.html`.
3. **More countries for the themes** (`themes.css` and `COUNTRY_OF` in `app.js`): Korea, Vietnam, Italy…
4. **Japan rail tab generalised** to other rail passes, or hidden when the trip has no Japan days.
5. **Pick a licence** for TripKit's own code before going public.

## Not verified on real services

The development sandbox couldn't reach OpenFreeMap, Wikipedia, Overpass or OSRM, so these were built against mocks with the real APIs' shapes:

1. OpenFreeMap rendering and the offline save.
2. Wikipedia photo picks. Some automatic picks may be poor; set `wiki` to a better article.
3. Real train-line shapes. If a line is drawn straight, its `RAIL_NAMES` pattern didn't match the OpenStreetMap relation name; check on overpass-turbo.eu.
4. OSRM turn-by-turn wording on real streets.
5. All-stations labels from the vector tiles' `poi` layer.

## Architecture

### The web app (`app/app.js`)
- **No framework:** plain JS that renders strings into `<main>`. Since v1.14 there are **4 tabs**:
  - **Today:** budget left + ▶ Guide button, day chips, one compact row per item. Tapping a place opens its Guide step; tapping a train, flight or stay opens its edit form.
  - **Guide:** the day as steps (§7 "Guide").
  - **Map:** unchanged.
  - **Trip:** a section index (Flights, Stays, Trains & passes, Tickets, Budget, Checklists, All places, ideas, Settings & backup). Each section reuses the old `views.plan()` with `_noPlanChips`, or `views.lists()` / `views.more()`.
  - View state: `views._gDay`, `views._gStep` (null = list) and `views._tripSec`. The Android back button pops step → list, section → Trip index, then any tab → Today.
- **State:** `S`, saved to `localStorage['tripkit.v1']` on every change.
- **Mode switch:** `const APP = !!window.Android` toggles APK behaviour (native bridge, native caching) and web/PWA behaviour (service worker).

### The APK shell (`MainActivity.java`)
- **App files:** served from inside the APK at the fake secure origin `https://appassets.androidplatform.net/` (via `shouldInterceptRequest`), so `localStorage` and IndexedDB persist.
- **Native caches in `filesDir`:**
  - `ofm/`: OpenFreeMap tiles, fonts and sprites, cache-first. The style JSON and tile index are network-first with a cache fallback. Tile keys drop OpenFreeMap's weekly-dated folder, so saved areas survive their data updates.
  - `photos/`: Wikimedia images, cache-first.
- **Pass-through with the app's own User-Agent** (`TripKit/1.8 (Android; personal offline trip planner)`, no personal identifiers) and a 95 s timeout for `overpass-api.de` and `routing.openstreetmap.de` (GET only). The web layer caches their results.
- **Startup:** deletes the v1.0 `filesDir/tiles/` folder (the blocked OSM images).
- **JS bridge `window.Android`:** `isApp`, `exportJson` (system save dialog), `tileCount`, `clearTiles`, `shareText`, `openUrl`.
- **Links:** `geo:` opens the phone's maps app, falling back to openstreetmap.org. Other links open externally.
- **System features:** location permission is requested at startup; the file picker handles imports. Back button: close dialog → back to Today → exit (`window.tkBack`).

### Building (Debian/Ubuntu)
```bash
sudo apt-get update && sudo apt-get install -y openjdk-17-jdk-headless aapt apksigner dalvik-exchange android-sdk-platform-23 zipalign zip
bash apk/build.sh   # copies app/ → assets/www, javac → dx → aapt → zipalign → apksigner → dist/TripKit.apk
```
- **Compile target:** the `android-23` jar, with Java 8 source and target and **no lambdas** (dx can't handle them). This is why `shouldOverrideUrlLoading` uses the old `(WebView, String)` signature.
- **Keystore:** created by the first build in `apk/signing/` (git-ignored, random password in `keystore.env`). Keep using the same key for every release, or updates won't install.
- **Size check:** the APK size sometimes doesn't change between builds (zip alignment). Confirm a build with `unzip -p dist/TripKit.apk assets/www/app.js | grep <something new>`.
- **Tests run offline:** `tests/mocks.py` fakes OpenFreeMap, Wikipedia, Overpass and OSRM, because the development sandbox couldn't reach them.

---

## Feature reference

### Maps (v1.1)
- **v1.0** used `tile.openstreetmap.org` and was **blocked by OSM**, whose tile policy forbids bulk or offline downloading.
- **v1.1 onwards:** MapLibre GL + **OpenFreeMap** vector tiles (style `liberty`; no key, no request limits).
- **"Save cities + my places"** downloads:
  - z0–14 for the cities in the `CITIES` list in `app.js` (Tokyo, Narita, Bangkok, Phuket — edit for other trips)
  - ±0.03° around every pin and station
  - Latin, punctuation and Thai glyphs, plus all photos and routes.

  That's about 1,100+ files, 4 at a time. CJK text renders with the phone's own fonts.
- **Filters:** All / Thailand / Tokyo / each day. **Lines and station badges only appear on a single-day view.**
- **Map tools:** long-press adds a place at that spot; ◎ shows your GPS position (works offline); "⬇ Save area" saves the current view.

### Trains (v1.2) and Japan rail (v1.4)
- **Journeys:** each has a line colour, station codes, which train to board, exits and fares.
- **Plan → Trains:** region chips (All / Japan rail / Thailand / UK; region is worked out from coordinates).
- **Japan rail tab:**
  - pay-as-you-go total in ¥ and £
  - line guide (official letter, operator, whether the pass covers it)
  - per-route ¥, £ and journey time
  - a **72h pass check:** the subway fares inside the pass window (`trip.japanPass`, or the first 3 full Tokyo days) on Suica against the ¥1,500 pass.
- **Fares:** official IC fares from the Tokyo Metro table (14 Mar 2026) and Toei. Fares that depend on the exact train are marked ≈.
- **Advice built into the demo checklists:**
  - **Welcome Suica:** buy at Narita T2. No deposit, valid 28 days, no refund. **Phone Suica won't work** on de-Googled Android or most non-Japanese phones.
  - **72h Tokyo Subway Ticket:** ¥1,500, Keisei counter at Narita, bring your passport. Covers all Metro and Toei lines but not the airport trains.
  - **Bangkok:** since June 2026 the MRT, Airport Rail Link and Red Line take contactless Visa/Mastercard only; the BTS uses a Rabbit card or single tickets.
  - **Haneda leg:** avoid the "Airport Rapid Ltd. Express" (エアポート快特), which skips some Asakusa Line stations.

### Photos (v1.5)
- **Automatic:** the Wikipedia pageimages API (`origin=*`, `Api-User-Agent` header) fills in photos for items with a `wiki` title (`autoPhotos()`, 6 at a time, after each render). Each photo has a credit link.
- **Edit form:** "Find photo online" (by `wiki` title, else a search on name + area), "Use my photo" (resized on the phone to 1100px JPEG and stored in IndexedDB) and "Remove".
- **`save()`** strips `_ownPhoto`, so photos can never reach localStorage (5 MB limit).

### Emoji pins (v1.6) and labels (v1.7)
- **Emoji:** `emojiFor()` uses the item's `emoji` field, otherwise the first `EMOJI_RULES` regex matching **name + wiki title** (notes excluded: "Start 10:30" matched "art"). Specific rules come first (Pokémon 🎮 before Skytree 🗼). Stays are always 🏨; the ring colour is the category.
- **Labels:** English name plus `local` name, shown only at **zoom ≥ 14**. Japan places get Japanese; **Thailand places get Thai rather than Japanese**, (more useful for drivers).
- **Where `local` comes from:** seeded in migration v6, or pulled from Wikipedia `langlinks` for new places.
- **Don't** give `.pinwrap` `position:relative`. It overrides MapLibre's absolute positioning and detaches the labels.

### Guide (v1.14)
- **`buildGuide(iso)`** turns `dayItems(iso)` into `steps`:
  - **Start:** the hotel you slept in (stay with `checkIn < iso <= checkOut`), or, on a travel day with no hotel, the first train's departure station (`kind: 'start'`).
  - **Middle:** places, unlinked bookings, flights and check-ins in time order.
  - **End:** tonight's hotel, if it isn't already the last step.
  - **Legs:** transit items between two steps attach to the later step as `legs`. Check-ins are moved after the last transit that ends within 1.5 km of the hotel, so the hotel never comes before the trains that take you there.
  - **No booked transport between two steps:** a `foot` job (or `car` if over 3 km) is added. No auto job is added after a flight or over 60 km.
- **Step screen:** `guideStep()` renders it, and `initGuideMap()` creates a second MapLibre instance (`gmap`) on `#gmap`.
  - It draws the step's jobs, using `ROUTES` or a straight line, then fetches any missing routes via `ensureRoutes`.
  - It adds a small pin for the previous step and a large labelled pin for the current one, plus the all-stations layer (`addStationLayerTo(m)`).
  - `render()` always removes `gmap` first.
- **Walking times:** route length ÷ 80 m/min, marked "(approx.)" until the real footpath route is cached. The list view fetches missing walk routes in the background and re-renders.
- **"About" text:** `WIKI_API` also requests `extracts` (intro, 3 sentences), stored as `about` (≤ 600 chars). `autoPhotos()` fills it in for items with `wiki`; when there's no extract it sets `noAbout`. Tested only with a mock Wikipedia.
- **Visited / "next up":** "Mark visited" toggles `place.done`. Earlier non-place steps count as done once a later place is done. "Next up" is the first step not done, shown only on today's date.


### Station exits & access walks (v1.15)
- **Exit data:** `ensureExits(pts)` queries Overpass (`node(around:450)["railway"~"subway_entrance|train_station_entrance"]`) once per station. It stores `[{ref, name, pt}]` in `ROUTES['ex|lat,lng']` (same IndexedDB store `r`). An empty array means "looked, none mapped"; failures aren't retried in the session.
- **Choosing an exit:** `pickExit(stationPt, wanted, towards)` uses the leg's `fromExit`/`toExit` when set (marked `fixed`), otherwise the entrance nearest the previous stop (going in) or the next stop / next leg (coming out).
- **Jobs:** `buildGuide` now adds walk jobs with `role` `to` (previous stop → entrance), `change` (exit of one leg → entrance of the next, with `outExit` and `nextLine`) and `from` (exit → stop). Rail jobs carry `exIn`/`exOut`.
- **Day map:** `dayRouteJobs(iso)` now just returns the Guide's jobs, so the day map also shows the access walks and exit badges (`.exb.map`).
- **Fetching:** `ensureDayExtras(iso, cb)` fetches the day's exits, then any new walk routes. "Save cities + my places" fetches exits for every station before the routes.
- **Walk / ride steps (v1.17).** End of `buildGuide()`: any step with legs plus a `role:'to'` or `role:'from'` walk job is split into `{kind:'walk', role:'to'}`, `{kind:'ride'}` (all legs + change walks), `{kind:'walk', role:'from', dest}` and then the original step with `legs:[], jobs:[], walked:true`. A `kind:'start'` step (a day that starts at a station) never gets a walk-to. Directions: `fetchRoad()` returns `{g, dir}`; `needsRoute(j)` treats a foot route without `dir|sig` as still pending (so routes cached by older versions fetch directions once); `dirText()`/`dirIcon()` render them. List renders walk/ride as `.gstep.mini`. Covered by `tests/test_app.py`.
- **Never rebuild the step map for new data (v1.16).** `initGuideMap()` creates `gmap` once per step. `draw()` updates the source data and exit markers in place and calls `fitBounds` only the first time. `refreshSheet()` swaps `.gsheet`/`.gover` HTML. `ensureDayExtras()` only calls back when something actually loaded. `exitPending`/`routePending` skip failed or in-flight items; `dayNeedsExtras(iso)` gates every trigger. (This was a real bug: 15 map rebuilds in 8 s when Overpass failed.)
- **Caveat:** nearest-exit can pick another operator's exit at multi-line stations (e.g. Asakusa: Toei vs Ginza). Fix by setting `fromExit`/`toExit`.
- **Test mock:** Overpass returns exits A1–A6 around each station.

### Stations (v1.13)
- **The trip's own stations** (endpoints of `train`/`subway` legs only; taxi endpoints are excluded) draw as coloured code badges (`.stn`).
  - **Day view:** always shown.
  - **All / Thailand / Tokyo views:** shown as `.stn.ov`, hidden below zoom 12 via a `lowzoom` class toggled in `syncLabels` (`STN_ZOOM`).
- **Every station in the city:** `addStationLayer()` adds two layers on the vector source's `poi` layer, filtered to `class == railway` and not platforms, from zoom 13.
  - `all-stations-dot` is a white circle.
  - `all-stations` is a label: the English name (`name:en` / `name:latin` / `name`) with the local `name` underneath.
  - No emoji in map text, because the downloaded glyph files don't include emoji.
  - **Untested with real tiles** (the mock tiles are empty). If nothing shows on the phone, check the OpenMapTiles `poi` class for stations and the vector source id.

### Real routes on day view (v1.8)
- **Trains/subways:** Overpass (`overpass-api.de`, GET) fetches route relations whose `name`/`name:en` matches `RAIL_NAMES[line]` in the leg's bbox ±0.04°, then `way(r)["railway"]` with `out geom`. `railPath()` builds a graph, labels the connected pieces and bridges loose ends to the nearest node of every *other* piece (120 m, then 300 m on a retry). It snaps stations within 1.5 km and runs Dijkstra.
- **Taxi/bus and walk legs, plus place-to-place hops ≤ 2.5 km:** OSRM on `routing.openstreetmap.de` (car / foot), **throttled to 1 request/s** per FOSSGIS policy.
- **Caching:** results are simplified (~3 m) and stored in IndexedDB. Failures aren't retried in the same session (an early bug looped requests). Attribution, including "Fix the map", is in the map's credit line, as FOSSGIS requires.
- **Flights aren't drawn.**

### Budget, lists, backup
- **Budget:** in GBP; expenses can be entered in THB or JPY and are converted at the settings rates.
- **Checklists:** any number of named lists.
- **Backup:** export/import JSON via the system dialog. **Own photos aren't included.**

---

## Data model

See [TRIP-FORMAT.md](TRIP-FORMAT.md). Other storage: IndexedDB `tripkit-photos` (v2), with store `p` (your own photos, keyed by item id, not in backups) and store `r` (route geometry `kind|line|from|to`, station exits `ex|lat,lng`, walking directions `dir|<route key>`).

## Testing approach

- `tests/test_app.py` starts a local web server for `app/`, opens it in headless Chromium at phone size with a fake clock, and routes every external host to `tests/mocks.py`:
  - **OpenFreeMap:** an empty style.
  - **Wikipedia:** stand-in striped photos and a stand-in description.
  - **Overpass:** wavy lines between stations, and exits A1–A6.
  - **OSRM:** a dog-leg path and four turn-by-turn steps.
- `--shots` saves the README screenshots.
- For data changes, test an upgrade too: export a backup from the old version, import it into the new one, and check nothing is lost.
