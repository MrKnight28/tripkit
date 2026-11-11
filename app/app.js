/* TripKit — offline trip planner for Android
   All data lives on the phone (localStorage). Use Trip → Settings → Export backup to move it between phones. */
'use strict';
const KEY = 'tripkit.v1';
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const APP = !!window.Android;
const uid = () => Math.random().toString(36).slice(2, 10);

/* 72h Tokyo Subway Ticket window: trip.japanPass = { from, to } (dates); defaults to the first 3 full Tokyo days */
const passWin = () => S.trip.japanPass || (() => { const c = (S.cities || []).find(c => c.country === 'jp'); const f = c ? addDays(c.start, 1) : S.trip.start; return { from: f, to: addDays(f, 2) }; })();
const inPass = d => { const w = passWin(); return d >= w.from && d <= w.to; };
/* default colours for lines you add by hand (official line colours; add your own) */
const LINES = {
  'Keisei Access Express': '#F08300', 'Toei Asakusa Line': '#E85298', 'Toei Shinjuku Line': '#6CBB5A',
  'Hanzomon Line': '#8F76D6', 'Ginza Line': '#FF9500', 'Hibiya Line': '#9CAEB7', 'Fukutoshin Line': '#9C5E31',
  'Keikyu (via Asakusa Line)': '#E5171F', 'SRT Red Line': '#D21F26', 'MRT Blue Line': '#1E4F9C',
  'Airport Rail Link': '#8B1D2C', 'Piccadilly line': '#1C3F94', 'Taxi / Grab': '#8fa0b1', 'Walk': '#8fa0b1'
};
/* ---------- trip data ----------
   A fresh install starts with the demo trip in demo-trip.js (window.DEMO_TRIP).
   Load your own trip with Trip → Settings → Import backup — see docs/TRIP-FORMAT.md. */
const EMPTY_TRIP = () => ({ v: 11, trip: { title: 'My trip', start: new Date().toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10), budget: 0, cur: 'GBP' },
  rates: {}, cities: [], flights: [], stays: [], places: [], bookings: [], expenses: [], lists: [], transit: [] });
const SEED = () => JSON.parse(JSON.stringify(window.DEMO_TRIP || EMPTY_TRIP()));

/* fill in anything an older or hand-written trip file is missing */
function migrate(s) {
  const base = EMPTY_TRIP();
  for (const k of Object.keys(base)) if (s[k] == null) s[k] = base[k];
  s.v = Math.max(s.v || 1, 11);
  return s;
}

/* ---------- state ---------- */
let S;
try { S = JSON.parse(localStorage.getItem(KEY)) || SEED(); } catch { S = SEED(); }
S = migrate(S);
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S, (k, v) => k === '_ownPhoto' ? undefined : v)); } catch (e) { toast('Could not save: ' + e.message); } };
save();
if (navigator.storage?.persist) navigator.storage.persist();

let tab = 'today', selDay = null, mapDay = 'all', map, layer, meMarker;

/* ---------- helpers ---------- */
const CAT = { see: ['#4ea8ff', '★'], eat: ['#f5b13d', '🍜'], shop: ['#b67cff', '🛍'], stay: ['#3ecf8e', '⌂'], train: ['#E85298', '🚆'], subway: ['#8F76D6', '🚇'], taxi: ['#8fa0b1', '🚕'], walk: ['#8fa0b1', '🚶'], flight: ['#ff5a4e', '✈'], book: ['#ff8a3d', '🎟'], other: ['#8fa0b1', '•'] };
const CATNAME = { see: 'Sightseeing', eat: 'Food & drink', shop: 'Shopping', other: 'Other' };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const fmtDay = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : 'Unscheduled';
const days = () => { const out = []; for (let d = S.trip.start; d <= S.trip.end; d = addDays(d, 1)) out.push(d); return out; };
const where = iso => {
  if (!iso) return '';
  const st = S.stays.filter(s => s.checkIn <= iso && iso < s.checkOut);
  if (st.length) { const m = st[0].address.match(/Tokyo|Bangkok|Patong|Phuket|Seoul|Busan|Manchester Airport/); return m ? m[0] : st[0].address.split(',')[0]; }
  const c = cityOn(iso); if (c) return c.city;
  return iso >= S.trip.end ? 'Home' : (iso === S.trip.start || S.flights.some(f => f.date === iso)) ? 'Travel day' : '';
};
const cityOn = iso => (S.cities || []).find(c => c.start <= iso && iso < c.end);
const COUNTRY_OF = { Tokyo: 'jp', Kyoto: 'jp', Osaka: 'jp', Bangkok: 'th', Patong: 'th', Phuket: 'th', 'Chiang Mai': 'th', Home: 'uk', London: 'uk' };
const country = iso => { const c = cityOn(iso); return (c && c.country) || COUNTRY_OF[where(iso)] || ''; };
const gbp = (amt, cur) => cur === 'GBP' ? +amt : +amt / (S.rates[cur] || 1);
const money = n => '£' + (+n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const navLink = (lat, lng) => `geo:${lat},${lng}?q=${lat},${lng}`;
function toast(m) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.append(t); setTimeout(() => t.remove(), 2600); }
const statusTag = s => ({ booked: '<span class="tag ok">booked</span>', paid: '<span class="tag ok">paid</span>', deciding: '<span class="tag warn">deciding</span>', idea: '<span class="tag idea">idea</span>', cancelled: '<span class="tag">cancelled</span>', tocancel: '<span class="tag warn">cancel this</span>', tobook: '<span class="tag warn">not booked</span>', ticket: '<span class="tag ok">🎟 ticket booked</span>' }[s] || '');

/* ---------- events on a given day ---------- */
function dayItems(iso) {
  const out = [];
  S.flights.forEach(f => {
    if (f.date === iso) out.push({ k: 'flight', t: f.dep || '—', o: f, title: `${f.fromCode} → ${f.toCode}`, sub: `${f.airline} ${f.flightNo} · arr ${f.arr || '?'}${f.arrDate !== f.date ? ' (+1)' : ''}` });
    else if (f.arrDate === iso && f.date !== iso) out.push({ k: 'flight', t: f.arr || '—', o: f, title: `Land ${f.toCode}`, sub: `${f.airline} from ${f.fromCode}` });
  });
  S.transit.filter(t => t.date === iso).forEach(t => out.push({ k: 'transit', t: t.time || '', s: t.time || t.arr, o: t, color: t.color, icon: (CAT[t.mode] || CAT.train)[1],
    title: `${t.from} → ${t.to}`, sub: [t.line, (t.fromCode || t.toCode) && `${t.fromCode}→${t.toCode}`, t.dur, t.fare].filter(Boolean).join(' · '), board: t.board, notes: t.notes }));
  S.stays.filter(s => !/cancel/.test(s.status)).forEach(s => {
    if (s.checkIn === iso) out.push({ k: 'stay', t: s.arrive || s.inTime || '15:00', o: s, title: `Check in · ${s.name}`, sub: [s.inTime && s.arrive ? `check-in from ${s.inTime}` : '', s.address].filter(Boolean).join(' · '), tag: s.status });
    if (s.checkOut === iso) out.push({ k: 'stay', t: s.leave || s.outTime || '11:00', o: s, title: `Check out · ${s.name}`, sub: [s.leave && s.outTime ? `check-out by ${s.outTime}` : '', s.address].filter(Boolean).join(' · '), tag: s.status });
  });
  S.places.filter(p => p.day === iso).forEach(p => { const tk = S.bookings.find(b => b.place === p.id && b.status !== 'cancelled');
    out.push({ k: 'place', t: p.time || '', o: p, title: p.name, sub: [p.area, p.notes].filter(Boolean).join(' · '), cat: p.cat, tag: tk ? 'ticket' : '' }); });
  S.bookings.filter(b => b.date === iso && !b.place).forEach(b => out.push({ k: 'book', t: b.time || '', o: b, title: b.name, sub: [b.ref && 'Ref ' + b.ref, b.notes].filter(Boolean).join(' · '), tag: b.status }));
  return out.sort((a, b) => (a.s || a.t || '99').localeCompare(b.s || b.t || '99'));
}

function transitCard(t) {
  const ic = (CAT[t.mode] || CAT.train)[1];
  return `<div class="card transit ${t.done ? 'done' : ''}" style="--lc:${t.color}" data-edit="transit" data-id="${t.id}">
    <div class="row"><span class="time">${esc(t.time)}</span><div class="grow">
      <div class="linepill" style="background:${t.color}">${JP_LINES[t.line] ? JP_LINES[t.line].code + ' ' : ''}${ic} ${esc(t.line)}</div>
      <h3>${esc(t.from)} ${t.fromCode ? `<span class="code">${esc(t.fromCode)}</span>` : ''} → ${esc(t.to)} ${t.toCode ? `<span class="code">${esc(t.toCode)}</span>` : ''}</h3>
      <div class="small muted">${esc([t.arr ? 'arr ' + t.arr : '', t.dur, +t.fareJPY ? `${t.approx ? '≈' : ''}${yen(t.fareJPY)} (${jpyGbp(t.fareJPY)})${JP_LINES[t.line]?.pass && inPass(t.date) ? ' · 72h pass' : ' · Suica'}` : t.fare].filter(Boolean).join(' · '))}</div>
      ${t.board ? `<div class="small board">▶ ${esc(t.board)}</div>` : ''}
      ${t.notes ? `<div class="small muted">${esc(t.notes)}</div>` : ''}
    </div></div></div>`;
}

/* ---------- photos ---------- */
// Online: pulled from Wikipedia/Wikimedia (free-licensed, credited) and cached on the phone.
// Own photos: resized on-device and kept in IndexedDB (not in backups).
const WIKI_API = 'https://en.wikipedia.org/w/api.php?format=json&origin=*&action=query&redirects=1&prop=pageimages|info|extracts&exintro=1&explaintext=1&exsentences=3&inprop=url&piprop=thumbnail&pithumbsize=900';
const OWN = {};               // id -> data URL of the user's own photo
let idb = null;
function idbOpen() {
  return new Promise(res => { try { const r = indexedDB.open('tripkit-photos', 2); r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('p')) d.createObjectStore('p'); if (!d.objectStoreNames.contains('r')) d.createObjectStore('r'); }; r.onsuccess = () => res(idb = r.result); r.onerror = () => res(null); } catch { res(null); } });
}
const idbDo = (mode, fn) => new Promise(res => { if (!idb) return res(null); const tx = idb.transaction('p', mode), st = tx.objectStore('p'); const r = fn(st); tx.oncomplete = () => res(r?.result); tx.onerror = () => res(null); });
async function loadOwnPhotos() {
  await idbOpen(); if (!idb) return;
  await new Promise(res => { const tx = idb.transaction('p'), c = tx.objectStore('p').openCursor(); c.onsuccess = () => { const cur = c.result; if (cur) { OWN[cur.key] = cur.value; cur.continue(); } else res(); }; c.onerror = res; });
}
const localLang = o => { const la = +o.lat, ln = +o.lng; return !la ? '' : la < 25 && ln > 90 ? 'th' : la > 25 && ln > 120 ? 'ja' : la > 33 && ln > 124 && ln < 131 ? 'ko' : ''; };
async function wikiPhoto(q, search, lang) {
  const url = WIKI_API.replace('prop=pageimages|info', 'prop=pageimages|info' + (lang ? '|langlinks&lllang=' + lang : '')) +
    (search ? '&generator=search&gsrlimit=1&gsrsearch=' + encodeURIComponent(q) : '&titles=' + encodeURIComponent(q));
  const j = await (await fetch(url, { headers: { 'Api-User-Agent': 'TripKit/1.7 (personal offline trip planner)' } })).json();
  const pages = Object.values(j.query?.pages || {});
  const p = pages.find(x => x.thumbnail) || pages.find(x => x.langlinks);
  if (!p) return null;
  const out = p.thumbnail ? { photo: p.thumbnail.source, photoCredit: p.fullurl, photoTitle: p.title } : {};
  if (p.extract) out.about = p.extract.replace(/\s+/g, ' ').trim().slice(0, 600);
  const ll = p.langlinks?.[0]; if (ll && (ll['*'] || ll.title)) out._local = ll['*'] || ll.title;
  return out;
}
const applyWiki = (o, r) => { const { _local, ...rest } = r; Object.assign(o, rest); if (_local && !o.local) o.local = _local; };
const photoOf = o => OWN[o.id ?? '_new'] || o.photo || '';
function photoCreditHtml(o) {
  if (OWN[o.id ?? '_new']) return '<span class="pcredit">Your photo</span>';
  return o.photoCredit ? `<a class="pcredit" href="${esc(o.photoCredit)}" target="_blank" rel="noopener">Photo: Wikipedia · ${esc(o.photoTitle || '')}</a>` : '';
}
const thumbHtml = o => photoOf(o) ? `<img class="thumb" src="${esc(photoOf(o))}" alt="" loading="lazy" onerror="this.remove()">` : '';
// fill in photos for anything with a wiki title, quietly, a few at a time
let autoBusy = false; const autoTried = new Set();
async function autoPhotos() {
  if (autoBusy || !navigator.onLine) return; autoBusy = true;
  const todo = [...S.places, ...S.bookings].filter(o => o.wiki && ((!o.photo && !o.noPhoto) || (!o.local && localLang(o)) || (!o.about && !o.noAbout)) && !autoTried.has(o.id)).slice(0, 6);
  let changed = false;
  for (const o of todo) { autoTried.add(o.id); try { const r = await wikiPhoto(o.wiki, false, o.local ? '' : localLang(o)); if (r) { const hadPhoto = o.photo; applyWiki(o, r); if (hadPhoto && o.noPhoto) o.photo = ''; if (!r.about) o.noAbout = true; changed = true; } } catch { } }
  autoBusy = false;
  if (changed) { save(); if (!document.querySelector('#dlg').open && tab !== 'map' && !(tab === 'guide' && views._gStep != null)) render(); }
  if (todo.length === 6) setTimeout(autoPhotos, 500);
}
function shrink(file, max = 1100) {
  return new Promise((res, rej) => {
    const img = new Image(); img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src); res(c.toDataURL('image/jpeg', 0.82)); };
    img.onerror = rej; img.src = URL.createObjectURL(file);
  });
}
// photo controls inside the edit form (places & bookings)
function photoPanel(o) {
  const src = photoOf(o);
  return `<div class="photopanel" id="photoPanel">
    ${src ? `<div class="pimg inform"><img src="${esc(src)}" alt="" onerror="this.style.display='none'">${photoCreditHtml(o)}</div>` : '<div class="nophoto">No photo yet</div>'}
    <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
      <button type="button" class="btn sm" data-ph="find">🔎 Find photo online</button>
      <button type="button" class="btn sm" data-ph="own">📷 Use my photo</button>
      ${src ? '<button type="button" class="btn sm" data-ph="remove">Remove</button>' : ''}
    </div><input type="file" accept="image/*" id="phFile" hidden></div>`;
}
function wirePhotoPanel(o, getName) {
  const panel = $('#photoPanel'); if (!panel) return;
  const redraw = () => { panel.outerHTML = photoPanel(o); wirePhotoPanel(o, getName); };
  panel.querySelector('[data-ph="find"]').onclick = async () => {
    if (!navigator.onLine) return toast('Connect to the internet to find photos');
    const q = getName(); if (!q) return toast('Type a name first');
    toast('Searching…');
    try { const lg = localLang(o); const r = (o.wiki && await wikiPhoto(o.wiki, false, lg)) || await wikiPhoto(q, true, lg); if (r && r.photo) { applyWiki(o, r); delete o.noPhoto; o._photoDirty = true; redraw(); if (o.local) { const fl = $('#dlgForm [name=local]'); if (fl && !fl.value) fl.value = o.local; } } else toast('No photo found — try “Use my photo”'); }
    catch { toast('Photo search failed'); }
  };
  panel.querySelector('[data-ph="own"]').onclick = () => $('#phFile').click();
  $('#phFile').onchange = async e => { const f = e.target.files[0]; if (!f) return;
    try { o._ownPhoto = await shrink(f); OWN[o.id || '_new'] = o._ownPhoto; o._photoDirty = true; redraw(); } catch { toast('Could not read that image'); } };
  panel.querySelector('[data-ph="remove"]')?.addEventListener('click', () => { delete OWN[o.id || '_new']; o._ownPhoto = null; o._removeOwn = true; o.photo = ''; o.photoCredit = ''; o.photoTitle = ''; o.noPhoto = true; o._photoDirty = true; redraw(); });
}
async function commitPhoto(id, ph) {
  if (ph.own) { OWN[id] = ph.own; await idbDo('readwrite', st => st.put(ph.own, id)); }
  else if (ph.remove) { delete OWN[id]; await idbDo('readwrite', st => st.delete(id)); }
}

