"""TripKit browser tests — runs the app in headless Chromium with the network faked (tests/mocks.py).

    pip install playwright pillow && python -m playwright install chromium
    python tests/test_app.py            # run the checks
    python tests/test_app.py --shots    # also refresh the screenshots in docs/images/

Exit code 0 = all checks passed.
"""
import asyncio, functools, http.server, os, socketserver, sys, threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from mocks import route, wiki2, up, ovp2, osrm2, async_playwright  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
APP, SHOTS = ROOT / 'app', ROOT / 'docs' / 'images'
TOKYO, BANGKOK, PATONG = '2026-11-29', '2026-11-25', '2026-11-22'
results = []


def check(name, ok, detail=''):
    results.append(ok)
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail and not ok else ''))


def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(APP))
    h.log_message = lambda *a: None
    srv = socketserver.TCPServer(('127.0.0.1', 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


async def new_page(b, clock):
    ctx = await b.new_context(viewport={'width': 412, 'height': 860}, device_scale_factor=2, is_mobile=True, has_touch=True)
    for pat, fn in [('https://tiles.openfreemap.org/**', route), ('https://en.wikipedia.org/**', wiki2),
                    ('https://upload.wikimedia.org/**', up), ('https://overpass-api.de/**', ovp2),
                    ('https://routing.openstreetmap.de/**', osrm2)]:
        await ctx.route(pat, fn)
    await ctx.add_init_script("window.Android={isApp:()=>true,tileCount:()=>0,clearTiles:()=>0,exportJson:()=>0}")
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.clock.install(time=clock)
    return ctx, pg, errs


async def main(shots):
    srv = serve(); url = f'http://127.0.0.1:{srv.server_address[1]}/index.html'
    if shots: SHOTS.mkdir(parents=True, exist_ok=True)
    shot = lambda pg, n: pg.screenshot(path=str(SHOTS / n)) if shots else asyncio.sleep(0)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])

        # --- start-up screen before the trip ---
        ctx, pg, errs = await new_page(b, '2026-11-11T09:00:00')
        await pg.goto(url); await pg.wait_for_timeout(1600)
        txt = await pg.inner_text('#splash')
        check('start-up screen shows a countdown', 'days to go' in txt, txt)
        await shot(pg, '01-startup.png')
        await pg.clock.run_for(2600); await pg.wait_for_timeout(600)
        check('start-up screen fades away', await pg.locator('#splash').count() == 0)

        # --- demo data has no bookings ---
        st = await pg.evaluate("({f: S.flights.length, s: S.stays.length, b: S.bookings.length, e: S.expenses.length, p: S.places.length, t: S.transit.length})")
        check('demo trip has no flights, hotels, tickets or spending', st['f'] == st['s'] == st['b'] == st['e'] == 0, st)
        check('demo trip has places and journeys', st['p'] > 10 and st['t'] > 5, st)
        await ctx.close()

        # --- during the trip: Today, Guide, Map, Trip ---
        ctx, pg, errs = await new_page(b, TOKYO + 'T08:30:00')
        await pg.goto(url); await pg.wait_for_timeout(1500)
        check('start-up screen shows the trip day', 'Day ' in await pg.inner_text('#splash'))
        await pg.clock.run_for(2600); await pg.wait_for_timeout(500)
        await pg.clock.resume()
        rows = await pg.locator('.trow').count()
        check('Today lists the day', rows >= 8, rows)
        check('Tokyo day uses the Japan theme', await pg.evaluate("document.body.dataset.theme") == 'jp')
        await shot(pg, '02-today-tokyo.png')

        await pg.click('[data-tab="guide"]'); await pg.click(f'[data-gday="{TOKYO}"]'); await pg.wait_for_timeout(15000)
        kinds = await pg.evaluate(f"buildGuide('{TOKYO}').steps.map(s => s.kind + (s.role || ''))")
        check('Guide splits station walks and rides into steps', 'walkto' in kinds and 'ride' in kinds and 'walkfrom' in kinds, kinds)
        await pg.evaluate("document.querySelector('main').scrollTop = 0")
        await shot(pg, '03-guide-list.png')
        i = kinds.index('walkfrom')
        await pg.evaluate(f"views._gStep = {i}; render()"); await pg.wait_for_timeout(3000)
        check('walk step has turn-by-turn directions', await pg.locator('.gdir li').count() >= 3)
        await shot(pg, '04-guide-walk.png')
        await pg.evaluate(f"views._gStep = {kinds.index('ride')}; render()"); await pg.wait_for_timeout(3000)
        check('ride step shows exit badges on the map', await pg.locator('#gmap .exb').count() >= 1)
        await shot(pg, '05-guide-train.png')
        await pg.evaluate(f"views._gStep = {i + 1}; render()"); await pg.wait_for_timeout(3000)
        await shot(pg, '06-guide-place.png')

        await pg.click('[data-tab="today"]'); await pg.click(f'[data-day="{BANGKOK}"]'); await pg.wait_for_timeout(800)
        check('Bangkok day uses the Thailand theme', await pg.evaluate("document.body.dataset.theme") == 'th')
        await shot(pg, '07-today-bangkok.png')

        await pg.click('[data-tab="map"]'); await pg.wait_for_timeout(2500)
        check('Map tab opens', await pg.locator('#map').count() == 1)
        await pg.click('[data-tab="trip"]'); await pg.wait_for_timeout(500)
        await pg.evaluate("document.querySelector('main').scrollTop = 0")
        await shot(pg, '08-trip.png')
        await pg.click('[data-tripsec="trains"]'); await pg.wait_for_timeout(800)
        await shot(pg, '09-trains.png')
        await pg.click('[data-tab="trip"]'); await pg.click('[data-tripsec="settings"]')
        await pg.click('[data-act="themeClassic"]')
        check('Classic look can be chosen', await pg.evaluate("document.body.dataset.theme") == '')
        await pg.click('[data-act="themeCountry"]')
        check('no JavaScript errors', not errs, errs[:3])
        await ctx.close()
        await b.close()
    srv.shutdown()
    print(f'\n{sum(results)}/{len(results)} checks passed')
    return all(results)


if __name__ == '__main__':
    sys.exit(0 if asyncio.run(main('--shots' in sys.argv)) else 1)
