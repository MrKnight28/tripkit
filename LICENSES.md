# Licences for bundled files and online data

Checked on 11 Nov 2026. This is not legal advice.

## Bundled in the app

| File | Source | Licence |
|---|---|---|
| `app/vendor/maplibre-gl.js`, `maplibre-gl.css` | MapLibre GL JS v4.7.1 (github.com/maplibre/maplibre-gl-js) | BSD-3-Clause, full text in `app/vendor/LICENSE.txt` |
| `app/icons/*`, `apk/res/mipmap-*/ic_launcher.png` | made for this project | same as TripKit's own code |

TripKit's own code has no licence yet. Pick one before making the repo public (MIT is the usual choice for a small app like this).

## Data fetched at run time (not stored in this repo)

| Data | Source | Licence / terms | How TripKit complies |
|---|---|---|---|
| Map tiles, fonts, sprites | OpenFreeMap (openfreemap.org), built from OpenStreetMap | Map data © OpenStreetMap contributors, ODbL; OpenMapTiles schema | "© OpenStreetMap" attribution on every map |
| Train lines, station entrances | Overpass API (overpass-api.de), OpenStreetMap data | ODbL; Overpass usage policy (fair use) | cached on the phone, one lookup per line/station, no bulk queries |
| Walking and driving routes, directions | routing.openstreetmap.de (FOSSGIS e.V.) | FOSSGIS usage policy: max 1 request/s, attribution, no heavy use | throttled to 1/s, cached, credit "Routes © OpenStreetMap · OSRM/FOSSGIS" on route maps |
| Place photos | Wikimedia Commons via the Wikipedia API | each photo's own licence (mostly CC BY-SA or public domain) | credit link to the source page under every photo |
| Place descriptions | Wikipedia article intros | CC BY-SA 4.0 | shown under the photo, whose credit links to the article |
| Station codes, line colours, fares | official operator information (Tokyo Metro, Toei, SRT, BEM) | facts | entered by hand in the demo trip; check before relying on them |

OpenStreetMap's own tile server (tile.openstreetmap.org) is **not** used: its policy forbids offline downloading. Version 1.0 used it and was blocked.