/* ---------- real routes (day view) ---------- */
// Trains follow the actual track (OpenStreetMap railway relations via Overpass);
// taxis follow roads and walks follow footpaths (OSRM, FOSSGIS server). Fetched once
// when online, simplified, then kept in IndexedDB so day maps work offline.
const ROUTES = {};                         // sig -> [[lng,lat],...]
const RAIL_NAMES = {                       // OSM relation name patterns (Japanese / English / Thai)
  'Keisei Access Express': '成田スカイアクセス|Narita Sky Access|北総|Hokuso|押上線|Oshiage|浅草線|Asakusa',
  'Toei Asakusa Line': '浅草線|Asakusa', 'Toei Shinjuku Line': '都営新宿線|Toei Shinjuku|Shinjuku Line',
  'Hanzomon Line': '半蔵門線|Hanzomon', 'Fukutoshin Line': '副都心線|Fukutoshin', 'Ginza Line': '銀座線|Ginza Line',
  'Hibiya Line': '日比谷線|Hibiya', 'Keikyu (via Asakusa Line)': '浅草線|Asakusa|京急|Keikyu|Keikyū',
  'SRT Red Line': 'Red Line|สายสีแดง', 'MRT Blue Line': 'Blue Line|สายสีน้ำเงิน|เฉลิมรัชมงคล|Chaloem',
  'Airport Rail Link': 'Airport Rail Link|แอร์พอร์ต', 'Piccadilly line': 'Piccadilly'
};
const OVERPASS = 'https://overpass-api.de/api/interpreter?data=';
const OSRM = { car: 'https://routing.openstreetmap.de/routed-car/route/v1/driving/', foot: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/' };
const r5 = n => Math.round(n * 1e5) / 1e5;
const legKind = t => t.mode === 'taxi' || t.mode === 'bus' ? 'car' : t.mode === 'walk' ? 'foot' : (t.mode === 'train' || t.mode === 'subway') ? 'rail' : '';
const sigOf = (kind, line, a, b) => `${kind}|${kind === 'rail' ? line : ''}|${r5(a[1])},${r5(a[0])}|${r5(b[1])},${r5(b[0])}`;
const hav = (a, b) => { const R = 6371e3, t = Math.PI / 180, dLa = (b[1] - a[1]) * t, dLo = (b[0] - a[0]) * t;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * t) * Math.cos(b[1] * t) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
function simplify(pts, tol = 0.00003) {     // Douglas–Peucker, ~3 m
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) { const [s, e] = stack.pop(); let md = 0, mi = -1; const [x1, y1] = pts[s], [x2, y2] = pts[e];
    const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy || 1e-18;
    for (let i = s + 1; i < e; i++) { const [x, y] = pts[i]; const u = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L));
      const d = (x - x1 - u * dx) ** 2 + (y - y1 - u * dy) ** 2; if (d > md) { md = d; mi = i; } }
    if (md > tol * tol) { keep[mi] = 1; stack.push([s, mi], [mi, e]); } }
  return pts.filter((_, i) => keep[i]).map(([x, y]) => [r5(x), r5(y)]);
}
// shortest path along the railway ways (graph built from way geometries; small gaps bridged)
function railPath(ways, a, b) {
  const K = (lo, la) => lo.toFixed(6) + ',' + la.toFixed(6), N = new Map();
  const node = (lo, la) => { const k = K(lo, la); let n = N.get(k); if (!n) N.set(k, n = { p: [lo, la], adj: [] }); return n; };
  for (const w of ways) { const g = w.geometry || []; for (let i = 1; i < g.length; i++) { const p = node(g[i - 1].lon, g[i - 1].lat), q = node(g[i].lon, g[i].lat);
    if (p === q) continue; const d = hav(p.p, q.p); p.adj.push([q, d]); q.adj.push([p, d]); } }
  if (!N.size) return null;
  const all = [...N.values()];
  // label connected pieces of track
  let comp = 0; all.forEach(n => { if (n.c !== undefined) return; n.c = comp; const st = [n];
    while (st.length) { const u = st.pop(); for (const [v] of u.adj) if (v.c === undefined) { v.c = comp; st.push(v); } } comp++; });
  // bridge loose ends to a *different* piece within 120 m (stations where two OSM lines don't share a node)
  const cell = n => Math.floor(n.p[0] / 0.002) + ':' + Math.floor(n.p[1] / 0.002), grid = new Map();
  all.forEach(n => { const c = cell(n); (grid.get(c) || grid.set(c, []).get(c)).push(n); });
  // (nearest node in every other piece, so close parallel tracks can't steal the only bridge)
  const bridge = (maxD, R) => all.filter(n => n.adj.length <= 1).forEach(n => { const [cx, cy] = cell(n).split(':').map(Number); const best = new Map();
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) for (const m of grid.get((cx + i) + ':' + (cy + j)) || []) {
      if (m.c === n.c) continue; const d = hav(n.p, m.p); if (d < maxD && d < (best.get(m.c)?.[1] ?? Infinity)) best.set(m.c, [m, d]); }
    for (const [m, d] of best.values()) { n.adj.push([m, d]); m.adj.push([n, d]); } });
  if (comp > 1) bridge(120, 1);
  const near = pt => { let best = null, bd = 1500; for (const n of all) { const d = hav(pt, n.p); if (d < bd) { bd = d; best = n; } } return best; };
  const S0 = near(a), T0 = near(b); if (!S0 || !T0) return null;
  const search = () => {
  // Dijkstra with a binary heap
  const dist = new Map([[S0, 0]]), prev = new Map(), H = [[0, S0]];
  const push = x => { H.push(x); let i = H.length - 1; while (i) { const p = (i - 1) >> 1; if (H[p][0] <= H[i][0]) break; [H[p], H[i]] = [H[i], H[p]]; i = p; } };
  const pop = () => { const top = H[0], last = H.pop(); if (H.length) { H[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
    if (l < H.length && H[l][0] < H[m][0]) m = l; if (r < H.length && H[r][0] < H[m][0]) m = r; if (m === i) break; [H[m], H[i]] = [H[i], H[m]]; i = m; } } return top; };
  while (H.length) { const [d, u] = pop(); if (u === T0) break; if (d > (dist.get(u) ?? Infinity)) continue;
    for (const [v, w] of u.adj) { const nd = d + w; if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); push([nd, v]); } } }
  if (!dist.has(T0)) return null;
  const out = []; for (let u = T0; u; u = prev.get(u)) out.push(u.p);
  out.reverse(); return [a, ...out, b];
  };
  return search() || (comp > 1 ? (bridge(300, 2), search()) : null);   // second try: bridge gaps up to 300 m
}
async function fetchRail(line, a, b) {
  const re = RAIL_NAMES[line]; if (!re) return null;
  const pad = 0.04, bb = [Math.min(a[1], b[1]) - pad, Math.min(a[0], b[0]) - pad, Math.max(a[1], b[1]) + pad, Math.max(a[0], b[0]) + pad].map(r5).join(',');
  const rt = '["route"~"^(subway|train|light_rail|railway|monorail)$"]';
  const q = `[out:json][timeout:90];(rel${rt}["name"~"${re}",i](${bb});rel${rt}["name:en"~"${re}",i](${bb}););way(r)["railway"~"^(rail|subway|light_rail|narrow_gauge|monorail)$"];out geom;`;
  const j = await (await fetch(OVERPASS + encodeURIComponent(q))).json();
  return railPath(j.elements || [], a, b);
}
let lastOsrm = 0;
async function fetchRoad(kind, a, b) {
  const wait = lastOsrm + 1100 - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait)); lastOsrm = Date.now();   // 1 req/s policy
  const j = await (await fetch(`${OSRM[kind]}${a[0]},${a[1]};${b[0]},${b[1]}?overview=full&geometries=geojson${kind === 'foot' ? '&steps=true' : ''}`)).json();
  const r = j.routes?.[0]; if (!r) return { g: null };
  const dir = kind === 'foot' ? (r.legs?.[0]?.steps || []).slice(0, 40).map(x => ({ t: x.maneuver?.type || '', m: x.maneuver?.modifier || '', b: x.maneuver?.bearing_after || 0, n: x.name || x.ref || '', d: Math.round(x.distance || 0) })) : null;
  return { g: r.geometry?.coordinates || null, dir };
}
/* turn-by-turn for walks (v1.17) — OSRM foot steps, kept with the route */
const dirKey = sig => 'dir|' + sig;
const needsRoute = j => !ROUTES[j.sig] || (j.kind === 'foot' && !ROUTES[dirKey(j.sig)]);
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
function dirText(x) {
  const onto = x.n ? ` onto <b>${esc(x.n)}</b>` : '', on = x.n ? ` on <b>${esc(x.n)}</b>` : '';
  switch (x.t) {
    case 'depart': return `Head ${COMPASS[Math.round(x.b / 45) % 8]}${on}`;
    case 'arrive': return `Arrive${x.m && /left|right/.test(x.m) ? ` — it's on your ${x.m.replace('slight ', '').replace('sharp ', '')}` : ''}`;
    case 'turn': case 'end of road': case 'merge': case 'on ramp': case 'off ramp':
      if (x.m === 'straight') return `Go straight on${onto}`;
      if (x.m === 'uturn') return 'Turn back';
      return `${x.t === 'end of road' ? 'At the end, turn' : 'Turn'} ${x.m}${onto}`;
    case 'fork': return `Keep ${(x.m || 'straight').replace('slight ', '')}${onto}`;
    case 'roundabout': case 'rotary': case 'roundabout turn': return `At the roundabout, take the exit${onto}`;
    default: return `Continue${onto}`;
  }
}
const dirIcon = x => x.t === 'depart' ? '⬆' : x.t === 'arrive' ? '📍' : /uturn/.test(x.m) ? '↩' : /left/.test(x.m) ? (/slight/.test(x.m) ? '↖' : '⬅') : /right/.test(x.m) ? (/slight/.test(x.m) ? '↗' : '➡') : '⬆';
function routeStore(mode, fn) { return new Promise(res => { if (!idb || !idb.objectStoreNames.contains('r')) return res(null);
  const tx = idb.transaction('r', mode), r = fn(tx.objectStore('r')); tx.oncomplete = () => res(r?.result); tx.onerror = () => res(null); }); }
async function loadRoutes() {
  if (!idb) await idbOpen(); if (!idb || !idb.objectStoreNames.contains('r')) return;
  await new Promise(res => { const c = idb.transaction('r').objectStore('r').openCursor(); c.onsuccess = () => { const cur = c.result; if (cur) { ROUTES[cur.key] = cur.value; cur.continue(); } else res(); }; c.onerror = res; });
}
// what to draw for one day: train/taxi legs + walking hops between that day's places
function dayRouteJobs(iso) { return buildGuide(iso).steps.flatMap(st => st.jobs); }
const routeBusy = new Set(), routeFailed = new Set();
async function ensureRoutes(jobs, onEach) {
  let got = 0, failed = 0;
  for (const j of jobs) {
    if (!needsRoute(j) || routeBusy.has(j.sig) || routeFailed.has(j.sig)) continue;
    if (!navigator.onLine) break;
    routeBusy.add(j.sig);
    try {
      const r = j.kind === 'rail' ? { g: await fetchRail(j.line, j.a, j.b) } : await fetchRoad(j.kind, j.a, j.b), g = r.g;
      if (g && g.length > 1) { ROUTES[j.sig] = simplify(g); routeStore('readwrite', st => st.put(ROUTES[j.sig], j.sig));
        if (r.dir) { ROUTES[dirKey(j.sig)] = r.dir; routeStore('readwrite', st => st.put(r.dir, dirKey(j.sig))); }
        got++; }
      else { routeFailed.add(j.sig); failed++; }
    } catch { routeFailed.add(j.sig); failed++; }            // don't retry this session — avoids hammering free servers
    routeBusy.delete(j.sig); onEach && onEach(got, failed);
  }
  return { got, failed };
}

/* ---------- station exits (v1.15) ---------- */
// Station entrances/exits come from OpenStreetMap (railway=subway_entrance / train_station_entrance, with ref like "A4").
// Looked up once per station when online and kept in IndexedDB with the routes. A leg can pin an exit with fromExit / toExit;
// otherwise the exit nearest to where you're coming from / going to is chosen.
const exKey = pt => 'ex|' + r5(pt[1]) + ',' + r5(pt[0]);
const exitsAt = pt => ROUTES[exKey(pt)] || null;
const exitRef = e => e ? (e.ref || e.name || '') : '';
function pickExit(stPt, want, towards) {
  const ex = exitsAt(stPt); if (!ex || !ex.length) return null;
  if (want) { const w = String(want).replace(/^exit\s*/i, '').trim().toLowerCase();
    const m = ex.find(e => (e.ref || '').toLowerCase() === w) || ex.find(e => (e.name || '').toLowerCase().includes(w)); if (m) return { ...m, fixed: true }; }
  if (!towards) return null;
  return ex.reduce((b, e) => !b || hav(e.pt, towards) < hav(b.pt, towards) ? e : b, null);
}
const exitBusy = new Set(), exitFailed = new Set();
async function ensureExits(pts, onEach) {
  let got = 0;
  for (const pt of pts) {
    const k = exKey(pt); if (ROUTES[k] || exitBusy.has(k) || exitFailed.has(k)) continue;
    if (!navigator.onLine) break;
    exitBusy.add(k);
    try {
      const q = `[out:json][timeout:25];node(around:450,${r5(pt[1])},${r5(pt[0])})["railway"~"^(subway_entrance|train_station_entrance)$"];out;`;
      const j = await (await fetch(OVERPASS + encodeURIComponent(q))).json();
      if (!j || !Array.isArray(j.elements)) throw new Error('bad');
      const ex = j.elements.map(n => ({ ref: n.tags?.ref || '', name: n.tags?.['name:en'] || n.tags?.name || '', pt: [r5(n.lon), r5(n.lat)] })).filter(e => e.ref || e.name);
      ROUTES[k] = ex; routeStore('readwrite', st => st.put(ex, k)); got++;   // [] = looked, none mapped
      exitBusy.delete(k); onEach && onEach();
    } catch { exitFailed.add(k); exitBusy.delete(k); }       // failed: no redraw, no retry this session
  }
  return got;
}
const railStationsOf = iso => S.transit.filter(t => t.date === iso && (t.mode === 'train' || t.mode === 'subway') && t.fromLat && t.toLat)
  .flatMap(t => [[+t.fromLng, +t.fromLat], [+t.toLng, +t.toLat]]);
