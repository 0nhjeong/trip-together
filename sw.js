/* 같이갈래 - Service Worker (홈 화면 설치용)
 * 코드를 고쳐 다시 배포할 때는 CACHE 이름의 숫자를 올려 주세요.
 *
 * 동작 방식: 인터넷이 되면 항상 서버의 최신 파일을 씁니다(network-first).
 *           인터넷이 안 되거나 4초 넘게 느리면 저장해 둔 앱 화면으로 실행합니다.
 *           카카오맵·Supabase 같은 외부 요청은 건드리지 않습니다(여행 데이터는 항상 실시간).
 *           단, 버전이 고정된 CDN 파일(지도 라이브러리 d3·topojson, 폰트)은 한 번 받으면 저장해서
 *           '내 발자국' 화면이 오프라인에서도 열리게 합니다.
 */
const CACHE = 'trip-together-v4';
const LIB_CACHE = 'trip-together-libs-v1';
const ASSETS = [
  './',
  './index.html',
  './footprint.html',
  './config.js',
  './css/style.css',
  './css/footprint.css',
  './js/app.js',
  './js/store.js',
  './js/footprint.js',
  './js/map/mapService.js',
  './js/map/kakaoProvider.js',
  './js/map/demoProvider.js',
  './js/map/pinEl.js',
  './data/skorea-municipalities-2018.topo.json',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];
// 버전이 주소에 박혀 있어서 내용이 바뀌지 않는 외부 파일만
const LIB_RE = /^https:\/\/cdn\.jsdelivr\.net\/(npm\/(d3@7\.9\.0|topojson-client@3\.1\.0)\/|gh\/orioncactus\/pretendard@v1\.3\.9\/)/;
const TIMEOUT_MS = 4000;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== LIB_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (LIB_RE.test(req.url)) {
    e.respondWith(caches.open(LIB_CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== self.location.origin) return; // 카카오·Supabase 등 외부는 그대로

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // 폴더 주소(…/trip-together/)는 index.html로, ?room=코드 같은 뒤쪽 값은 무시하고 저장
    const key = url.origin + (url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname);
    const net = fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res && res.ok) cache.put(key, res.clone());
      return res;
    });
    const timeout = new Promise((r) => setTimeout(() => r(null), TIMEOUT_MS));
    let res = await Promise.race([net.catch(() => null), timeout]);
    if (res) return res;

    const cached = await cache.match(key, { ignoreSearch: true });
    if (cached) { e.waitUntil(net.catch(() => {})); return cached; }
    res = await net.catch(() => null);
    return res || new Response('오프라인 상태입니다.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});
