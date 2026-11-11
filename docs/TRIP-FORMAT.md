# Trip file format

A TripKit trip is one JSON file. It's the same file **Trip → Settings → Export backup** writes, and the one **Import backup** reads. [`app/demo-trip.js`](../app/demo-trip.js) is a full example: the demo trip wrapped in `window.DEMO_TRIP = …;`. Copy the part after the `=` (without the final `;`) to get a valid file.

Any collection you leave out is filled in as empty on import. The smallest valid file is:

```json
{ "trip": { "title": "Kyoto weekend", "start": "2027-04-02", "end": "2027-04-05", "budget": 600, "cur": "GBP" }, "places": [] }
```

## Top level

| Key | What |
|---|---|
| `v` | data version. Use `11` |
| `trip` | `title`, `start`, `end` (dates `YYYY-MM-DD`; `end` is the day you get home), `budget` (number, home currency), `cur` (`"GBP"`), optional `japanPass: {from, to}` (dates of a 72h Tokyo Subway Ticket; defaults to the first 3 full days in Japan) |
| `rates` | local currency units per 1 home unit, e.g. `{"THB": 44, "JPY": 209}` |
| `cities` | which city you're in each day, used for headers, themes and map filters: `[{ "start", "end", "city", "country" }]`. `end` is the day you leave (not included). `country` is `jp`, `th` or `uk` for the themes; anything else gets the classic look |
| `places` | things to see, eat or buy (below) |
| `transit` | trains, metro, taxis, buses (below) |
| `flights`, `stays`, `bookings`, `expenses` | optional, below |
| `lists` | checklists: `[{ "id", "name", "items": [{ "id", "t": "text", "done": false }] }]` |
| `theme` | `"country"` (default) or `"classic"` |

Every item in a list needs a unique `id` (any short string).

## places

```json
{ "id": "p1", "name": "Senso-ji Temple", "local": "浅草寺", "day": "2026-11-29", "time": "11:00",
  "area": "Asakusa", "lat": 35.7148, "lng": 139.7967, "cat": "see", "wiki": "Sensō-ji",
  "notes": "Nakamise-dori snacks on the way", "emoji": "", "link": "", "done": false }
```

- `cat`: `see`, `eat`, `shop` or `other`.
- No `day` = an idea. It shows under *Ideas for free days*.
- `wiki`: the exact English Wikipedia article title. It's used for the photo, the description and the local name.
- `emoji`: optional. If blank, one is picked from the name.
- `local`: optional. If blank, it's filled from Wikipedia.

## transit

```json
{ "id": "t1", "date": "2026-11-29", "time": "10:10", "mode": "subway", "line": "Toei Asakusa Line", "color": "#E85298",
  "from": "Ningyocho", "fromCode": "A-14", "fromLat": 35.6862, "fromLng": 139.7823,
  "to": "Asakusa", "toCode": "A-18", "toLat": 35.7107, "toLng": 139.7976,
  "dur": "~8 min", "fareJPY": 178, "board": "Pink line, towards Oshiage / Aoto",
  "fromExit": "", "toExit": "A4", "notes": "Exit A4 comes out right by Kaminarimon Gate.", "done": false }
```

- `mode`: `train`, `subway`, `taxi`, `bus` or `walk`.
- `color` is the line colour on the map. Official colours for common lines are built in (`LINES` in `app.js`).
- `fromExit` / `toExit`: leave blank to use the nearest exit to where you're going.
- `fareJPY` (a number) feeds the Japan rail totals. `fare` is free text for anything else, e.g. `"THB ~33"`.
- `arr` is an optional arrival time.

**Real routes:** for lines to follow the real track, the line name must match the OpenStreetMap route name. The matching patterns are `RAIL_NAMES` in `app.js`; add yours there.

## flights, stays, bookings, expenses (optional)

```json
"flights":  [{ "id": "f1", "date": "…", "dep": "14:25", "arrDate": "…", "arr": "15:50", "from": "Phuket", "fromCode": "HKT",
               "to": "Bangkok Don Mueang", "toCode": "DMK", "airline": "", "flightNo": "", "ref": "", "price": 0, "notes": "" }],
"stays":    [{ "id": "s1", "name": "…", "local": "", "status": "booked", "checkIn": "…", "inTime": "15:00", "arrive": "",
               "checkOut": "…", "outTime": "11:00", "leave": "", "address": "…, Bangkok", "lat": 0, "lng": 0, "ref": "", "price": 0, "notes": "" }],
"bookings": [{ "id": "b1", "name": "…", "date": "…", "time": "…", "status": "booked", "price": 0, "cur": "JPY", "ref": "",
               "place": "p1", "notes": "" }],
"expenses": [{ "id": "e1", "date": "…", "desc": "…", "amount": 12.5, "cur": "GBP" }]
```

- **Stays:** `status` is one of `booked`, `tobook`, `deciding`, `tocancel`, `idea` or `cancelled`. A stay's address naming a known city (Tokyo, Bangkok, Patong, Phuket…) also sets the city for those nights.
- **Bookings:** a booking with `place` set to a place's `id` shows as "🎟 ticket booked" on that place.

## Getting an AI assistant to write it

Paste this, then answer its questions:

> I use an offline trip app called TripKit. Ask me about my trip one question at a time (dates, cities and which nights in each, places I want to see with the day and time, trains and metro journeys between them, flights and hotels if I want them in, budget and currency). Then write the whole trip as one JSON file in this format: *(paste this whole page)*. Use real coordinates for every place and station, the exact English Wikipedia title in `wiki`, official line colours, and the local-language name in `local`. Use `v: 11`. Reply with only the JSON.

Check the dates and coordinates before you import. AI assistants can get station positions slightly wrong.