// fetch exits for a day, then any new walking routes they create; call back when something changed
const exitPending = pt => { const k = exKey(pt); return !ROUTES[k] && !exitFailed.has(k) && !exitBusy.has(k); };
const routePending = j => needsRoute(j) && !routeFailed.has(j.sig) && !routeBusy.has(j.sig);
const dayNeedsExtras = iso => navigator.onLine && (railStationsOf(iso).some(exitPending) || dayRouteJobs(iso).some(routePending));
function ensureDayExtras(iso, cb) {
  if (!navigator.onLine) return;
  const pts = railStationsOf(iso).filter(exitPending);
  const go = () => { const jobs = dayRouteJobs(iso).filter(routePending); if (jobs.length) ensureRoutes(jobs, (g, f) => { if (g) cb && cb(); }); };
  if (pts.length) ensureExits(pts).then(got => { if (got) cb && cb(); go(); }); else go();
}
const walkMin = j => { const g = ROUTES[j.sig], m = g ? pathLen(g) : hav(j.a, j.b) * 1.3; return { min: Math.max(1, Math.round(m / WALK_MPS)), m, approx: !g }; };

/* ---------- Japan rail guide ---------- */
// Official line letters/colours. pass = covered by the Tokyo Subway Ticket (Tokyo Metro + Toei only).
const JP_LINES = {
  'Keisei Access Express':     { code: 'KS', op: 'Keisei', pass: false, what: 'Narita Airport ⇄ central Tokyo, runs straight onto the Toei Asakusa Line' },
  'Toei Asakusa Line':         { code: 'A', op: 'Toei Subway', pass: true, what: 'Ningyocho ⇄ Asakusa / Oshiage (Skytree); continues to both airports' },
  'Toei Shinjuku Line':        { code: 'S', op: 'Toei Subway', pass: true, what: 'Shinjuku ⇄ Hamacho' },
  'Hanzomon Line':             { code: 'Z', op: 'Tokyo Metro', pass: true, what: 'Mitsukoshimae ⇄ Omotesando ⇄ Shibuya' },
  'Fukutoshin Line':           { code: 'F', op: 'Tokyo Metro', pass: true, what: 'Shibuya ⇄ Shinjuku-sanchome ⇄ Ikebukuro' },
  'Ginza Line':                { code: 'G', op: 'Tokyo Metro', pass: true, what: 'Asakusa ⇄ Ueno ⇄ Suehirocho (Akihabara) ⇄ Ginza ⇄ Shibuya' },
  'Hibiya Line':               { code: 'H', op: 'Tokyo Metro', pass: true, what: 'Akihabara ⇄ Ningyocho ⇄ Ginza ⇄ Roppongi' },
  'Keikyu (via Asakusa Line)': { code: 'KK', op: 'Keikyu', pass: false, what: 'Through-trains from the Asakusa Line to Haneda Airport' }
};
const PASS_72H = 1500;
const region = t => { const la = +t.fromLat || +t.toLat, ln = +t.fromLng || +t.toLng; return !la ? '' : ln < 20 ? 'uk' : la < 25 ? 'th' : 'jp'; };
const yen = n => '¥' + Math.round(n).toLocaleString('en-GB');
const jpyGbp = n => money(n / (S.rates.JPY || 209));
function lineBadge(line, color) {
  const m = JP_LINES[line]; const code = m ? m.code : '';
  return code ? `<span class="lbadge" style="--lc:${color}">${code}</span>` : '';
}
function japanRail() {
  const legs = S.transit.filter(t => region(t) === 'jp').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  if (!legs.length) return '<div class="empty">No Japan journeys yet.</div>';
  const paid = legs.filter(t => +t.fareJPY);
  const total = paid.reduce((a, t) => a + +t.fareJPY, 0);
  const passLegs = paid.filter(t => JP_LINES[t.line]?.pass && inPass(t.date));
  const passSum = passLegs.reduce((a, t) => a + +t.fareJPY, 0);
  const suicaSum = paid.filter(t => !passLegs.includes(t)).reduce((a, t) => a + +t.fareJPY, 0);
  const diff = passSum - PASS_72H;
  const usedLines = [...new Set(legs.map(t => t.line))].filter(l => JP_LINES[l]);
  return `
    <div class="card"><div class="row"><div class="grow"><div class="small muted">All Japan train fares (pay as you go)</div>
      <h3 style="font-size:22px">${yen(total)} <span class="muted" style="font-size:15px">≈ ${jpyGbp(total)}</span></h3></div>
      <div style="text-align:right"><div class="small muted">Rides</div><b style="font-size:18px">${legs.length}</b></div></div>
      <div class="small muted">£1 = ¥${S.rates.JPY} · IC-card (Suica) fares · edit the rate in More</div></div>

    <div class="card passcheck ${diff >= 0 ? 'win' : 'lose'}">
      <h3>72h Tokyo Subway Ticket — worth it?</h3>
      <div class="pc-row"><span>Subway rides ${fmtDay(passWin().from).replace(/^\w+ /, '')} – ${fmtDay(passWin().to).replace(/^\w+ /, '')} on Suica</span><b>${yen(passSum)} · ${jpyGbp(passSum)}</b></div>
      <div class="pc-row"><span>72h pass</span><b>${yen(PASS_72H)} · ${jpyGbp(PASS_72H)}</b></div>
      <div class="pc-verdict">${diff >= 0
        ? `Pass saves you ${yen(diff)} (${jpyGbp(diff)}) — and every extra ride is free.`
        : `Right now Suica is ${yen(-diff)} (${jpyGbp(-diff)}) cheaper. Another ${yen(-diff)} of subway rides in those 3 days and the pass wins. Hop-on-hop-off freedom is the other reason to buy it.`}</div>
      <div class="small muted" style="margin-top:6px">Airport trains (Keisei, Keikyu) aren't covered — put ${yen(suicaSum)} (${jpyGbp(suicaSum)}) on your Suica for those.</div>
    </div>

    <div class="sec"><h2>Lines you'll use</h2></div>
    <div class="card">${usedLines.map(l => { const m = JP_LINES[l], c = LINES[l] || '#888';
      const n = legs.filter(t => t.line === l).length;
      return `<div class="lrow"><span class="lbadge big" style="--lc:${c}">${m.code}</span><div class="grow">
        <b>${esc(l)}</b> <span class="small muted">· ${m.op}</span><div class="small muted">${esc(m.what)}</div></div>
        <div style="text-align:right"><span class="tag ${m.pass ? 'ok' : 'warn'}">${m.pass ? '72h pass' : 'Suica'}</span><div class="small muted">${n} ride${n > 1 ? 's' : ''}</div></div></div>`; }).join('')}
    </div>

    <div class="sec"><h2>Your routes</h2></div>
    ${legs.map(t => { const m = JP_LINES[t.line];
      return `<div class="card jroute" style="--lc:${t.color}" data-edit="transit" data-id="${t.id}">
        <div class="row"><div class="grow"><div class="small muted">${fmtDay(t.date)} · ${esc(t.time)}</div>
          <div class="jline">${lineBadge(t.line, t.color)}<b>${esc(t.line)}</b></div>
          <div class="jstops"><span>${esc(t.from)} <span class="code">${esc(t.fromCode)}</span></span><span class="jarrow">→</span><span>${esc(t.to)} <span class="code">${esc(t.toCode)}</span></span></div></div>
        <div class="jfare">${+t.fareJPY ? `<b>${t.approx ? '≈' : ''}${yen(t.fareJPY)}</b><span>${jpyGbp(t.fareJPY)}</span>` : '<b>—</b>'}
          <span class="tag ${m?.pass && inPass(t.date) ? 'ok' : 'warn'}">${m?.pass && inPass(t.date) ? 'pass' : 'Suica'}</span></div></div>
        <div class="jmeta"><span>⏱ ${esc(t.dur || '—')}</span>${t.board ? `<span>▶ ${esc(t.board)}</span>` : ''}</div>
      </div>`; }).join('')}
    <p class="small muted">Fares: Tokyo Metro & Toei official IC fares (March 2026). ≈ = depends on exact distance/train — check the fare screen on the day.</p>`;
}

