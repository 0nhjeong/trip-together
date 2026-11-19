/* ============================================================
 *  mapService — 지도/장소검색 추상화 계층
 * ------------------------------------------------------------
 *  앱(app.js)은 이 파일이 돌려주는 객체만 사용합니다.
 *  해외용 지도(예: Google Maps)를 추가하려면:
 *    1) js/map/googleProvider.js 를 만들어 아래 "Provider 인터페이스"를 구현
 *    2) PROVIDERS 에 등록하고 config.js 의 MAP_PROVIDER 값을 바꾸면 끝.
 *
 *  Provider 인터페이스
 *    name                                   : 'kakao' | 'demo' | ...
 *    init(el, { center, onMapTap })         : Promise<void>
 *        onMapTap({lat,lng}, {long:boolean}) — 빈 지도 탭/꾹 누르기
 *    setMarkers([{ id, lat, lng, color, label, faded, selected, tag, numbered, temp }], onMarkerTap(id))
 *    setRoutes([{ points:[{lat,lng}], color }])     — 점선 동선
 *    panTo({lat,lng}, { offsetY })          — offsetY: 화면 중앙보다 위로 띄울 px (바텀시트 가림 보정)
 *    fitTo([{lat,lng}], { top, bottom })    — 여백(px)을 두고 모두 보이게
 *    getCenter()                            : {lat,lng}
 *    search(keyword, { center })            : Promise<[SearchResult]>
 *        SearchResult = { providerId, name, address, lat, lng, phone, url, category, categoryText }
 *        category 는 앱 카테고리 키(food/cafe/stay/tour/shop) 또는 null
 *    reverseGeocode({lat,lng})              : Promise<string>
 *    relayout()
 *    links(place)                           : { naver, directions }  (외부 지도 바로가기)
 * ============================================================ */
import { createKakaoProvider } from './kakaoProvider.js';
import { createDemoProvider } from './demoProvider.js';

const PROVIDERS = {
  kakao: (cfg) => (cfg.KAKAO_JS_KEY ? createKakaoProvider(cfg.KAKAO_JS_KEY) : null),
  // google: (cfg) => createGoogleProvider(cfg.GOOGLE_MAPS_KEY),  ← 해외용 추가 자리
};

/** 국내용 기본 외부 링크 (provider가 links를 따로 주지 않으면 사용) */
export function koreanLinks(place) {
  const name = place.name || '목적지';
  return {
    naver: `https://map.naver.com/p/search/${encodeURIComponent(name)}`,
    directions: `https://map.kakao.com/link/to/${encodeURIComponent(name)},${place.lat},${place.lng}`,
  };
}

/**
 * 지도 서비스 생성. 키가 없거나 SDK 로드에 실패하면 데모 지도로 자동 대체합니다.
 * @returns {Promise<{ map: Provider, demo: boolean, error?: string }>}
 */
export async function createMapService(cfg, el, opts) {
  const factory = PROVIDERS[cfg.MAP_PROVIDER || 'kakao'];
  const real = factory ? factory(cfg) : null;
  if (real) {
    try {
      await real.init(el, opts);
      return { map: wrap(real), demo: false };
    } catch (err) {
      console.warn('[mapService] 실제 지도 로드 실패 → 데모 지도로 전환', err);
      el.innerHTML = '';
      const demo = createDemoProvider();
      await demo.init(el, opts);
      return { map: wrap(demo), demo: true, error: err.message || String(err) };
    }
  }
  const demo = createDemoProvider();
  await demo.init(el, opts);
  return { map: wrap(demo), demo: true };
}

function wrap(p) {
  if (!p.links) p.links = koreanLinks;
  return p;
}
