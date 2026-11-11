"""Network mocks for the TripKit browser tests.

The sandbox the tests were written in has no internet, so map tiles (OpenFreeMap), Wikipedia,
Overpass (railway lines, station exits) and OSRM (roads, footpaths, turn-by-turn) are faked here.
"""
import asyncio, json, re, io, urllib.parse
from functools import lru_cache
from PIL import Image, ImageDraw

@lru_cache(maxsize=32)
def standin_jpeg(i):
    """A striped stand-in for a Wikipedia photo (no network in tests)."""
    hues = [(70, 110, 200), (120, 80, 200), (70, 160, 210), (200, 90, 90), (190, 160, 70), (70, 190, 170)]
    c = hues[i % len(hues)]; im = Image.new('RGB', (900, 600), c); d = ImageDraw.Draw(im)
    for x in range(-600, 900, 90): d.polygon([(x, 600), (x + 40, 600), (x + 640, 0), (x + 600, 0)], fill=tuple(min(255, v + 35) for v in c))
    b = io.BytesIO(); im.save(b, 'JPEG', quality=80); return b.getvalue()
from playwright.async_api import async_playwright
STYLE={"version":8,"sources":{"openmaptiles":{"type":"vector","url":"https://tiles.openfreemap.org/planet"}},
 "glyphs":"https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf","sprite":"https://tiles.openfreemap.org/sprites/ofm_f384/ofm",
 "layers":[{"id":"bg","type":"background","paint":{"background-color":"#e8e4d8"}},
  {"id":"water","type":"fill","source":"openmaptiles","source-layer":"water","paint":{"fill-color":"#9cc"}},
  {"id":"lbl","type":"symbol","source":"openmaptiles","source-layer":"place","layout":{"text-field":"{name}","text-font":["Noto Sans Regular"]}}]}
TJ={"tilejson":"3.0.0","tiles":["https://tiles.openfreemap.org/planet/20261001_001001_pt/{z}/{x}/{y}.pbf"],"maxzoom":14,"minzoom":0}
hits={'style':0,'tilejson':0,'pbf':0,'font':0,'sprite':0}
async def route(r):
  u=r.request.url
  if '/styles/' in u: hits['style']+=1; return await r.fulfill(json=STYLE)
  if u.endswith('/planet'): hits['tilejson']+=1; return await r.fulfill(json=TJ)
  if '/fonts/' in u: hits['font']+=1; return await r.fulfill(body=b'',content_type='application/x-protobuf')
  if '/sprites/' in u:
    hits['sprite']+=1
    if u.endswith('.json'): return await r.fulfill(json={})
    import base64; return await r.fulfill(body=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),content_type='image/png')
  if u.endswith('.pbf'): hits['pbf']+=1; return await r.fulfill(body=b'',content_type='application/x-protobuf')
  await r.abort()

import asyncio, json, urllib.parse
NAMES=['Center Gai','Don Quijote (store)','Parco (department store)','Shibuya Crossing','Kabukichō','Omoide Yokochō','Kaminarimon','Sensō-ji','Sumida River','Tokyo Skytree','Pokémon Center','Akihabara','Bangla Road','Grand Palace','Chatuchak Weekend Market']
calls={'api':0,'img':0}
async def wiki(r):
  calls['api']+=1
  q=urllib.parse.parse_qs(urllib.parse.urlparse(r.request.url).query)
  t=q.get('titles',[None])[0]; i=NAMES.index(t) if t in NAMES else 15
  if t and t not in NAMES: return await r.fulfill(json={'query':{'pages':{'-1':{'title':t,'missing':''}}}})
  title=t or q['gsrsearch'][0]
  await r.fulfill(json={'query':{'pages':{'1':{'title':title,'fullurl':'https://en.wikipedia.org/wiki/'+title,'thumbnail':{'source':f'https://upload.wikimedia.org/wikipedia/commons/thumb/x/{i}.jpg/900px-{i}.jpg','width':900,'height':600}}}}},headers={'access-control-allow-origin':'*'})
async def up(r):
  calls['img']+=1
  i=r.request.url.split('/')[-1].split('-')[1].split('.')[0]
  await r.fulfill(body=standin_jpeg(int(i) if i.isdigit() else 0),content_type='image/jpeg')