/* ---------- Guide: the day as steps (v1.14) ---------- */
// Steps = hotel you woke up in → each place / ticket / flight / check-in in time order → hotel tonight.
// Between steps: the trains/taxis you booked, or a walk (real footpath route when we have it).
let gmap = null;
const WALK_MPS = 80;                       // metres per minute (~4.8 km/h)
const lineChip = t => `<span class="lchip" style="--lc:${t.color || '#8fa0b1'}">${JP_LINES[t.line]?.code || (CAT[t.mode] || CAT.train)[1]}</span>`;
const ptOf = o => (o && o.lat != null && o.lat !== '' && !isNaN(o.lat)) ? [+o.lng, +o.lat] : null;
const pathLen = g => g.reduce((a, p, i) => i ? a + hav(g[i - 1], p) : 0, 0);
const fmtKm = m => m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
function guideDays() { return days().filter(d => buildGuide(d).steps.length > 1); }
function buildGuide(iso) {
  const live = S.stays.filter(s => !/cancel/.test(s.status));
  const lastNight = live.find(s => s.checkIn < iso && iso <= s.checkOut);
  const tonight = live.find(s => s.checkIn <= iso && iso < s.checkOut);
  const steps = [];
  if (lastNight) steps.push({ kind: 'hotel', o: lastNight, name: lastNight.name, sub: iso === lastNight.checkOut ? `check out${lastNight.outTime ? ' by ' + lastNight.outTime : ''}` : 'start of the day', time: iso === lastNight.checkOut ? (lastNight.leave || lastNight.outTime || '') : '', pt: ptOf(lastNight), emoji: '🏨', legs: [] });
  let legs = [];
  // a check-in belongs after the trains/taxis that actually take you to the hotel
  const items = dayItems(iso);
  for (let k = 0; k < items.length; k++) {
    const it = items[k]; if (it.k !== 'stay' || it.o.checkIn !== iso || !ptOf(it.o)) continue;
    let last = -1; items.forEach((x, j) => { if (x.k === 'transit' && x.o.toLat && hav([+x.o.toLng, +x.o.toLat], ptOf(it.o)) < 1500) last = j; });
    if (last > k && !it._moved) { it._moved = true; items.splice(k, 1); items.splice(last, 0, it); k--; }
  }
  if (!lastNight && items[0]?.k === 'transit' && items[0].o.fromLat) { const t0 = items[0].o;
    steps.push({ kind: 'start', o: { name: t0.from, lat: t0.fromLat, lng: t0.fromLng }, name: t0.from, sub: 'start of the day', time: t0.time || '', pt: [+t0.fromLng, +t0.fromLat], emoji: '🚉', legs: [] }); }
  for (const it of items) {
    if (it.k === 'transit') { legs.push(it.o); continue; }
    if (it.k === 'stay' && it.o.checkOut === iso) continue;                       // the check-out is the first step already
    if (it.k === 'flight') { const prev = legs[legs.length - 1]; steps.push({ kind: 'flight', o: it.o, name: it.title, sub: it.sub, time: it.t, pt: prev ? [+prev.toLng, +prev.toLat] : null, emoji: '✈️', legs }); legs = []; continue; }
    if (it.k === 'stay') { steps.push({ kind: 'hotel', o: it.o, name: it.o.name, sub: `check in${it.o.inTime ? ' from ' + it.o.inTime : ''}`, time: it.t, pt: ptOf(it.o), emoji: '🏨', legs, checkin: true }); legs = []; continue; }
    const o = it.o, ticket = it.k === 'place' ? S.bookings.find(b => b.place === o.id && b.status !== 'cancelled') : (it.k === 'book' ? o : null);
    steps.push({ kind: it.k, o, name: o.name, sub: o.local || o.area || '', time: it.t, pt: ptOf(o), emoji: emojiFor(o, it.k), legs, ticket }); legs = [];
  }
  const last = steps[steps.length - 1];
  if (tonight && (legs.length || (last && !(last.kind === 'hotel' && last.o === tonight)))) {
    if (!(steps.length === 1 && steps[0].o === tonight)) steps.push({ kind: 'hotel', o: tonight, name: tonight.name, sub: 'back to the hotel', time: '', pt: ptOf(tonight), emoji: '🏨', legs, end: true });
  }
  // walking/road jobs for gaps with no booked transport
  const walkJob = (a, b, role, extra) => ({ kind: 'foot', a, b, sig: sigOf('foot', '', a, b), leg: false, walk: true, role, ...extra });
  const near = (a, b) => a && b && hav(a, b) >= 40 && hav(a, b) <= 3000;
  steps.forEach((s, i) => {
    const prev = steps[i - 1]; s.jobs = [];
    let cur = prev && prev.kind !== 'flight' && prev.kind !== 'start' ? prev.pt : null, lastExit = null, lastStation = '';
    s.legs.forEach((t, li) => {
      const k = legKind(t); if (!k || !t.fromLat || !t.toLat) return;
      const A = [+t.fromLng, +t.fromLat], B = [+t.toLng, +t.toLat], rail = k === 'rail';
      const nextT = s.legs[li + 1], target = nextT && nextT.fromLat ? [+nextT.fromLng, +nextT.fromLat] : s.pt;
      const exIn = rail ? pickExit(A, t.fromExit, cur || A) : null, exOut = rail ? pickExit(B, t.toExit, target) : null;
      const door = exIn ? exIn.pt : A;
      if (near(cur, door)) s.jobs.push(walkJob(cur, door, li ? 'change' : 'to', { station: t.from, exit: exIn, after: lastStation, outExit: li ? lastExit : null, nextLine: t.line }));
      s.jobs.push({ kind: k, line: t.line, a: A, b: B, sig: sigOf(k, t.line, A, B), color: t.color, leg: true, t, exIn, exOut });
      cur = exOut ? exOut.pt : B; lastExit = exOut; lastStation = t.to;
    });
    if (s.legs.length && near(cur, s.pt)) s.jobs.push(walkJob(cur, s.pt, 'from', { station: lastStation, exit: lastExit }));
    if (prev && !s.legs.length && prev.pt && s.pt && prev.kind !== 'flight') {
      const d = hav(prev.pt, s.pt); if (d < 30 || d > 60000) return;
      const k = d > 3000 ? 'car' : 'foot';
      s.jobs.push({ kind: k, a: prev.pt, b: s.pt, sig: sigOf(k, '', prev.pt, s.pt), leg: false, walk: k === 'foot' });
    }
  });
  // v1.17: the walk to the station, the ride, and the walk from the station become their own guided steps
  const out = [];
  steps.forEach(s => {
    const wTo = s.jobs.find(j => j.walk && j.role === 'to'), wFrom = s.jobs.find(j => j.walk && j.role === 'from');
    if (!s.legs.length || (!wTo && !wFrom)) { out.push(s); return; }
    const ride = s.jobs.filter(j => j !== wTo && j !== wFrom), legJ = ride.filter(j => j.leg), lastJ = legJ[legJ.length - 1];
    const rail = s.legs.some(t => t.mode === 'train' || t.mode === 'subway'), t0 = s.legs[0], tN = s.legs[s.legs.length - 1];
    if (wTo) out.push({ kind: 'walk', role: 'to', o: { name: wTo.station }, name: `Walk to ${wTo.station}`, sub: wTo.exit ? `go in at Exit ${exitRef(wTo.exit)}` : (rail ? 'to the station' : 'to the pick-up'), time: '', pt: wTo.b, emoji: '🚶', legs: [], jobs: [wTo], w: wTo, then: t0 });
    out.push({ kind: 'ride', o: { name: tN.to }, name: `${s.legs.every(t => t.mode === 'train' || t.mode === 'subway') ? 'Train' : s.legs.length > 1 ? 'Journey' : ({ taxi: 'Taxi', bus: 'Bus', ferry: 'Ferry', walk: 'Walk' }[t0.mode] || 'Ride')} to ${tN.to}`, sub: s.legs.map(t => t.line).filter((x, i, a) => a.indexOf(x) === i).join(' → '), time: t0.time || '', pt: lastJ ? (lastJ.exOut ? lastJ.exOut.pt : lastJ.b) : s.pt, emoji: rail ? '🚆' : (CAT[t0.mode] || CAT.taxi)[1], legs: s.legs, jobs: ride });
    if (wFrom) out.push({ kind: 'walk', role: 'from', o: { name: s.name }, name: `Walk to ${s.name}`, sub: wFrom.exit ? `leave ${wFrom.station} by Exit ${exitRef(wFrom.exit)}` : `from ${wFrom.station}`, time: '', pt: s.pt, emoji: '🚶', legs: [], jobs: [wFrom], w: wFrom, dest: s });
    out.push(Object.assign(s, { legs: [], jobs: [], walked: !!wFrom }));
  });
  return { steps: out, iso };
}
function legSummary(s) {
  if (s.legs.length) {
    const known = s.legs.every(t => /\d/.test(t.dur || '') && !/h/.test(t.dur));
    const mins = known ? s.legs.map(t => parseInt((t.dur || '').replace(/[^0-9]/g, '')) || 0).reduce((a, b) => a + b, 0) : 0;
    const rail = s.legs.filter(t => t.mode === 'train' || t.mode === 'subway');
    const label = rail.length ? `${rail.map(lineChip).join('')} ${esc(s.legs[0].from)} → ${esc(s.legs[s.legs.length - 1].to)}` : `${(CAT[s.legs[0].mode] || CAT.taxi)[1]} ${esc(s.legs[0].line)}`;
    const fare = s.legs.filter(t => +t.fareJPY).reduce((a, t) => a + +t.fareJPY, 0);
    const first = s.legs[0], lastL = s.legs[s.legs.length - 1];
    const when = mins ? ` · ${mins} min` : s.legs.length === 1 && first.dur ? ' · ' + esc(first.dur) : (first.time && (lastL.arr || lastL.time) ? ` · ${esc(first.time)} → ${esc(lastL.arr || lastL.time)}` : ` · ${s.legs.length} legs`);
    const exO = s.jobs.filter(j => j.leg && j.exOut).pop(), walks = s.jobs.filter(j => j.walk);
    const wm = walks.reduce((a, j) => a + walkMin(j).min, 0);
    return `${label}${when}${fare ? ' · ' + yen(fare) : ''}${exO ? ` · exit ${esc(exitRef(exO.exOut))}` : ''}${wm ? ` · 🚶 ${wm} min` : ''}`;
  }
  const j = s.jobs[0]; if (!j) return '';
  const g = ROUTES[j.sig], m = g ? pathLen(g) : hav(j.a, j.b) * 1.3;
  return j.walk ? `🚶 ${Math.max(1, Math.round(m / WALK_MPS))} min walk · ${fmtKm(m)}${g ? '' : ' (approx.)'}` : `🚕 ~${fmtKm(m)} — taxi or Grab`;
}
const stepDone = (g, i) => { const s = g.steps[i]; if (s.kind === 'place') return !!s.o.done; return g.steps.slice(i + 1).some(x => x.kind === 'place' && x.o.done); };
function guideList() {
  const ds = guideDays(); if (!ds.length) return '<div class="empty">Nothing to guide yet — add places to a day.</div>';
  if (!views._gDay || !ds.includes(views._gDay)) views._gDay = ds.includes(today()) ? today() : (ds.find(d => d >= today()) || ds[0]);
  const g = buildGuide(views._gDay), here = views._gDay === today() ? g.steps.findIndex((s, i) => !stepDone(g, i)) : -1;
  return `<div class="chips">${ds.map(d => `<button class="chip ${d === views._gDay ? 'on' : ''}" data-gday="${d}">${fmtDay(d)}<small>${where(d)}</small></button>`).join('')}</div>
    <div class="gsteps">${g.steps.map((s, i) => s.kind === 'walk' || s.kind === 'ride' ? `
      <div class="gstep mini ${s.kind}" data-gstep="${i}" style="--lc:${s.legs[0]?.color || 'var(--accent)'}">
        <div class="gnum sm ${stepDone(g, i) ? 'done' : ''} ${i === here ? 'here' : ''}">${stepDone(g, i) ? '✓' : i + 1}</div>
        <div class="gminic ${i === here ? 'here' : ''}"><div class="grow"><b>${s.emoji} ${esc(s.name)}</b><div class="small muted">${s.kind === 'walk' ? `${walkMin(s.w).min} min · ${fmtKm(walkMin(s.w).m)}${s.w.exit ? ` · Exit <span class="exb">${esc(exitRef(s.w.exit))}</span>` : ''}` : legSummary(s)}${i === here ? ' · <span style="color:var(--accent)">next up</span>' : ''}</div></div><span class="muted">›</span></div>
      </div>` : `
      ${i && (s.legs.length || s.jobs.length) ? `<div class="gleg ${s.legs.some(t => t.mode === 'train' || t.mode === 'subway') ? 'rail' : ''}" style="--lc:${s.legs[0]?.color || 'var(--line)'}">${legSummary(s)}</div>` : ''}
      <div class="gstep" data-gstep="${i}">
        <div class="gnum ${stepDone(g, i) ? 'done' : ''} ${i === here ? 'here' : ''}">${stepDone(g, i) ? '✓' : i + 1}</div>
        <div class="gcard ${i === here ? 'here' : ''}">${photoOf(s.o) ? `<img class="gthumb" src="${esc(photoOf(s.o))}" alt="" loading="lazy" onerror="this.outerHTML='<span class=gthumb>${s.emoji}</span>'">` : `<span class="gthumb">${s.emoji}</span>`}
          <div class="grow"><h3>${esc(s.name)} ${s.ticket ? '<span class="tag ok">🎟</span>' : ''}</h3><div class="small muted">${esc([s.sub, s.time].filter(Boolean).join(' · '))}${i === here ? ' · <span style="color:var(--accent)">next up</span>' : ''}</div></div>
          <span class="muted">›</span></div>
      </div>`).join('')}</div>
    <p class="small muted" style="text-align:center;margin-top:10px">Tap any stop for the map from the stop before, info and directions.</p>`
    + (setTimeout(() => { if (dayNeedsExtras(views._gDay)) { const day = views._gDay; let t;
        ensureDayExtras(day, () => { clearTimeout(t); t = setTimeout(() => { if (tab === 'guide' && views._gStep == null && views._gDay === day) { const sc = $('#view').scrollTop; render(); $('#view').scrollTop = sc; } }, 400); }); } }, 0), '');
}
function guideStep() {
  const g = buildGuide(views._gDay), i = Math.min(views._gStep, g.steps.length - 1), s = g.steps[i], next = g.steps[i + 1], o = s.o;
  const isRide = s.kind === 'ride';
  const ticket = s.ticket, photo = s.kind === 'ride' ? '' : photoOf(o);
  const about = o.about || '';
  const facts = [];
  if (s.time) facts.push(`🕒 ${esc(s.time)}`);
  if (o.area) facts.push(`📍 ${esc(o.area)}`);
  if (s.kind === 'hotel' && o.address) facts.push(`📍 ${esc(o.address)}`);
  if (s.kind === 'hotel' && o.ref) facts.push(`Ref ${esc(o.ref)}`);
  if (ticket) facts.push(`🎟 ${esc(ticket.name)}${ticket.time ? ' · ' + esc(ticket.time) : ''}`);
  if (next) facts.push(`➡ next: ${esc(next.name)}`);
  const exBadge = e => e ? `<span class="exb">${esc(exitRef(e))}</span>` : '';
  const walkRow = j => { const w = walkMin(j); const t = `${w.min} min · ${fmtKm(w.m)}${w.approx ? ' (approx.)' : ''}`;
    if (j.role === 'to') return `<div class="gwalk">🚶 <div><b>Walk to ${esc(j.station)}</b>${j.exit ? ` — go in at Exit ${exBadge(j.exit)}${j.exit.fixed ? '' : ' <span class="muted">(nearest)</span>'}` : ''}<div class="small muted">${t}</div></div></div>`;
    if (j.role === 'change') return `<div class="gwalk">🔁 <div><b>Change at ${esc(j.after || j.station)}</b>${j.outExit ? ` — leave by Exit ${exBadge(j.outExit)}` : ''}, walk to the ${esc(j.nextLine || j.station)}${j.exit ? ` entrance ${exBadge(j.exit)}` : ''}<div class="small muted">${t}</div></div></div>`;
    return `<div class="gwalk">🚶 <div><b>${j.exit ? `Leave ${esc(j.station)} by Exit ${exBadge(j.exit)}` : `From ${esc(j.station)}`}</b>${j.exit && !j.exit.fixed ? ' <span class="muted small">(nearest to here)</span>' : ''} → walk to ${esc(s.name)}<div class="small muted">${t}</div></div></div>`; };
  const legsHtml = s.walked ? `<div class="gwalk">🚶 <div>You walked here from <b>${esc(g.steps[i - 1].w.station)}</b> — step ${i}</div></div>` : s.legs.length ? `<div class="sec"><h2>${isRide ? 'Your trains' : 'Getting here'}</h2></div>${s.jobs.map(j => j.walk ? walkRow(j) : (j.t ? transitCard(j.t) + (j.exOut && !s.jobs.some(x => x.walk && (x.exit === j.exOut || x.outExit === j.exOut)) ? `<div class="gwalk">🚪 <div>Exit ${exBadge(j.exOut)} at ${esc(j.t.to)}</div></div>` : '') : '')).join('')}${exitsAt([+s.legs[0].fromLng, +s.legs[0].fromLat]) === null && s.legs.some(t => t.mode === 'train' || t.mode === 'subway') ? `<p class="small muted">${navigator.onLine ? 'Looking up station exits…' : 'Station exits load next time you are online.'}</p>` : ''}` : (s.jobs[0] ? `<div class="sec"><h2>Getting here</h2></div><div class="card small">${legSummary(s)}${g.steps[i - 1] ? ` from <b>${esc(g.steps[i - 1].name)}</b>` : ''}</div>` : '');
  if (s.kind === 'walk') {
    const w = walkMin(s.w), dir = ROUTES[dirKey(s.w.sig)], from = g.steps[i - 1];
    const firstRow = s.role === 'from' && s.w.exit ? `<li><span class="di">🚪</span><div>Leave <b>${esc(s.w.station)}</b> by Exit ${exBadge(s.w.exit)}${s.w.exit.fixed ? '' : ' <span class="muted small">(nearest to here)</span>'}</div></li>` : '';
    const lastRow = s.role === 'to'
      ? `<li><span class="di">🚉</span><div>${s.w.exit ? `Go in at Exit ${exBadge(s.w.exit)}${s.w.exit.fixed ? '' : ' <span class="muted small">(nearest)</span>'} — ` : ''}<b>${esc(s.w.station)}</b>${s.then ? `<div class="small muted">then ${lineChip(s.then)} ${esc(s.then.line)}${s.then.time ? ' · ' + esc(s.then.time) : ''}</div>` : ''}</div></li>`
      : `<li><span class="di">${s.dest.emoji}</span><div>Arrive at <b>${esc(s.dest.name)}</b>${s.dest.o.local ? ` <span class="muted">${esc(s.dest.o.local)}</span>` : ''}</div></li>`;
    const mid = dir && dir.length ? dir.filter(x => x.t !== 'arrive').map(x => `<li><span class="di">${dirIcon(x)}</span><div>${dirText(x)}${x.d ? `<span class="muted small"> · ${fmtKm(x.d)}</span>` : ''}</div></li>`).join('')
      : `<li><span class="di">🚶</span><div>Walk ${fmtKm(w.m)}${from ? ` from <b>${esc(s.role === 'from' ? s.w.station : from.name)}</b>` : ''}<div class="small muted">${navigator.onLine ? 'Loading turn-by-turn directions…' : 'Turn-by-turn directions load next time you are online — follow the red dotted line.'}</div></div></li>`;
    return `<div class="gmapwrap"><div id="gmap"></div>
      <div class="gover"><button class="gpill" data-gback>‹ ${fmtDay(g.iso)}</button><span class="gpill">🚶 ${w.min} min · ${fmtKm(w.m)}${w.approx ? ' (approx.)' : ''}</span></div></div>
    <div class="gsheet">
      <div class="row" style="justify-content:space-between;margin-bottom:6px"><span class="tag warn">Step ${i + 1} of ${g.steps.length}</span><span class="small muted">walking</span></div>
      <h2 class="gtitle">🚶 ${esc(s.name)}</h2>
      <div class="gfacts"><span>⏱ ${w.min} min</span><span>📏 ${fmtKm(w.m)}${w.approx ? ' (approx.)' : ''}</span>${s.w.exit ? `<span>🚪 Exit ${esc(exitRef(s.w.exit))}</span>` : ''}${next ? `<span>➡ next: ${esc(next.name)}</span>` : ''}</div>
      <ol class="gdir">${firstRow}${mid}${lastRow}</ol>
    </div>
    <div class="gnav"><button class="btn" data-gstep="${i - 1}" ${i ? '' : 'disabled'}>‹ Step ${i}</button>
      ${s.pt ? `<a class="btn" href="${navLink(s.pt[1], s.pt[0])}">Navigate</a>` : '<span></span>'}
      <button class="btn pri" data-gstep="${i + 1}" ${next ? '' : 'disabled'}>${next ? `Step ${i + 2} ›` : 'Done ✓'}</button></div>`;
  }
  return `<div class="gmapwrap"><div id="gmap"></div>
      <div class="gover"><button class="gpill" data-gback>‹ ${fmtDay(g.iso)}</button>${i ? `<span class="gpill">${legSummary(s) || 'start'}</span>` : '<span class="gpill">start of the day</span>'}</div></div>
    <div class="gsheet">
      <div class="row" style="justify-content:space-between;margin-bottom:6px"><span class="tag warn">Step ${i + 1} of ${g.steps.length}${s.time ? ' · ' + esc(s.time) : ''}</span>${s.kind === 'place' ? `<span class="small muted">${CAT[o.cat]?.[1] || ''} ${CATNAME[o.cat] || ''}</span>` : ''}</div>
      <h2 class="gtitle">${s.emoji} ${esc(s.name)}</h2>
      ${o.local ? `<div class="glocal">${esc(o.local)}</div>` : ''}
      ${photo ? `<div class="pimg gphoto"><img src="${esc(photo)}" alt="" onerror="this.parentNode.remove()">${photoCreditHtml(o)}</div>` : ''}
      ${about ? `<p class="gabout">${esc(about)}</p>` : ''}
      ${o.notes ? `<p class="small" style="color:#cfd8e2;margin:6px 0">${esc(o.notes)}</p>` : ''}
      ${ticket && ticket !== o && ticket.notes ? `<div class="card small"><b>🎟 Ticket:</b> ${esc(ticket.notes)}</div>` : ''}
      ${facts.length ? `<div class="gfacts">${facts.map(f => `<span>${f}</span>`).join('')}</div>` : ''}
      ${legsHtml}
      <div class="row" style="gap:8px;margin-top:10px">
        ${s.kind === 'place' ? `<button class="btn grow" data-gdone="${o.id}">${o.done ? '↺ Not visited' : '✓ Mark visited'}</button>` : ''}
        ${s.kind === 'place' || s.kind === 'book' || s.kind === 'hotel' ? `<button class="btn grow" data-edit="${s.kind === 'hotel' ? 'stay' : s.kind}" data-id="${o.id}">Edit</button>` : ''}
      </div>
    </div>
    <div class="gnav"><button class="btn" data-gstep="${i - 1}" ${i ? '' : 'disabled'}>‹ Step ${i}</button>
      ${s.pt && !isRide ? `<a class="btn" href="${navLink(s.pt[1], s.pt[0])}">Navigate</a>` : '<span></span>'}
      <button class="btn pri" data-gstep="${i + 1}" ${next ? '' : 'disabled'}>${next ? `Step ${i + 2} ›` : 'Done ✓'}</button></div>`;
}
function initGuideMap() {
  if (gmap) { gmap.remove(); gmap = null; }
  const el = $('#gmap'); if (!el) return;
  const day = views._gDay, step = views._gStep;
  const cur = () => { const g = buildGuide(day), i = Math.min(step, g.steps.length - 1); return { s: g.steps[i], prev: g.steps[i - 1] }; };
  let { s, prev } = cur();
  gmap = new maplibregl.Map({ container: el, style: STYLE_URL, center: s.pt || prev?.pt || [120, 20], zoom: 14, attributionControl: { compact: true, customAttribution: 'Routes © OpenStreetMap · OSRM/FOSSGIS' }, dragRotate: false, pitchWithRotate: false });
  gmap.touchZoomRotate.disableRotation();
  const m = gmap; let fitted = false, exitMarkers = [];
  const draw = () => {
    if (gmap !== m || !m.isStyleLoaded()) return;
    ({ s, prev } = cur());
    const feats = s.jobs.map(j => ({ type: 'Feature', properties: { color: j.leg ? (j.color || '#8fa0b1') : '#ff5a4e', walk: j.walk ? 1 : 0 }, geometry: { type: 'LineString', coordinates: ROUTES[j.sig] || [j.a, j.b] } }));
    const data = { type: 'FeatureCollection', features: feats };
    if (m.getSource('g')) m.getSource('g').setData(data);
    else {
      m.addSource('g', { type: 'geojson', data });
      m.addLayer({ id: 'g-case', type: 'line', source: 'g', filter: ['==', ['get', 'walk'], 0], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 8, 'line-opacity': .85 } });
      m.addLayer({ id: 'g-line', type: 'line', source: 'g', filter: ['==', ['get', 'walk'], 0], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 5 } });
      m.addLayer({ id: 'g-walk', type: 'line', source: 'g', filter: ['==', ['get', 'walk'], 1], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ff5a4e', 'line-width': 4.5, 'line-dasharray': [0.2, 2] } });
    }
    exitMarkers.forEach(x => x.remove()); exitMarkers = [];
    s.jobs.forEach(j => [j.exIn, j.exOut, j.walk && j.exit].forEach(e => { if (!e) return; const b = document.createElement('div'); b.className = 'exb map'; b.textContent = exitRef(e);
      exitMarkers.push(new maplibregl.Marker({ element: b }).setLngLat(e.pt).addTo(m)); }));
    if (!fitted) {                                      // frame the route once — never re-zoom while you're looking at it
      const pts = [...feats.flatMap(f => f.geometry.coordinates), ...(s.pt ? [s.pt] : []), ...(prev?.pt ? [prev.pt] : [])];
      if (pts.length > 1) m.fitBounds(pts.reduce((bb, c) => bb.extend(c), new maplibregl.LngLatBounds(pts[0], pts[0])), { padding: { top: 100, bottom: 40, left: 50, right: 50 }, maxZoom: 16, duration: 0 });
      fitted = true;
    }
  };
  // refresh the text under the map in place (exits / walk times) without rebuilding the map
  const refreshSheet = () => {
    if (gmap !== m || tab !== 'guide' || views._gDay !== day || views._gStep !== step) return;
    const tmp = document.createElement('div'); tmp.innerHTML = guideStep();
    const oldS = $('#view .gsheet'), newS = tmp.querySelector('.gsheet'); if (oldS && newS) oldS.replaceWith(newS);
    const oldO = $('#view .gover'), newO = tmp.querySelector('.gover'); if (oldO && newO) oldO.replaceWith(newO);
  };
  let t; const later = () => { clearTimeout(t); t = setTimeout(() => { draw(); refreshSheet(); }, 300); };
  m.on('load', () => { draw(); addStationLayerTo(m); });
  const pinOf = st => st.kind === 'walk' && st.role === 'from' ? st.dest : st.kind === 'walk' || st.kind === 'ride' ? { ...st, kind: 'station', emoji: '🚉', name: st.o.name, o: { cat: 'train' } } : st;
  const pin = (st0, big) => { const st = pinOf(st0); const p = pinEl(st.kind === 'hotel' ? 'stay' : (st.o.cat || 'other'), st.emoji, big ? st.name : '', big ? st.o.local : ''); p.classList.add(big ? 'gbig' : 'gsmall'); return p; };
  if (prev?.pt && !(s.pt && hav(prev.pt, s.pt) < 15)) new maplibregl.Marker({ element: pin(prev, false), anchor: 'bottom' }).setLngLat(prev.pt).addTo(m);
  if (s.pt) new maplibregl.Marker({ element: pin(s, true), anchor: 'bottom' }).setLngLat(s.pt).addTo(m);
  m.getContainer().classList.add('showlabels');
  if (dayNeedsExtras(day)) ensureDayExtras(day, later);
}

