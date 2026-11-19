/* 같이갈래 - Service Worker (홈 화면 설치용)
 * 코드를 고쳐 다시 배포할 때는 CACHE 이름의 숫자를 올려 주세요.
 *
 * 동작 방식: 인터넷이 되면 항상 서버의 최신 파일을 씁니다(network-first).
 *           인터넷이 안 되거나 4초 넘게 느리면 저장해 둔 앱 화면으로 실행합니다.
 *           카카오맵·Supabase 같은 외부 요청은 건드리지 않습니다(여행 데이터는 항상 실시간).
 */
const CACHE = 'trip-together-v2';
const ASSETS = [
  './',
  './index.html',
  './config.js',
  './css/style.css',
  './js/app.js',
  './js/store.js',
  './js/map/mapService.js',
  './js/map/kakaoProvider.js',
  './js/map/demoProvider.js',
  './js/map/pinEl.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 카카오·Supabase·폰트 등 외부는 그대로

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // ?room=코드 처럼 주소 뒤 값만 다른 화면은 같은 index.html로 저장
    const key = req.mode === 'navigate' ? new URL('./index.html', self.registration.scope).href : url.origin + url.pathname;
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