import asyncio, json, math, re, urllib.parse
rh={'ovp':0,'osrm':0}
def wavy(a,b,n=None,amp=0.15,waves=3):
  n=n or max(20,math.ceil(math.hypot(b[0]-a[0],b[1]-a[1])/0.0002))
  (x1,y1),(x2,y2)=a,b; dx,dy=x2-x1,y2-y1; L=math.hypot(dx,dy) or 1; nx,ny=-dy/L,dx/L
  return [(x1+dx*t+nx*L*amp*math.sin(t*math.pi*waves)*0.3, y1+dy*t+ny*L*amp*math.sin(t*math.pi*waves)*0.3) for t in [i/n for i in range(n+1)]]
async def ovp(r):
  rh['ovp']+=1
  q=urllib.parse.unquote(r.request.url.split('data=')[1])
  bb=[float(x) for x in re.search(r'\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)',q).groups()]
  s,w,n,e=bb[0]+0.04,bb[1]+0.04,bb[2]-0.04,bb[3]-0.04
  els=[]
  for (a,b) in [((w,s),(e,n)),((w,n),(e,s))]:
    pts=wavy(a,b)
    half=len(pts)//2
    # split into two ways with a ~40 m gap (tests the bridging)
    p1=pts[:half]; p2=[(x+0.0003,y) for x,y in pts[half:]]
    for seg in (p1,p2): els.append({'type':'way','geometry':[{'lat':y,'lon':x} for x,y in seg]})
  await r.fulfill(json={'elements':els},headers={'access-control-allow-origin':'*'})
async def osrm(r):
  rh['osrm']+=1
  c=r.request.url.split('/driving/')[1].split('?')[0].split(';'); a=tuple(map(float,c[0].split(','))); b=tuple(map(float,c[1].split(',')))
  pts=[a,(a[0],(a[1]+b[1])/2),((a[0]+b[0])/2,(a[1]+b[1])/2),(b[0],(a[1]+b[1])/2),b]
  await r.fulfill(json={'code':'Ok','routes':[{'geometry':{'type':'LineString','coordinates':[list(p) for p in pts]}}]},headers={'access-control-allow-origin':'*'})

import asyncio, json, urllib.parse, sys
async def wiki2(r):
  q=urllib.parse.parse_qs(urllib.parse.urlparse(r.request.url).query)
  t=q.get('titles',[None])[0] or q.get('gsrsearch',['x'])[0]; i=abs(hash(t))%15
  await r.fulfill(json={'query':{'pages':{'1':{'title':t,'fullurl':'https://en.wikipedia.org/wiki/'+t,'extract':f'{t} is a stand-in description used for testing. In the real app this is the first few sentences of the Wikipedia article.','thumbnail':{'source':f'https://upload.wikimedia.org/x/{i}.jpg/900px-{i}.jpg'}}}}},headers={'access-control-allow-origin':'*'})

import asyncio, json, urllib.parse, sys, re, math
xq={'n':0}
async def ovp2(r):
  q=urllib.parse.unquote(r.request.url.split('data=')[1])
  m=re.search(r'around:(\d+),([-\d.]+),([-\d.]+)',q)
  if m:
    xq['n']+=1; la,lo=float(m.group(2)),float(m.group(3))
    els=[{'type':'node','lat':la+0.0013*math.sin(k),'lon':lo+0.0016*math.cos(k),'tags':{'railway':'subway_entrance','ref':f'A{k+1}'}} for k in range(6)]
    return await r.fulfill(json={'elements':els},headers={'access-control-allow-origin':'*'})
  return await ovp(r)
import asyncio, json, urllib.parse, sys, re, math
NAMES=['Edo-dori','Kiyosubashi-dori','Amazake Yokocho','Ningyocho-dori','']
async def osrm2(r):
  u=r.request.url; c=u.split('/driving/')[1].split('?')[0].split(';'); a=tuple(map(float,c[0].split(','))); b=tuple(map(float,c[1].split(',')))
  pts=[a,(a[0],(a[1]+b[1])/2),((a[0]+b[0])/2,(a[1]+b[1])/2),(b[0],(a[1]+b[1])/2),b]
  rt={'geometry':{'type':'LineString','coordinates':[list(p) for p in pts]}}
  if 'steps=true' in u:
    h=abs(hash(u))
    rt['legs']=[{'steps':[{'maneuver':{'type':'depart','bearing_after':90},'name':NAMES[h%4],'distance':120},
      {'maneuver':{'type':'turn','modifier':'left'},'name':NAMES[(h+1)%4],'distance':210},
      {'maneuver':{'type':'turn','modifier':'slight right'},'name':'','distance':60},
      {'maneuver':{'type':'arrive','modifier':'right'},'name':'','distance':0}]}]
  await r.fulfill(json={'code':'Ok','routes':[rt]},headers={'access-control-allow-origin':'*'})