/* ---------- views ---------- */
const views = {
  today() {
    const ds = days(), t = today();
    if (!selDay) selDay = (t >= S.trip.start && t <= S.trip.end) ? t : (ds.find(d => dayItems(d).length) || ds[0]);
    const daysTo = Math.ceil((new Date(S.trip.start + 'T00:00:00') - new Date()) / 864e5);
    const spent = S.expenses.reduce((a, e) => a + gbp(e.amount, e.cur), 0);
    const left = S.trip.budget - spent;
    const tripDaysLeft = Math.max(1, Math.ceil((new Date(S.trip.end + 'T00:00:00') - new Date(Math.max(Date.now(), new Date(S.trip.start + 'T00:00:00')))) / 864e5));
    const items = dayItems(selDay), canGuide = buildGuide(selDay).steps.length > 1;
    const row = i => {
      const o = i.o;
      if (i.k === 'transit') {
        const extra = [o.arr ? 'arr ' + o.arr : '', o.dur, +o.fareJPY ? `${o.approx ? '≈' : ''}${yen(o.fareJPY)}` : o.fare].filter(Boolean).join(' · ');
        return `<div class="trow" data-edit="transit" data-id="${o.id}"><span class="time">${esc(o.time || o.arr || '')}</span>${lineChip(o)}<div class="grow"><b>${esc(o.from)} → ${esc(o.to)}</b><div class="small muted">${esc(o.line)}${extra ? ' · ' + esc(extra) : ''}</div></div></div>`;
      }
      if (i.k === 'flight') return `<div class="trow" data-edit="flight" data-id="${o.id}"><span class="time">${esc(i.t)}</span><span class="temo">✈️</span><div class="grow"><b>${esc(i.title)}</b><div class="small muted">${esc(i.sub)}</div></div></div>`;
      if (i.k === 'stay') return `<div class="trow" data-edit="stay" data-id="${o.id}"><span class="time">${esc(i.t)}</span><span class="temo">🏨</span><div class="grow"><b>${esc(i.title.split(' · ')[0])}</b><div class="small muted">${esc(o.name)}</div></div></div>`;
      const gi = buildGuide(selDay).steps.findIndex(st => st.o === o);
      return `<div class="trow ${o.done ? 'done' : ''}" ${gi >= 0 ? `data-gopen="${selDay}:${gi}"` : `data-edit="${i.k}" data-id="${o.id}"`}><span class="time">${esc(i.t)}</span>${photoOf(o) ? `<img class="tthumb" src="${esc(photoOf(o))}" alt="" loading="lazy" onerror="this.outerHTML='<span class=temo>${emojiFor(o, i.k)}</span>'">` : `<span class="temo">${emojiFor(o, i.k)}</span>`}<div class="grow"><b>${esc(i.title)}</b>${i.tag === 'ticket' || i.k === 'book' ? ' <span class="tag ok">🎟</span>' : ''}${o.local ? `<div class="small muted">${esc(o.local)}</div>` : ''}</div><span class="muted">›</span></div>`;
    };
    return `
      <div class="hero2"><div><div class="small muted">${daysTo > 0 ? daysTo + ' days to go · ' : ''}left to spend</div><b>${money(left)}</b> <span class="small muted">· ${money(left / tripDaysLeft)}/day</span></div>
        ${canGuide ? `<button class="btn pri" data-gopen="${selDay}:0">▶ Guide</button>` : ''}</div>
      <div class="chips">${ds.map(d => `<button class="chip ${d === selDay ? 'on' : ''}" data-day="${d}">${fmtDay(d)}<small>${where(d)}</small></button>`).join('')}</div>
      <div class="sec"><h2>${fmtDay(selDay)} · ${where(selDay) || '—'}</h2><div class="row" style="gap:6px"><button class="btn sm" data-add="transit" data-preday="${selDay}">+ Train</button><button class="btn sm" data-add="place" data-preday="${selDay}">+ Place</button></div></div>
      ${items.length ? items.map(row).join('') : `<div class="empty">Nothing planned for this day yet.<br><button class="btn pri block" data-add="place" data-preday="${selDay}">Plan this day</button></div>`}`;
  },

  guide() { return views._gStep != null ? guideStep() : guideList(); },

  trip() {
    const sec = views._tripSec;
    if (sec) {
      const title = { places: 'Places', trains: 'Trains & passes', flights: 'Flights', stays: 'Stays', bookings: 'Tickets & activities', budget: 'Budget', lists: 'Checklists', settings: 'Settings & backup' }[sec];
      const back = `<div class="sec" style="margin-top:0"><button class="btn sm" data-tripsec="">‹ Trip</button><h2>${title}</h2><span></span></div>`;
      if (sec === 'lists') return back + views.lists();
      if (sec === 'settings') return back + views.more();
      views._planSub = sec; views._noPlanChips = true;
      const html = views.plan(); views._noPlanChips = false;
      return back + html;
    }
    const spent = S.expenses.reduce((a, e) => a + gbp(e.amount, e.cur), 0);
    const live = S.stays.filter(x => !/cancel/.test(x.status)).sort((a, b) => a.checkIn.localeCompare(b.checkIn));
    const nextF = S.flights.slice().sort((a, b) => (a.date + a.dep).localeCompare(b.date + b.dep)).find(f => f.date >= today());
    const lists = S.lists.map(l => `${l.name} ${l.items.filter(i => i.done).length}/${l.items.length}`).join(' · ');
    const ideas = S.places.filter(p => !p.day);
    const card = (k, ic, name, sub, extra = '') => `<div class="card tsec" data-tripsec="${k}"><div class="row"><span class="temo">${ic}</span><div class="grow"><h3>${name}</h3><div class="small muted">${sub}</div>${extra}</div><span class="muted">›</span></div></div>`;
    return card('flights', '✈️', 'Flights', `${S.flights.length} booked${nextF ? ` · next: ${esc(nextF.fromCode)} → ${esc(nextF.toCode)} ${fmtDay(nextF.date)} ${esc(nextF.dep || '')}` : ''}`)
      + card('stays', '🏨', 'Stays', `${live.length} booked · ${live.map(x => esc(x.name.split(/ (Beach|Bangkok|Inn|Hotel)/)[0])).join(' · ')}`)
      + card('trains', '🚆', 'Trains & passes', `${S.transit.length} journeys · Japan fares, Suica & pass check`)
      + card('bookings', '🎟', 'Tickets & activities', S.bookings.length ? S.bookings.map(b => `${esc(b.name.split(' — ')[0])} ${fmtDay(b.date)}`).join(' · ') : 'None yet')
      + card('budget', '💷', 'Budget', `${money(spent)} of ${money(S.trip.budget)} spent`, `<div class="bar"><i style="width:${Math.min(100, spent / S.trip.budget * 100)}%"></i></div>`)
      + card('lists', '✓', 'Checklists', esc(lists))
      + card('places', '📍', 'All places', `${S.places.length} places${ideas.length ? ` · ${ideas.length} ideas without a day` : ''}`)
      + (ideas.length ? `<div class="sec"><h2>Ideas for free days</h2></div><div class="card">${ideas.map(p => `<div class="trow flat" data-edit="place" data-id="${p.id}"><span class="temo">${emojiFor(p, 'place')}</span><div class="grow"><b>${esc(p.name)}</b><div class="small muted">${esc(p.area || '')}</div></div><span class="muted">›</span></div>`).join('')}</div>` : '')
      + `<div class="sec"><h2>Settings</h2></div>` + card('settings', '⚙️', 'Settings & backup', 'Backup & import · offline maps · rates & budget');
  },

  plan() {
    const sub = views._planSub || 'places';
    const tabs = [['places', 'Places'], ['trains', 'Trains'], ['flights', 'Flights'], ['stays', 'Stays'], ['bookings', 'Bookings'], ['budget', 'Budget']];
    let body = '';
    if (sub === 'places') {
      const groups = {};
      S.places.forEach(p => (groups[p.day || ''] ??= []).push(p));
      const keys = Object.keys(groups).sort((a, b) => (a || 'z').localeCompare(b || 'z'));
      body = keys.map(k => `<div class="sec"><h2>${fmtDay(k)}${k ? ' · ' + where(k) : ''}</h2></div>` +
        groups[k].sort((a, b) => (a.time || '99').localeCompare(b.time || '99')).map(p => `
        <div class="card pcard ${p.done ? 'done' : ''}" data-edit="place" data-id="${p.id}">${photoOf(p) ? `<div class="pimg"><img src="${esc(photoOf(p))}" alt="" loading="lazy" onerror="this.parentNode.remove()">${photoCreditHtml(p)}</div>` : ''}<div class="row">
          <span class="time">${esc(p.time)}</span><div class="grow"><h3>${CAT[p.cat]?.[1] || ''} ${esc(p.name)}</h3>
          <div class="small muted">${esc([p.area, p.notes].filter(Boolean).join(' · '))}</div></div></div></div>`).join('')).join('')
        || `<div class="empty">No places yet.</div>`;
      body += `<button class="btn pri block" data-add="place">+ Add place</button><p class="small muted">Tip: long-press on the Map to drop a place exactly where it is.</p>`;
    }
    if (sub === 'trains') {
      const rg = views._trainRegion || 'all';
      const chips = `<div class="chips">${[['all', 'All'], ['jp', '🇯🇵 Japan rail'], ['th', '🇹🇭 Thailand'], ['uk', '🇬🇧 UK']].map(([k, n]) => `<button class="chip ${rg === k ? 'on' : ''}" data-trainregion="${k}">${n}</button>`).join('')}</div>`;
      if (rg === 'jp') return (views._noPlanChips ? '' : `<div class="chips">${tabs.map(([k, n]) => `<button class="chip ${k === sub ? 'on' : ''}" data-plansub="${k}">${n}</button>`).join('')}</div>`) + chips + japanRail();
      const groups = {};
      S.transit.filter(t => rg === 'all' || region(t) === rg).forEach(t => (groups[t.date || ''] ??= []).push(t));
      body = chips + (rg === 'all' && S.transit.some(t => /Hanzomon|Ginza|Hibiya|Fukutoshin|Toei/.test(t.line)) ? `<div class="card small"><b>Tokyo tip:</b> every Tokyo sightseeing ride below is covered by the <b>72h Tokyo Subway Ticket</b>. Only the airport trains need your Suica. Details in Lists → Transport cards & tickets.</div>` : '') +
        Object.keys(groups).sort().map(k => `<div class="sec"><h2>${fmtDay(k)}${k ? ' · ' + where(k) : ''}</h2></div>` +
          groups[k].sort((a, b) => (a.time || a.arr || '99').localeCompare(b.time || b.arr || '99')).map(transitCard).join('')).join('')
        + `<button class="btn pri block" data-add="transit">+ Add train / journey</button>`;
    }
    if (sub === 'flights') {
      body = S.flights.slice().sort((a, b) => (a.date + a.dep).localeCompare(b.date + b.dep)).map(f => `
        <div class="card" data-edit="flight" data-id="${f.id}">
          <div class="row"><div class="grow"><div class="small muted">${fmtDay(f.date)} · ${esc(f.airline)} ${esc(f.flightNo)}</div>
          <h3 style="font-size:20px">${esc(f.fromCode)} <span class="muted">${esc(f.dep || '--:--')}</span> → ${esc(f.toCode)} <span class="muted">${esc(f.arr || '--:--')}${f.arrDate && f.arrDate !== f.date ? '<sup>+1</sup>' : ''}</span></h3>
          <div class="small muted">${esc(f.from)} → ${esc(f.to)}${f.ref ? ' · Ref <b style="color:var(--text)">' + esc(f.ref) + '</b>' : ''}${f.price ? ' · ' + money(f.price) : ''}</div>
          ${f.notes ? `<div class="small" style="color:var(--warn)">${esc(f.notes)}</div>` : ''}</div></div></div>`).join('')
        + `<button class="btn pri block" data-add="flight">+ Add flight</button>`;
    }
    if (sub === 'stays') {
      body = S.stays.slice().sort((a, b) => a.checkIn.localeCompare(b.checkIn)).map(s => `
        <div class="card" data-edit="stay" data-id="${s.id}"><h3>⌂ ${esc(s.name)} ${statusTag(s.status)}</h3>
        <div class="small muted">${fmtDay(s.checkIn)} → ${fmtDay(s.checkOut)} · ${esc(s.address)}${s.price ? ' · ' + money(s.price) : ''}</div>
        ${s.ref ? `<div class="small">Ref <b>${esc(s.ref)}</b></div>` : ''}${s.notes ? `<div class="small muted">${esc(s.notes)}</div>` : ''}</div>`).join('')
        + `<button class="btn pri block" data-add="stay">+ Add stay</button>`;
    }
    if (sub === 'bookings') {
      body = (S.bookings.length ? S.bookings.slice().sort((a, b) => ((a.date || 'z') + a.time).localeCompare((b.date || 'z') + b.time)).map(b => `
        <div class="card pcard" data-edit="book" data-id="${b.id}">${photoOf(b) ? `<div class="pimg"><img src="${esc(photoOf(b))}" alt="" loading="lazy" onerror="this.parentNode.remove()">${photoCreditHtml(b)}</div>` : ''}<h3>🎟 ${esc(b.name)} ${statusTag(b.status)}</h3>
        <div class="small muted">${fmtDay(b.date)} ${esc(b.time)}${b.price ? ' · ' + esc(b.price) + ' ' + esc(b.cur || '') : ''}${b.ref ? ' · Ref ' + esc(b.ref) : ''}</div>
        ${b.notes ? `<div class="small muted">${esc(b.notes)}</div>` : ''}${b.link ? `<a class="small" href="${esc(b.link)}" target="_blank" rel="noopener">Open booking page</a>` : ''}</div>`).join('')
        : `<div class="empty">No events or activities yet — Skytree tickets, shows, tours, island trips…</div>`)
        + `<button class="btn pri block" data-add="book">+ Add event / activity</button>`;
    }
    if (sub === 'budget') {
      const spent = S.expenses.reduce((a, e) => a + gbp(e.amount, e.cur), 0);
      const pct = Math.min(100, spent / S.trip.budget * 100);
      body = `<div class="card"><div class="row"><div class="grow"><div class="small muted">Spent of ${money(S.trip.budget)}</div><h3 style="font-size:22px">${money(spent)}</h3></div>
        <div style="text-align:right"><div class="small muted">Left</div><b style="font-size:18px;color:${spent > S.trip.budget ? 'var(--accent)' : 'var(--ok)'}">${money(S.trip.budget - spent)}</b></div></div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="small muted" style="margin-top:6px">Rates: £1 = ${Object.entries(S.rates).map(([k, v]) => v.toLocaleString() + ' ' + k).join(' · ')} (edit in More)</div></div>
        <button class="btn pri block" data-add="expense">+ Log spending</button>
        <div class="sec"><h2>Spending log</h2></div>` +
        S.expenses.slice().reverse().map(e => `<div class="card" data-edit="expense" data-id="${e.id}"><div class="row"><div class="grow"><h3>${esc(e.desc)}</h3><div class="small muted">${fmtDay(e.date)}</div></div>
        <div style="text-align:right"><b>${e.cur === 'GBP' ? money(e.amount) : (+e.amount).toLocaleString() + ' ' + e.cur}</b>${e.cur !== 'GBP' ? `<div class="small muted">${money(gbp(e.amount, e.cur))}</div>` : ''}</div></div></div>`).join('');
    }
    return (views._noPlanChips ? '' : `<div class="chips">${tabs.map(([k, n]) => `<button class="chip ${k === sub ? 'on' : ''}" data-plansub="${k}">${n}</button>`).join('')}</div>`) + body;
  },

  lists() {
    return S.lists.map(l => {
      const done = l.items.filter(i => i.done).length;
      return `<div class="card"><div class="row"><h3 class="grow">${esc(l.name)}</h3><span class="small muted">${done}/${l.items.length}</span>
        <button class="btn sm" data-listmenu="${l.id}">⋯</button></div>
        <div class="bar"><i style="width:${l.items.length ? done / l.items.length * 100 : 0}%"></i></div>
        ${l.items.map(i => `<label class="check ${i.done ? 'on' : ''}"><input type="checkbox" data-tick="${l.id}:${i.id}" ${i.done ? 'checked' : ''}><span>${esc(i.t)}</span><button class="x" data-untick="${l.id}:${i.id}" aria-label="Remove">×</button></label>`).join('')}
        <form class="row" data-additem="${l.id}" style="margin-top:8px"><input class="grow" name="t" placeholder="Add item…" style="background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:8px 10px"><button class="btn sm">Add</button></form>
      </div>`;
    }).join('') + `<button class="btn pri block" data-newlist>+ New checklist</button>`;
  },

  more() {
    return `
      <div class="card"><h3>Look</h3>
        <p class="small muted">Country theme changes with where you are that day: indigo &amp; red in Japan, green &amp; gold in Thailand, slate &amp; red at home.</p>
        <div class="row"><button class="btn grow ${(S.theme || 'country') === 'country' ? 'pri' : ''}" data-act="themeCountry">Country theme</button><button class="btn grow ${S.theme === 'classic' ? 'pri' : ''}" data-act="themeClassic">Classic</button></div></div>
      <div class="card"><h3>Backup & sync between phones</h3>
        <p class="small muted">Everything is stored on this phone only. Export a backup file, send it to your other phone (Signal/USB/Syncthing), then Import it there.</p>
        <div class="row"><button class="btn pri grow" data-act="export">Export backup</button><button class="btn grow" data-act="import">Import backup</button></div>
        <input type="file" id="importFile" accept="application/json,.json" hidden></div>
      <div class="card"><h3>Offline maps</h3>
        <p class="small muted">Any map area you look at is saved automatically. Tap below on Wi-Fi to save Tokyo, Bangkok and Phuket in full, or zoom to any area on the Map and tap “⬇ Save area”. Saved map files: <b id="tileCount">…</b></p>
        <div class="row"><button class="btn grow" data-act="presave">Save cities + my places</button><button class="btn grow" data-act="clearTiles">Clear map cache</button></div>
        <div class="small muted" id="presaveProg"></div></div>
      <div class="card"><h3>Trip settings</h3>
        <div class="two"><label class="f">Start<input type="date" id="setStart" value="${S.trip.start}"></label><label class="f">End<input type="date" id="setEnd" value="${S.trip.end}"></label></div>
        <div class="two"><label class="f">Budget £<input type="number" id="setBudget" value="${S.trip.budget}"></label><label class="f">Title<input id="setTitle" value="${esc(S.trip.title)}"></label></div>
        <div class="two"><label class="f">THB per £1<input type="number" step="0.01" id="setTHB" value="${S.rates.THB}"></label><label class="f">JPY per £1<input type="number" step="0.01" id="setJPY" value="${S.rates.JPY}"></label></div>
        <button class="btn block" data-act="saveSettings">Save settings</button></div>
      ${APP ? '' : `<div class="card"><h3>Install on your phone</h3>
        <p class="small muted">Vanadium / Chrome: menu ⋮ → <b>Install app</b> (or Add to Home screen). Samsung Internet: menu → <b>Add page to</b> → Home screen. After that it opens full-screen and works with no signal.</p></div>`}
      <div class="card"><h3>Reset</h3><p class="small muted">Wipes this phone's data and reloads the starting trip. Export first!</p>
        <button class="btn block" style="color:var(--accent)" data-act="reset">Reset all data</button></div>
      <p class="small muted" style="text-align:center">Maps: OpenFreeMap · © OpenMapTiles · Data © OpenStreetMap contributors</p>`;
  }
};

