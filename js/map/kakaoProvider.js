/* Kakao Maps JavaScript SDK provider (libraries=services: Places 키워드 검색 + Geocoder) */
import { makePinEl, attachLongPress } from './pinEl.js';

// 카카오 카테고리 그룹 코드 → 앱 카테고리
const KAKAO_CAT = { FD6: 'food', CE7: 'cafe', AD5: 'stay', AT4: 'tour', CT1: 'tour', MT1: 'shop', CS2: 'shop' };

function loadSdk(appKey) {
  return new Promise((resolve, reject) => {
    if (window.kakao && window.kakao.maps && window.kakao.maps.services) return resolve();
    const s = document.createElement('script');
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&libraries=services&autoload=false`;
    const timer = setTimeout(() => reject(new Error('카카오맵 SDK 응답 없음')), 12000);
    s.onload = () => {
      if (!window.kakao || !window.kakao.maps) {
        clearTimeout(timer);
        return reject(new Error('카카오맵 SDK 초기화 실패 (키 또는 도메인 등록 확인)'));
      }
      window.kakao.maps.load(() => { clearTimeout(timer); resolve(); });
    };
    s.onerror = () => { clearTimeout(timer); reject(new Error('카카오맵 SDK 로드 실패 — JavaScript 키와 사이트 도메인 등록을 확인하세요')); };
    document.head.appendChild(s);
  });
}

export function createKakaoProvider(appKey) {
  let K, map, el, geocoder, places;
  let overlays = [];
  let lines = [];

  const LL = (p) => new K.LatLng(p.lat, p.lng);

  return {
    name: 'kakao',

    async init(container, { center, onMapTap }) {
      await loadSdk(appKey);
      K = window.kakao.maps;
      el = container;
      map = new K.Map(el, { center: LL(center), level: 6 });
      geocoder = new K.services.Geocoder();
      places = new K.services.Places();

      K.event.addListener(map, 'click', (e) => {
        onMapTap({ lat: e.latLng.getLat(), lng: e.latLng.getLng() }, { long: false });
      });
      K.event.addListener(map, 'rightclick', (e) => {
        onMapTap({ lat: e.latLng.getLat(), lng: e.latLng.getLng() }, { long: true });
      });
      // 모바일 꾹 누르기
      attachLongPress(el, (x, y) => {
        const ll = map.getProjection().coordsFromContainerPoint(new K.Point(x, y));
        onMapTap({ lat: ll.getLat(), lng: ll.getLng() }, { long: true });
      });
      window.addEventListener('resize', () => map.relayout());
    },

    setMarkers(list, onMarkerTap) {
      overlays.forEach((o) => o.setMap(null));
      overlays = list.map((m, i) => {
        const node = makePinEl(m, onMarkerTap);
        const ov = new K.CustomOverlay({
          position: LL(m), content: node, xAnchor: 0.5, yAnchor: 1, clickable: true,
          zIndex: m.selected ? 50 : m.temp ? 60 : m.faded ? 1 : 10 + i,
        });
        ov.setMap(map);
        return ov;
      });
    },

    setRoutes(routes) {
      lines.forEach((l) => l.setMap(null));
      lines = routes.filter((r) => r.points.length > 1).map((r) => {
        const pl = new K.Polyline({
          path: r.points.map(LL), strokeWeight: 4, strokeColor: r.color,
          strokeOpacity: 0.85, strokeStyle: 'shortdash',
        });
        pl.setMap(map);
        return pl;
      });
    },

    panTo(p, { offsetY = 0 } = {}) {
      if (map.getLevel() > 5) map.setLevel(4);
      map.setCenter(LL(p));
      if (offsetY) map.panBy(0, offsetY);
    },

    fitTo(points, { top = 0, bottom = 0 } = {}) {
      if (!points.length) return;
      if (points.length === 1) { this.panTo(points[0], { offsetY: (bottom - top) / 2 }); return; }
      const b = new K.LatLngBounds();
      points.forEach((p) => b.extend(LL(p)));
      map.setBounds(b, top + 40, 50, bottom + 30, 50);
    },

    getCenter() {
      const c = map.getCenter();
      return { lat: c.getLat(), lng: c.getLng() };
    },

    search(keyword, { center } = {}) {
      return new Promise((resolve, reject) => {
        const opt = { size: 15 };
        if (center) { opt.location = LL(center); }
        places.keywordSearch(keyword, (data, status) => {
          if (status === K.services.Status.ZERO_RESULT) return resolve([]);
          if (status !== K.services.Status.OK) return reject(new Error('장소 검색 실패'));
          resolve(data.map((d) => ({
            providerId: `kakao:${d.id}`,
            name: d.place_name,
            address: d.road_address_name || d.address_name,
            lat: Number(d.y), lng: Number(d.x),
            phone: d.phone || '',
            url: d.place_url || '',
            category: KAKAO_CAT[d.category_group_code] || guessCategory(d.category_name),
            categoryText: (d.category_name || '').split('>').pop().trim(),
          })));
        }, opt);
      });
    },

    reverseGeocode({ lat, lng }) {
      return new Promise((resolve) => {
        geocoder.coord2Address(lng, lat, (res, status) => {
          if (status !== K.services.Status.OK || !res[0]) return resolve('');
          const r = res[0];
          resolve((r.road_address && r.road_address.address_name) || (r.address && r.address.address_name) || '');
        });
      });
    },

    relayout() { map && map.relayout(); },
  };
}

function guessCategory(text = '') {
  if (/음식|식당|한식|분식|일식|중식|양식|술집|국밥|고기/.test(text)) return 'food';
  if (/카페|디저트|베이커리|제과/.test(text)) return 'cafe';
  if (/숙박|호텔|펜션|게스트|모텔|리조트/.test(text)) return 'stay';
  if (/쇼핑|시장|백화점|마트|아울렛|상가/.test(text)) return 'shop';
  if (/관광|명소|해수욕장|공원|박물관|전시|문화/.test(text)) return 'tour';
  return null;
}
