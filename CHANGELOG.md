# Changelog

Every release from the first APK to now. Each one installs over the last and keeps your data. The newest releases are dated (2026).

## 1.19 — Country themes · 4 Nov
- **The look follows the country you're in that day:**
  - **Japan:** deep indigo, torii-gate red, a faint seigaiha wave pattern, and the city name in Japanese (東京) in the header.
  - **Thailand:** temple emerald and gold, with a lotus lattice and the city in Thai script (กรุงเทพ, ป่าตอง).
  - **Home days:** slate and post-box red.
- It switches as you move between days on Today, Guide and Map.
- **Trip → Settings → Look:** choose Country theme or Classic (the look before 1.19).
- This was picked from three concepts. The other two, *Tokyo Neon* and the light *Washi Paper*, weren't built.

## 1.18 — Start-up screen · 4 Nov
- **On opening:** the route draws itself, then you see the trip name and dates and one line that changes with the date:
  - **Before the trip:** "10 days to go" and your first stop.
  - **During:** "Day 9 of 12 · Tokyo" and the next thing on today's plan.
  - **After:** "Welcome home".
- It fades after about 2 seconds, or straight away if you tap it.
- The black flash before the app loads is now the same dark blue as the app.

## 1.17 — Walks as guided steps · 4 Nov
- **A stop reached by train is now three steps in the Guide:**
  - 🚶 the walk to the station, with the exit to go in at and the train you're catching next;
  - 🚆 the ride, with lines, changes and exit badges;
  - 🚶 the walk from the exit to the place.
- **Each walk step has its own map and turn-by-turn directions.** They download once and then work offline.
- Changing lines partway stays inside the ride step.

## 1.16 — Fix: shaking Guide map · 4 Nov
- **Fixed:** on train steps the Guide map shook and jittered.
- **The cause:** a failed station-exit lookup triggered a redraw, the redraw retried the lookup, and the map was rebuilt about twice a second.
- **Now:** failed lookups aren't retried in the same session. The map is built once per step, and new data (exits, routes) is added in place without the map moving.

## 1.15 — Station exits and walks
- **Which exit to use:** the Guide shows the exit letter for every station, going in and coming out, from OpenStreetMap entrance data. By default it picks the exit nearest where you're going. You can set a fixed exit per journey.
- **Walking routes:** to and from stations, and between platforms when you change lines, shown on the step and day maps with yellow exit badges.

## 1.14 — Redesign: four tabs and the Guide
- **Four tabs instead of six:** Today · Guide · Map · Trip.
  - **Today** is one compact line per item.
  - Plan, Lists and More are merged into **Trip**.
- **New Guide:** your day as steps. Each step has a map from the previous stop, a photo, a short Wikipedia description, legs and tickets, **Mark visited** and previous/next. "Next up" highlights where you are on the day.

## 1.13 — Stations on the map
- Your own stations appear as coloured code badges on the overview maps from zoom 12.
- Every other station in the city appears from zoom 13, with English and local names, taken from the offline map data.

## 1.12 — Booking updates
- A train booking added to the first travel day.
- A cancelled hotel booking marked as cancelled.
- The last leg home changed from a train to a lift.

## 1.11 — Airport hotel and "Travel day"
- A hotel for the night before the flight, added from its confirmation PDF, with the airport transfer the next morning.
- Days spent travelling are labelled **Travel day** in the header.

## 1.10 — Check-in and check-out times
- Stays now have check-in, arrival, check-out and leave-by times, shown in the right place on the timeline.
- A beach hotel added.

## 1.9 — Tickets linked to places
- A timed attraction ticket linked to its place: it shows as "🎟 ticket booked" on that stop instead of a separate pin.
- The evening of that day re-timed around it.

## 1.8 — Real routes
- On a single day's map, lines follow the real train track (OpenStreetMap via Overpass) and the real roads and footpaths (OSRM), instead of straight lines.
- Flights stay as no line.
- Routes are cached for offline use.

## 1.7 — Local names on pins
- Pins show the English name with the Japanese or Thai name underneath, once you zoom in.
- Thai places get Thai, which is handier for taxi drivers.

## 1.6 — Emoji pins
- Map pins show an emoji for what they are: 🗼 🏯 🍜 🎮 🏨.
- Overview maps no longer draw lines between cities. Lines only appear on a single day's view.

## 1.5 — Photos
- Places get photos from Wikipedia automatically, with credit links.
- You can add your own photos, stored on the phone only.
- Photos are cached for offline use.

## 1.4 — Japan rail
- **A Japan rail section:** a line guide (letter, colour, operator, whether the pass covers it), fares in ¥ and £, journey times, and a pay-as-you-go total.
- **A 72h Tokyo Subway Ticket check:** whether Suica or the pass is cheaper for your plans.

## 1.3 — Bookings from confirmations
- Flights, hotels and journeys entered from booking screenshots.
- The journey home added.
- The budget itemised by what's already paid.

## 1.2 — Trains and stations
- Every train and metro journey with line colour, station codes, which train to board, and fares.
- Advice on Suica, the 72h pass and Bangkok transit cards, in the checklists.

## 1.1 — Offline maps that work
- **Switched to MapLibre + OpenFreeMap vector maps.** OpenStreetMap's own tile server blocked v1.0, because its policy doesn't allow offline downloading.
- **Save cities + my places** downloads the maps for the whole trip in one go.

## 1.0 — First APK
- Itinerary by day, places, flights, stays, budget, checklists, and an offline map, packaged as an Android app.
- Data lives on the phone, with backup and import between phones.

## Repository release
- TripKit was published as a repository with a **demo trip** in place of personal data. Flights, hotels, tickets, payments and booking references were removed.
- The app id changed from the private build's to `app.tripkit`. The repo APK is a separate app that installs alongside the original, not over it.
- Trips can say which city you're in on each day (`cities`) without listing hotels, so the Guide, themes and start-up screen work without any booking data.