/* ---------- map (MapLibre + OpenFreeMap vector tiles) ---------- */
// OpenFreeMap: free, no API key, no request limits. Vector tiles go to z14 and
// over-zoom from there, so a whole city is only a few hundred small files.
const OFM = 'https://tiles.openfreemap.org';
const STYLE_URL = OFM + '/styles/liberty';
const CITIES = [
  { name: 'Tokyo', b: [139.56, 35.53, 139.92, 35.82] },
  { name: 'Narita Airport', b: [140.33, 35.73, 140.42, 35.80] },
  { name: 'Bangkok', b: [100.40, 13.62, 100.78, 13.95] },
  { name: 'Phuket (Patong + airport)', b: [98.25, 7.80, 98.35, 8.15] }
];
function mapView() {
  const main = $('#view');
  main.className = 'mapmode';
  main.innerHTML = `<div class="mapbar">
    <button class="btn ${mapDay === 'all' ? 'pri' : ''}" data-mapday="all">All</button>
    <button class="btn ${mapDay === 'th' ? 'pri' : ''}" data-mapday="th">🇹🇭 Thailand</button>
    <button class="btn ${mapDay === 'jp' ? 'pri' : ''}" data-mapday="jp">🇯🇵 Tokyo</button>
    ${days().filter(d => dayItems(d).some(i => i.k === 'place' || i.k === 'transit')).map(d => `<button class="btn ${mapDay === d ? 'pri' : ''}" data-mapday="${d}">${fmtDay(d)}</button>`).join('')}
    <button class="btn" data-act="locate">◎ Me</button>
    <button class="btn" data-act="saveArea">⬇ Save area</button>
  </div><div id="map"></div>`;
  map = new maplibregl.Map({ container: 'map', style: STYLE_URL, center: [120, 20], zoom: 3, attributionControl: { compact: true, customAttribution: 'Routes © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> · <a href="https://routing.openstreetmap.de/about.html" target="_blank">OSRM/FOSSGIS</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank">Fix the map</a>' }, dragRotate: false, pitchWithRotate: false });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.on('error', e => { if (!navigator.onLine) return; console.warn('map', e.error?.message); });
  map.on('load', () => drawMarkers(true));
  map.on('zoom', syncLabels); map.on('load', syncLabels); map.on('load', addStationLayer);
  if (map.loaded()) drawMarkers(true);
  longPress(map, ll => openForm('place', null, { lat: +ll.lat.toFixed(5), lng: +ll.lng.toFixed(5) }));
}
// long-press on the map (touch) or right-click (desktop) to add a place there
function longPress(m, cb) {
  let t = null, start = null;
  const cancel = () => { clearTimeout(t); t = null; };
  m.on('touchstart', e => { if (e.originalEvent.touches.length > 1) return cancel(); start = e.point; t = setTimeout(() => { t = null; cb(e.lngLat); }, 600); });
  m.on('touchmove', e => { if (t && start && (Math.abs(e.point.x - start.x) > 10 || Math.abs(e.point.y - start.y) > 10)) cancel(); });
  m.on('touchend', cancel); m.on('touchcancel', cancel); m.on('movestart', () => { if (start && t) { } });
  m.on('contextmenu', e => cb(e.lngLat));
}
let markers = [];
// Emoji for a pin: the item's own choice, else guessed from its name, else its category.
const EMOJI_RULES = [
  [/pok[eé]mon|nintendo|akihabara|arcade|game/i, '🎮'], [/skytree|tower/i, '🗼'], [/scramble|crossing/i, '🚦'], [/godzilla|kabuki/i, '🦖'], [/kaminarimon|lantern|yokocho|yokochō/i, '🏮'],
  [/senso|sensō|shrine|jingu|jinja|torii/i, '⛩️'], [/\bwat\b|grand palace|temple|buddha/i, '🛕'], [/palace|castle/i, '🏯'],
  [/don quijote|donki|parco|mall|shopping|store/i, '🛍️'],
  [/fish|seafood|jagalchi|tsukiji/i, '🐟'], [/market|chatuchak|bazaar/i, '🛒'], [/ramen|noodle|sushi|izakaya|food|lunch|dinner|breakfast|street food/i, '🍜'],
  [/coffee|caf[eé]/i, '☕'], [/bar\b|bangla|beer|club|nightlife|rooftop/i, '🍻'], [/beach|island|bay\b/i, '🏖️'],
  [/river|canal|cruise|boat/i, '🌊'], [/park|garden/i, '🌳'], [/museum|gallery|\bart\b/i, '🖼️'], [/view|observ|sky\b|sunset/i, '🌇'],
  [/onsen|spa|massage/i, '♨️'], [/zoo|aquarium/i, '🐠'], [/show|concert|theatre|theater|ticket/i, '🎟️'], [/center gai|street|road|alley/i, '🚶']
];
function emojiFor(o, kind) {
  if (o.emoji) return o.emoji;
  if (kind === 'stay') return '🏨';
  const text = [o.name, o.wiki].filter(Boolean).join(' ');
  const hit = EMOJI_RULES.find(([re]) => re.test(text));
  if (hit) return hit[1];
  return kind === 'book' ? '🎟️' : { see: '📍', eat: '🍜', shop: '🛍️' }[o.cat] || '📍';
}
function pinEl(cat, emoji, name, local) {
  const [c] = CAT[cat] || CAT.other;
  const el = document.createElement('div'); el.className = 'pinwrap';
  el.innerHTML = `<div class="epin" style="--pc:${c}"><span>${emoji || (CAT[cat] || CAT.other)[1]}</span></div>` +
    (name ? `<div class="plabel"><b>${esc(name)}</b>${local ? `<span>${esc(local)}</span>` : ''}</div>` : '');
  return el;
}
const LABEL_ZOOM = 14;
const STN_ZOOM = 12;
const syncLabels = () => { if (!map) return; const c = map.getContainer(), z = map.getZoom(); c.classList.toggle('showlabels', z >= LABEL_ZOOM); c.classList.toggle('lowzoom', z < STN_ZOOM); };
// Every train / subway station from the offline map data (OpenMapTiles 'poi' layer, class=railway), shown from zoom 13
function addStationLayer() { addStationLayerTo(map); }
function addStationLayerTo(map) {
  if (!map || map.getLayer('all-stations')) return;
  const src = Object.entries(map.getStyle().sources || {}).find(([, v]) => v.type === 'vector')?.[0];
  if (!src) return;
  const isStation = ['all', ['==', ['get', 'class'], 'railway'], ['!=', ['get', 'subclass'], 'platform']];
  const en = ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
  try {
    map.addLayer({ id: 'all-stations-dot', type: 'circle', source: src, 'source-layer': 'poi', minzoom: 13, filter: isStation,
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 4, 17, 7], 'circle-color': '#ffffff', 'circle-stroke-color': '#1e2a37', 'circle-stroke-width': 2.5 } });
    map.addLayer({ id: 'all-stations', type: 'symbol', source: src, 'source-layer': 'poi', minzoom: 13, filter: isStation,
      layout: { 'text-field': ['case', ['all', ['has', 'name:en'], ['!=', ['get', 'name'], ['get', 'name:en']]],
          ['format', en, {}, '\n', {}, ['get', 'name'], { 'font-scale': 0.85 }], en],
        'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10.5, 17, 13], 'text-anchor': 'top', 'text-offset': [0, 0.7],
        'text-optional': true, 'symbol-sort-key': 1 },
      paint: { 'text-color': '#1e2a37', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 } });
  } catch (e) { console.warn('station layer', e); }
}
function drawMarkers(fit) {
  if (!map) return;
  markers.forEach(m => m.remove()); markers = [];
  const inFilter = (iso, lat) => mapDay === 'all' ? true : mapDay === 'th' ? lat < 25 : mapDay === 'jp' ? lat > 25 && lat < 45 : iso === mapDay;
  const bounds = new maplibregl.LngLatBounds();
  let n = 0;
  const add = (lat, lng, cat, html, emoji, o) => {
    if (lat == null || lat === '' || isNaN(lat)) return;
    bounds.extend([lng, lat]); n++;
    markers.push(new maplibregl.Marker({ element: pinEl(cat, emoji, o?.name, o?.local), anchor: 'bottom' }).setLngLat([lng, lat])
      .setPopup(new maplibregl.Popup({ offset: 40, maxWidth: '260px' }).setHTML(html)).addTo(map));
  };
  const isDay = /^\d{4}/.test(mapDay);
  S.places.forEach(p => inFilter(p.day, p.lat) && add(p.lat, p.lng, p.cat,
    `${photoOf(p) ? `<img class="popimg" src="${esc(photoOf(p))}" alt="" onerror="this.remove()">` : ''}<b>${emojiFor(p, 'place')} ${esc(p.name)}</b>${p.local ? `<div class="plocal">${esc(p.local)}</div>` : '<br>'}<span class="small muted">${fmtDay(p.day)} ${esc(p.time)}</span>${p.notes ? '<br>' + esc(p.notes) : ''}
     <br><a href="${navLink(p.lat, p.lng)}">Navigate</a> · <a href="#" data-edit="place" data-id="${p.id}">Edit</a>`, emojiFor(p, 'place'), p));
  S.stays.filter(s => !/cancel/.test(s.status)).forEach(s => (mapDay === 'all' || ((mapDay === 'th' || mapDay === 'jp') && inFilter(null, s.lat)) || (s.checkIn <= mapDay && mapDay < s.checkOut)) && add(s.lat, s.lng, 'stay',
    `<b>🏨 ${esc(s.name)}</b><br><span class="small muted">${fmtDay(s.checkIn)} → ${fmtDay(s.checkOut)}</span><br><a href="${navLink(s.lat, s.lng)}">Navigate</a> · <a href="#" data-edit="stay" data-id="${s.id}">Edit</a>`, emojiFor(s, 'stay'), s));
  S.bookings.forEach(b => b.lat && !b.place && inFilter(b.date, b.lat) && add(b.lat, b.lng, 'book', `${photoOf(b) ? `<img class="popimg" src="${esc(photoOf(b))}" alt="" onerror="this.remove()">` : ''}<b>${emojiFor(b, 'book')} ${esc(b.name)}</b><br>${fmtDay(b.date)} ${esc(b.time)}<br><a href="${navLink(b.lat, b.lng)}">Navigate</a>`, emojiFor(b, 'book'), b));
  // trains: station pins + coloured line between them
  // Your stations (train/subway legs only): always on a single day; on All/country views they appear once zoomed in to city level
  const isRail = t => t.mode === 'train' || t.mode === 'subway';
  const legs = S.transit.filter(t => t.fromLat && t.toLat && isRail(t) && (isDay ? t.date === mapDay : inFilter(t.date, t.fromLat)));
  const seen = new Set();
  legs.forEach(t => [[t.from, t.fromCode, t.fromLat, t.fromLng], [t.to, t.toCode, t.toLat, t.toLng]].forEach(([nm, code, la, ln]) => {
    const key = nm + code; if (seen.has(key)) return; seen.add(key);
    if (isDay) { bounds.extend([ln, la]); n++; }
    const el = document.createElement('div'); el.className = 'stn' + (isDay ? '' : ' ov'); el.style.setProperty('--lc', t.color); el.textContent = code || '🚉'; el.title = nm;
    const uses = S.transit.filter(x => (x.from === nm && x.fromCode === code) || (x.to === nm && x.toCode === code));
    markers.push(new maplibregl.Marker({ element: el }).setLngLat([ln, la]).setPopup(new maplibregl.Popup({ offset: 14, maxWidth: '270px' }).setHTML(
      `<b>🚉 ${esc(nm)}</b> <span class="small muted">${esc(code)}</span>` + uses.map(x => `<div class="small" style="margin-top:6px;border-left:3px solid ${x.color};padding-left:6px">${fmtDay(x.date)} ${esc(x.time)} · ${esc(x.line)}<br>${esc(x.from)} → ${esc(x.to)}</div>`).join('') +
      `<div style="margin-top:6px"><a href="${navLink(la, ln)}">Navigate</a></div>`)).addTo(map));
  }));
  // real routes where we have them (train track / roads / footpaths), straight line until they arrive
  const jobs = isDay ? dayRouteJobs(mapDay) : [];
  const geom = j => ROUTES[j.sig] || [j.a, j.b];
  const legData = { type: 'FeatureCollection', features: jobs.filter(j => j.leg).map(j => ({ type: 'Feature', properties: { color: j.color }, geometry: { type: 'LineString', coordinates: geom(j) } })) };
  const route = jobs.filter(j => !j.leg).flatMap(j => [j.a, j.b]);
  const data = { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: jobs.filter(j => !j.leg).map(geom) } };
  const ready = () => {
    if (map.getSource('legs')) map.getSource('legs').setData(legData);
    else {
      map.addSource('legs', { type: 'geojson', data: legData });
      map.addLayer({ id: 'legs-case', type: 'line', source: 'legs', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.8 } });
      map.addLayer({ id: 'legs', type: 'line', source: 'legs', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 4.5 } });
    }
    if (map.getSource('route')) map.getSource('route').setData(data);
    else { map.addSource('route', { type: 'geojson', data }); map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-join': 'round' }, paint: { 'line-color': '#ff5a4e', 'line-width': 3, 'line-dasharray': [1.5, 1.5] } }, map.getLayer('legs-case') ? 'legs-case' : undefined); }
  };
  if (map.isStyleLoaded()) ready(); else map.once('styledata', ready);
  // fetch any missing routes for this day, redraw as each one lands
  if (isDay) jobs.forEach(j => [j.exIn, j.exOut].forEach(e => { if (!e) return; const el = document.createElement('div'); el.className = 'exb map'; el.textContent = exitRef(e); markers.push(new maplibregl.Marker({ element: el }).setLngLat(e.pt).addTo(map)); }));
  if (isDay && dayNeedsExtras(mapDay)) { const day = mapDay; ensureDayExtras(day, () => { if (map && mapDay === day) drawMarkers(false); }); }
  const dayPts = isDay ? [...route, ...jobs.flatMap(j => geom(j))] : [];
  const fitTo = dayPts.length ? dayPts.reduce((bb, c) => bb.extend(c), new maplibregl.LngLatBounds(dayPts[0], dayPts[0])) : bounds;
  if (fit && n) map.fitBounds(fitTo, { padding: 60, maxZoom: 15, duration: 0 });
  syncLabels();
}
function locate() {
  if (!navigator.geolocation) return toast('No location on this device');
  toast('Finding you… (GPS works offline)');
  navigator.geolocation.getCurrentPosition(p => {
    const ll = [p.coords.longitude, p.coords.latitude];
    if (meMarker) meMarker.remove();
    const el = document.createElement('div'); el.className = 'me';
    meMarker = new maplibregl.Marker({ element: el }).setLngLat(ll).addTo(map);
    map.flyTo({ center: ll, zoom: 16 });
  }, e => toast('Location failed: ' + e.message), { enableHighAccuracy: true, timeout: 20000 });
}

/* ---------- offline map download ---------- */
const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const lat2y = (lat, z) => Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z);
let ofmMeta = null; // { tiles: template, maxzoom, extra: [style, sprite & font urls] }
async function getOfmMeta() {
  if (ofmMeta) return ofmMeta;
  const style = await (await fetch(STYLE_URL)).json();
  const src = Object.values(style.sources).find(s => s.type === 'vector');
  const tj = src.url ? await (await fetch(src.url)).json() : src;
  const extra = [];
  const sprites = Array.isArray(style.sprite) ? style.sprite.map(s => s.url) : style.sprite ? [style.sprite] : [];
  sprites.forEach(s => ['.json', '.png', '@2x.json', '@2x.png'].forEach(x => extra.push(s + x)));
  const stacks = new Set();
  style.layers.forEach(l => { const f = l.layout?.['text-font']; if (Array.isArray(f) && f.every(x => typeof x === 'string')) stacks.add(f.join(',')); });
  // Latin, Latin-ext, punctuation, Thai glyph ranges (Japanese/Chinese render from the phone's own fonts)
  if (style.glyphs) stacks.forEach(st => ['0-255', '256-511', '512-767', '3584-3839', '8192-8447'].forEach(r => extra.push(style.glyphs.replace('{fontstack}', encodeURIComponent(st)).replace('{range}', r))));
  return ofmMeta = { tiles: tj.tiles[0], maxzoom: Math.min(tj.maxzoom ?? 14, 14), extra };
}
function tilesFor(b, z0, z1, meta) { // b = [west, south, east, north]
  const urls = [];
  for (let z = z0; z <= z1; z++) {
    const x0 = lon2x(b[0], z), x1 = lon2x(b[2], z), y0 = lat2y(b[3], z), y1 = lat2y(b[1], z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) urls.push(meta.tiles.replace('{z}', z).replace('{x}', x).replace('{y}', y));
  }
  return urls;
}
// Fetching through the app is enough: the APK (or service worker) stores every map file it sees.
async function fetchTiles(urls, prog) {
  let n = 0, fail = 0;
  const q = urls.slice();
  const worker = async () => { while (q.length) { const u = q.shift(); try { const r = await fetch(u); await r.arrayBuffer(); if (!r.ok) fail++; } catch { fail++; } n++; prog(n, urls.length, fail); } };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return fail;
}
async function saveArea() {
  if (!navigator.onLine) return toast('Connect to Wi-Fi to save maps');
  try {
    const meta = await getOfmMeta();
    const b = map.getBounds();
    const urls = [...new Set([...meta.extra, ...tilesFor([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], 0, meta.maxzoom, meta)])];
    if (urls.length > 3000) return toast(`That's ${urls.length} files — zoom in a bit`);
    if (!confirm(`Save this area for offline (${urls.length} small files, roughly ${Math.max(1, Math.round(urls.length * 0.04))} MB)?`)) return;
    const fail = await fetchTiles(urls, (n, t) => { if (n % 40 === 0 || n === t) toast(`Saving map… ${n}/${t}`); });
    toast(fail ? `Saved, ${fail} files failed — try again on better Wi-Fi` : 'Area saved for offline ✓');
  } catch (e) { toast('Map server unreachable: ' + e.message); }
}
async function presaveAll() {
  const el = $('#presaveProg');
  if (!navigator.onLine) return el.textContent = 'Connect to Wi-Fi first';
  try {
    el.textContent = 'Preparing…';
    const meta = await getOfmMeta();
    const set = new Set(meta.extra);
    CITIES.forEach(c => tilesFor(c.b, 0, meta.maxzoom, meta).forEach(u => set.add(u)));
    [...S.places, ...S.stays, ...S.bookings, ...S.transit.flatMap(t => [{ lat: t.fromLat, lng: t.fromLng }, { lat: t.toLat, lng: t.toLng }])].filter(p => p.lat).forEach(p =>
      tilesFor([p.lng - 0.03, p.lat - 0.03, p.lng + 0.03, p.lat + 0.03], 0, meta.maxzoom, meta).forEach(u => set.add(u)));
    [...S.places, ...S.bookings].forEach(o => o.photo && set.add(o.photo));
    const urls = [...set];
    if (!confirm(`Save Tokyo, Bangkok, Phuket and the area around all your pins for offline use?\n\n${urls.length} files, roughly ${Math.round(urls.length * 0.04)} MB. Do this on Wi-Fi.`)) return el.textContent = '';
    const fail = await fetchTiles(urls, (n, t, f) => { el.textContent = `Saving ${n}/${t}${f ? ` · ${f} failed` : ''}`; });
    const xpts = days().flatMap(railStationsOf).filter(pt => !ROUTES[exKey(pt)]);
    if (xpts.length) await ensureExits(xpts, () => { el.textContent = 'Saving station exits…'; });
    const rjobs = days().flatMap(dayRouteJobs).filter(j => !ROUTES[j.sig]);
    if (rjobs.length) await ensureRoutes(rjobs, (g, f) => { el.textContent = `Saving routes ${g + f}/${rjobs.length}…`; });
    el.textContent = fail ? `Done — ${fail} failed, run it again on better Wi-Fi (it skips what's already saved)` : 'Tokyo, Bangkok, Phuket + all your places & photos saved for offline ✓';
    countTiles();
  } catch (e) { el.textContent = 'Map server unreachable: ' + e.message; }
}
async function countTiles() {
  const el = $('#tileCount'); if (!el) return;
  if (APP) { el.textContent = Android.tileCount(); return; }
  try { const c = await caches.open('tripkit-map-v2'); el.textContent = (await c.keys()).length; } catch { }
}

/* ---------- forms ---------- */
const FORMS = {
  place: { coll: 'places', title: 'Place', fields: [['name', 'Name'], ['day', 'Day', 'date'], ['time', 'Time', 'time'], ['cat', 'Type', 'select', CATNAME], ['area', 'Area / neighbourhood'], ['local', 'Local name (日本語 / ไทย) — shown on the map'], ['emoji', 'Map emoji (optional — leave blank to auto-pick)'], ['coords', 'Location (lat, lng) — paste from any maps app'], ['link', 'Link', 'url'], ['notes', 'Notes', 'textarea']] },
  flight: { coll: 'flights', title: 'Flight', fields: [['date', 'Departs', 'date'], ['dep', 'Dep time', 'time'], ['arrDate', 'Arrives', 'date'], ['arr', 'Arr time', 'time'], ['fromCode', 'From (code)'], ['toCode', 'To (code)'], ['from', 'From (city/airport)'], ['to', 'To (city/airport)'], ['airline', 'Airline'], ['flightNo', 'Flight no.'], ['ref', 'Booking ref'], ['price', 'Price £', 'number'], ['notes', 'Notes (terminal, seat, bags…)', 'textarea']] },
  stay: { coll: 'stays', title: 'Stay', fields: [['name', 'Name'], ['local', 'Local name (日本語 / ไทย)'], ['status', 'Status', 'select', { booked: 'Booked', tobook: 'Not booked yet', deciding: 'Deciding', tocancel: 'Need to cancel', idea: 'Idea', cancelled: 'Cancelled' }], ['checkIn', 'Check in', 'date'], ['inTime', 'Check-in from', 'time'], ['arrive', 'Expected arrival', 'time'], ['checkOut', 'Check out', 'date'], ['outTime', 'Check-out by', 'time'], ['leave', 'Planned departure', 'time'], ['address', 'Address'], ['coords', 'Location (lat, lng)'], ['ref', 'Booking ref'], ['price', 'Price £', 'number'], ['notes', 'Notes', 'textarea']] },
  book: { coll: 'bookings', title: 'Event / activity', fields: [['name', 'What'], ['status', 'Status', 'select', { idea: 'Idea', booked: 'Booked', paid: 'Paid', cancelled: 'Cancelled' }], ['date', 'Date', 'date'], ['time', 'Time', 'time'], ['price', 'Price', 'number'], ['cur', 'Currency', 'select', { GBP: 'GBP', THB: 'THB', JPY: 'JPY' }], ['ref', 'Booking ref / ticket no.'], ['local', 'Local name (日本語 / ไทย)'], ['emoji', 'Map emoji (optional)'], ['coords', 'Location (lat, lng)'], ['link', 'Booking link', 'url'], ['notes', 'Notes', 'textarea']] },
  transit: { coll: 'transit', title: 'Train / journey', fields: [['date', 'Date', 'date'], ['time', 'Time', 'time'],
    ['mode', 'Type', 'select', { train: 'Train', subway: 'Subway / metro', taxi: 'Taxi / Grab', bus: 'Bus', walk: 'Walk' }],
    ['line', 'Line', 'select', Object.fromEntries([...Object.keys(LINES), 'Other'].map(k => [k, k]))],
    ['from', 'From station'], ['fromCode', 'From code (e.g. A-14)'], ['fromCoords', 'From location (lat, lng)'],
    ['to', 'To station'], ['toCode', 'To code'], ['toCoords', 'To location (lat, lng)'],
    ['fromExit', 'Exit to go in at (e.g. A5) — blank = nearest'], ['toExit', 'Exit to leave by (e.g. A4) — blank = nearest'], ['arr', 'Arrives', 'time'], ['dur', 'Journey time'], ['fare', 'Fare / ticket (text)'], ['fareJPY', 'Fare in ¥ (number — for Japan totals)', 'number'], ['board', 'Which train to board'], ['notes', 'Notes (exits, changes…)', 'textarea']] },
  expense: { coll: 'expenses', title: 'Spending', fields: [['desc', 'What'], ['amount', 'Amount', 'number'], ['cur', 'Currency', 'select', { GBP: 'GBP', THB: 'THB', JPY: 'JPY' }], ['date', 'Date', 'date']] }
};
function openForm(kind, id, preset = {}) {
  const F = FORMS[kind], coll = S[F.coll];
  const o = id ? coll.find(x => x.id === id) : { ...preset };
  if (!o) return;
  if (!id && kind === 'expense') { o.date ??= today(); o.cur ??= country(today()) === 'jp' ? 'JPY' : country(today()) === 'th' ? 'THB' : 'GBP'; }
  if (!id && kind === 'place') o.cat ??= 'see';
  if (!id && kind === 'transit') { o.date ??= selDay; o.mode ??= 'subway'; }
  if (!id && kind === 'book') { o.status ??= 'idea'; o.cur ??= 'GBP'; }
  const val = k => { const m = k.match(/^(.*?)(?:C|c)oords$/); if (!m) return o[k] ?? ''; const la = m[1] ? m[1] + 'Lat' : 'lat', ln = m[1] ? m[1] + 'Lng' : 'lng'; return o[la] != null && o[la] !== '' ? `${o[la]}, ${o[ln]}` : ''; };
  const field = ([k, label, type = 'text', opts]) => type === 'select'
    ? `<label class="f">${label}<select name="${k}">${Object.entries(opts).map(([v, n]) => `<option value="${v}" ${val(k) === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`
    : type === 'textarea' ? `<label class="f">${label}<textarea name="${k}">${esc(val(k))}</textarea></label>`
    : `<label class="f">${label}<input name="${k}" type="${type}" ${type === 'number' ? 'step="0.01" inputmode="decimal"' : ''} value="${esc(val(k))}"></label>`;
  const f = $('#dlgForm');
  const hasPhoto = kind === 'place' || kind === 'book';
  f.innerHTML = `<h3>${id ? 'Edit' : 'New'} ${F.title.toLowerCase()}</h3>${hasPhoto ? photoPanel(o) : ''}${F.fields.map(field).join('')}
    <div class="actions">${id ? '<button type="button" class="btn del" value="del">Delete</button>' : ''}<button class="btn" value="cancel">Cancel</button><button class="btn pri" value="ok">Save</button></div>`;
  const dlg = $('#dlg');
  if (hasPhoto) wirePhotoPanel(o, () => [f.querySelector('[name=name]')?.value, f.querySelector('[name=area]')?.value].filter(Boolean).join(' '));
  f.querySelector('.del')?.addEventListener('click', () => {
    if (!confirm('Delete this?')) return;
    S[F.coll] = coll.filter(x => x.id !== id); delete OWN[id]; idbDo('readwrite', st => st.delete(id)); save(); dlg.close(); render();
  });
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') { if (o._photoDirty) { delete OWN._new; if (id) { const fresh = JSON.parse(localStorage.getItem(KEY)); const orig = fresh?.[F.coll]?.find(x => x.id === id); if (orig) ['photo', 'photoCredit', 'photoTitle', 'noPhoto'].forEach(k => orig[k] === undefined ? delete o[k] : o[k] = orig[k]); if (OWN[id] !== undefined) loadOwnPhotos(); } delete o._ownPhoto; delete o._removeOwn; delete o._photoDirty; } return; }
    const fd = new FormData(f), out = id ? o : { id: uid(), done: false, ...o };
    for (const [k, v] of fd) {
      const cm = k.match(/^(.*?)(?:C|c)oords$/);
      if (cm) {
        const m = String(v).match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
        const la = cm[1] ? cm[1] + 'Lat' : 'lat', ln = cm[1] ? cm[1] + 'Lng' : 'lng';
        out[la] = m ? +m[1] : ''; out[ln] = m ? +m[2] : '';
      } else out[k] = (k === 'price' || k === 'amount' || k === 'fareJPY') && v !== '' ? +v : v;
    }
    if (kind === 'transit') out.color = LINES[out.line] || out.color || '#8fa0b1';
    if (!id) coll.push(out);
    const ph = { own: out._ownPhoto, remove: out._removeOwn, dirty: out._photoDirty };
    delete out._ownPhoto; delete out._removeOwn; delete out._photoDirty; delete OWN._new;
    save(); render();
    if (ph.dirty) commitPhoto(out.id, ph).then(render);
  };
  dlg.returnValue = '';
  dlg.showModal();
}

/* ---------- render + events ---------- */
/* ---------- themes (v1.19) ---------- */
const WM = { Tokyo: '東京', Bangkok: 'กรุงเทพ', Patong: 'ป่าตอง', Phuket: 'ภูเก็ต' };
function applyTheme() {
  const d = (tab === 'guide' ? views._gDay : tab === 'map' && mapDay !== 'all' ? mapDay : selDay) || today(), w = where(d), c = country(d) || 'uk', mode = S.theme || 'country';
  document.body.dataset.theme = mode === 'country' ? c : mode === 'classic' ? '' : mode;
  $('header.top').dataset.wm = mode === 'classic' ? '' : (WM[w] || '');
  const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim(); const tc = document.querySelector('meta[name=theme-color]'); if (tc && bg) tc.content = bg;
}
function render() {
  $('#tripTitle').textContent = S.trip.title;
  $('#tripSub').textContent = `${fmtDay(S.trip.start)} – ${fmtDay(S.trip.end)}`;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  applyTheme();
  if (tab === 'map') { if (!$('#map')) mapView(); else drawMarkers(false); return; }
  if (map) { map.remove(); map = null; }
  if (gmap) { gmap.remove(); gmap = null; }
  const main = $('#view');
  const stepView = tab === 'guide' && views._gStep != null;
  main.className = stepView ? 'gmode' : '';
  main.innerHTML = views[tab]();
  if (stepView) { main.scrollTop = 0; initGuideMap(); }
  if (tab === 'trip' && views._tripSec === 'settings') countTiles();
  main.querySelector('.chip.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  autoPhotos();
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab],[data-day],[data-gday],[data-gstep],[data-gopen],[data-gback],[data-gdone],[data-tripsec],[data-add],[data-edit],[data-plansub],[data-trainregion],[data-mapday],[data-act],[data-untick],[data-newlist],[data-listmenu]');
  if (!t || e.target.matches('input[type=checkbox]')) return;
  const d = t.dataset;
  if (d.tab) { if (d.tab === tab) { views._gStep = null; views._tripSec = ''; } tab = d.tab; if (map) { map.remove(); map = null; } render(); }
  else if (d.gday) { views._gDay = d.gday; views._gStep = null; render(); }
  else if (d.gstep !== undefined) { if (t.disabled) return; const n = +d.gstep, g = buildGuide(views._gDay); if (n >= 0 && n < g.steps.length) { views._gStep = n; render(); } }
  else if (d.gopen) { const [day, n] = d.gopen.split(':'); tab = 'guide'; views._gDay = day; views._gStep = +n; render(); }
  else if ('gback' in d) { views._gStep = null; render(); }
  else if (d.gdone) { const p = S.places.find(x => x.id === d.gdone); if (p) { p.done = !p.done; save(); render(); } }
  else if (d.tripsec !== undefined) { views._tripSec = d.tripsec; render(); }
  else if (d.day) { selDay = d.day; render(); }
  else if (d.add) { e.preventDefault(); openForm(d.add, null, d.preday ? { day: d.preday, date: d.preday } : {}); }
  else if (d.edit) { e.preventDefault(); openForm(d.edit, d.id); }
  else if (d.plansub) { views._planSub = d.plansub; render(); }
  else if (d.trainregion) { views._trainRegion = d.trainregion; render(); }
  else if (d.mapday) { mapDay = d.mapday; map.remove(); map = null; mapView(); }
  else if (d.untick) { e.preventDefault(); const [l, i] = d.untick.split(':'); const L_ = S.lists.find(x => x.id === l); L_.items = L_.items.filter(x => x.id !== i); save(); render(); }
  else if ('newlist' in d) { const n = prompt('Checklist name'); if (n) { S.lists.push({ id: uid(), name: n, items: [] }); save(); render(); } }
  else if (d.listmenu) {
    const l = S.lists.find(x => x.id === d.listmenu);
    const a = prompt(`"${l.name}"\nType a new name to rename, "reset" to untick all, or "delete" to remove the list.`, l.name);
    if (a === 'delete') { if (confirm('Delete list?')) S.lists = S.lists.filter(x => x !== l); }
    else if (a === 'reset') l.items.forEach(i => i.done = false);
    else if (a) l.name = a;
    save(); render();
  }
  else if (d.act) acts[d.act]();
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.tick) { const [l, i] = t.dataset.tick.split(':'); S.lists.find(x => x.id === l).items.find(x => x.id === i).done = t.checked; save(); render(); }
  if (t.dataset.done) { S.places.find(p => p.id === t.dataset.done).done = t.checked; save(); render(); }
  if (t.id === 'importFile' && t.files[0]) {
    t.files[0].text().then(txt => {
      const d = JSON.parse(txt);
      if (!d.trip || !d.places) throw new Error('Not a TripKit backup');
      if (!confirm('Replace everything on this phone with the backup?')) return;
      S = migrate(d); save(); selDay = null; toast('Backup imported ✓'); render();
    }).catch(err => toast('Import failed: ' + err.message));
  }
});
document.addEventListener('submit', e => {
  const l = e.target.dataset.additem;
  if (!l) return;
  e.preventDefault();
  const v = e.target.t.value.trim();
  if (v) { S.lists.find(x => x.id === l).items.push({ id: uid(), t: v, done: false }); save(); render(); }
});

const acts = {
  themeCountry() { S.theme = 'country'; save(); render(); },
  themeClassic() { S.theme = 'classic'; save(); render(); },
  locate, saveArea, presave: presaveAll,
  async export() {
    const name = `tripkit-backup-${today()}.json`;
    if (APP) return Android.exportJson(name, JSON.stringify(S, null, 2));
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: 'TripKit backup' }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    toast('Backup saved to Downloads');
  },
  import() { $('#importFile').click(); },
  async clearTiles() { if (confirm('Delete all saved map tiles?')) { if (APP) Android.clearTiles(); else await caches.delete('tripkit-map-v2'); countTiles(); toast('Map cache cleared'); } },
  saveSettings() {
    S.trip.start = $('#setStart').value; S.trip.end = $('#setEnd').value; S.trip.budget = +$('#setBudget').value; S.trip.title = $('#setTitle').value;
    S.rates.THB = +$('#setTHB').value; S.rates.JPY = +$('#setJPY').value; selDay = null; save(); toast('Saved'); render();
  },
  reset() { if (confirm('Really wipe all TripKit data on this phone?')) { S = SEED(); save(); selDay = null; render(); } }
};

/* ---------- online/offline + SW ---------- */
function net() { const b = $('#netBadge'); b.textContent = navigator.onLine ? 'online' : 'offline'; b.classList.toggle('off', !navigator.onLine); }
addEventListener('online', net); addEventListener('offline', net); net();
if (!APP && 'serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
// Android back button: close dialog -> back to Today -> exit
window.tkBack = () => {
  const d = $('#dlg'); if (d.open) { d.close(); return true; }
  if (tab === 'guide' && views._gStep != null) { views._gStep = null; render(); return true; }
  if (tab === 'trip' && views._tripSec) { views._tripSec = ''; render(); return true; }
  if (tab !== 'today') { tab = 'today'; if (map) { map.remove(); map = null; } render(); return true; }
  return false;
};
/* ---------- start-up screen (v1.18) ---------- */
(function splash() {
  const el = $('#splash'); if (!el) return;
  const t = today(), ds = days(), n = Math.round((new Date(S.trip.start + 'T12:00:00') - new Date(t + 'T12:00:00')) / 864e5);
  const firstThing = iso => { const it = dayItems(iso).find(i => !(i.o && i.o.done)); return it ? `${it.t && it.t !== '—' ? esc(it.t) + ' · ' : ''}${esc(it.title.replace(/^Check in · /, '🏨 '))}` : ''; };
  let big, sub;
  if (t < S.trip.start) { big = n === 1 ? 'Tomorrow!' : `${n} days to go`; sub = `First up ${fmtDay(S.trip.start)}: ${firstThing(S.trip.start) || where(S.trip.start)}`; }
  else if (t <= S.trip.end) { const i = ds.indexOf(t) + 1, nx = firstThing(t); big = `Day ${i} of ${ds.length}`; sub = `${esc(where(t) || '')}${nx ? `${where(t) ? ' · ' : ''}next: ${nx}` : ''}`; }
  else { big = 'Welcome home 🏡'; const v = S.places.filter(p => p.done).length; sub = `${ds.length} days${v ? ` · ${v} places visited` : ''} — hope it was a good one`; }
  $('#spBig').innerHTML = big; $('#spSub').innerHTML = sub;
  $('#spTrip').textContent = `${S.trip.title || 'Thailand & Tokyo'} · ${fmtDay(S.trip.start).replace(/^\w+ /, '')} – ${fmtDay(S.trip.end).replace(/^\w+ /, '')}`;
  let gone = false; const hide = () => { if (gone) return; gone = true; el.classList.add('out'); setTimeout(() => el.remove(), 450); };
  el.addEventListener('click', hide); setTimeout(hide, 1900);
})();
render();
loadOwnPhotos().then(loadRoutes).then(() => { if (Object.keys(OWN).length) render(); if (map) drawMarkers(false); });
