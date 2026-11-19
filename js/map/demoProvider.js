/* 데모 지도 provider — 카카오 키가 없을 때 UI 미리보기용 (가짜 타일 + 부산 샘플 검색) */
import { makePinEl, attachLongPress } from './pinEl.js';

const SAMPLE = [
  ['광안리 돼지국밥 (샘플)', '부산 수영구 광안해변로 (샘플)', 35.1549, 129.1179, 'food', '국밥'],
  ['민락 수변 국밥집 (샘플)', '부산 수영구 민락동 (샘플)', 35.1563, 129.1311, 'food', '국밥'],
  ['광안리 회센터 (샘플)', '부산 수영구 민락수변로 (샘플)', 35.1555, 129.1296, 'food', '회 해산물'],
  ['광안대교 뷰 카페 (샘플)', '부산 수영구 광안해변로 (샘플)', 35.1519, 129.1167, 'cafe', '카페 디저트'],
  ['광안리 해수욕장', '부산 수영구 광안동', 35.1532, 129.1186, 'tour', '해수욕장 바다 야경'],
  ['해운대 해수욕장', '부산 해운대구 우동', 35.1587, 129.1604, 'tour', '해수욕장 바다'],
  ['해운대 오션뷰 카페 (샘플)', '부산 해운대구 달맞이길 (샘플)', 35.1590, 129.1735, 'cafe', '카페 오션뷰'],
  ['해리단길 브런치 (샘플)', '부산 해운대구 우동 (샘플)', 35.1633, 129.1592, 'cafe', '카페 브런치'],
  ['해운대 시장 떡볶이 (샘플)', '부산 해운대구 구남로 (샘플)', 35.1622, 129.1628, 'food', '분식 시장'],
  ['해운대 블루라인파크', '부산 해운대구 중동', 35.1608, 129.1712, 'tour', '해변열차 스카이캡슐'],
  ['해운대 비치 호텔 (샘플)', '부산 해운대구 해운대해변로 (샘플)', 35.1596, 129.1585, 'stay', '호텔 숙소'],
  ['광안리 게스트하우스 (샘플)', '부산 수영구 광안동 (샘플)', 35.1561, 129.1158, 'stay', '게스트하우스 숙소'],
  ['송정 해수욕장', '부산 해운대구 송정동', 35.1786, 129.1997, 'tour', '해수욕장 서핑'],
  ['송정 서핑 카페 (샘플)', '부산 해운대구 송정해변로 (샘플)', 35.1795, 129.2003, 'cafe', '카페'],
  ['해동용궁사', '부산 기장군 기장읍', 35.1883, 129.2233, 'tour', '절 사찰 바다'],
  ['서면 밀면 (샘플)', '부산 부산진구 서면 (샘플)', 35.1578, 129.0596, 'food', '밀면 서면'],
  ['전포 카페거리 (샘플)', '부산 부산진구 전포동 (샘플)', 35.1555, 129.0636, 'cafe', '카페거리 서면'],
  ['자갈치시장', '부산 중구 남포동', 35.0966, 129.0306, 'shop', '시장 해산물 남포'],
  ['국제시장', '부산 중구 신창동', 35.1013, 129.0285, 'shop', '시장 남포'],
  ['BIFF 광장 씨앗호떡 (샘플)', '부산 중구 남포동 (샘플)', 35.0985, 129.0278, 'food', '호떡 길거리 남포'],
  ['감천문화마을', '부산 사하구 감천동', 35.0975, 129.0106, 'tour', '마을 포토존'],
  ['흰여울문화마을', '부산 영도구 영선동', 35.0782, 129.0453, 'tour', '영도 바다 마을'],
  ['태종대', '부산 영도구 동삼동', 35.0532, 129.0870, 'tour', '영도 공원'],
  ['영도 바다뷰 베이커리 (샘플)', '부산 영도구 (샘플)', 35.0791, 129.0470, 'cafe', '카페 베이커리 영도'],
  ['신세계 센텀시티', '부산 해운대구 우동', 35.1689, 129.1295, 'shop', '백화점 쇼핑 센텀'],
];

const TILE = 40;
const clampLat = (v) => Math.max(-85, Math.min(85, v));

function project(lat, lng, z) {
  const s = 256 * Math.pow(2, z);
  const sin = Math.sin((clampLat(lat) * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
}
function unproject(x, y, z) {
  const s = 256 * Math.pow(2, z);
  const lng = (x / s) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / s;
  return { lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng };
}

export function createDemoProvider() {
  let el, layer, svg, onTap;
  let zoom = 14;
  let C = { x: 0, y: 0 }; // 중심 world px
  let pins = []; // {node, lat, lng}
  let routes = [];
  let tapFn = null;

  const size = () => ({ w: el.clientWidth, h: el.clientHeight });
  const toScreen = (p) => {
    const q = project(p.lat, p.lng, zoom); const { w, h } = size();
    return { x: q.x - C.x + w / 2, y: q.y - C.y + h / 2 };
  };
  const toLatLng = (x, y) => { const { w, h } = size(); return unproject(C.x + x - w / 2, C.y + y - h / 2, zoom); };

  function render() {
    el.style.backgroundPosition = `${-C.x % TILE}px ${-C.y % TILE}px`;
    pins.forEach((p) => {
      const s = toScreen(p);
      p.node.style.left = `${s.x}px`;
      p.node.style.top = `${s.y}px`;
    });
    svg.innerHTML = routes.filter((r) => r.points.length > 1).map((r) => {
      const pts = r.points.map((p) => { const s = toScreen(p); return `${s.x.toFixed(1)},${s.y.toFixed(1)}`; }).join(' ');
      return `<polyline points="${pts}" fill="none" stroke="${r.color}" stroke-width="4" stroke-opacity=".85" stroke-dasharray="2 9" stroke-linecap="round" stroke-linejoin="round"/>`;
    }).join('');
  }

  function setZoom(z, ax, ay) {
    z = Math.max(5, Math.min(19, z));
    const { w, h } = size();
    ax = ax ?? w / 2; ay = ay ?? h / 2;
    const anchor = toLatLng(ax, ay);
    zoom = z;
    const a = project(anchor.lat, anchor.lng, zoom);
    C = { x: a.x - (ax - w / 2), y: a.y - (ay - h / 2) };
    render();
  }

  return {
    name: 'demo',

    async init(container, { center, onMapTap }) {
      el = container;
      onTap = onMapTap;
      el.innerHTML = `<div class="demo-map"><svg></svg><div class="layer"></div>
        <div class="zoom" style="top:calc(env(safe-area-inset-top,0px) + 150px)"><button type="button" data-z="1" aria-label="확대">＋</button><button type="button" data-z="-1" aria-label="축소">－</button></div>
        <div class="watermark">DEMO MAP · 카카오 키 입력 전 미리보기</div></div>`;
      const root = el.firstElementChild;
      el = root;
      svg = root.querySelector('svg');
      layer = root.querySelector('.layer');
      const c = project(center.lat, center.lng, zoom); C = { x: c.x, y: c.y };

      root.querySelectorAll('.zoom button').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation(); setZoom(zoom + Number(b.dataset.z));
      }));

      // 드래그/탭/핀치
      const ptrs = new Map();
      let start = null, moved = false, pinch = null;
      root.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.pin-wrap, .zoom')) return;
        root.setPointerCapture(e.pointerId);
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ptrs.size === 1) { start = { x: e.clientX, y: e.clientY, C: { ...C } }; moved = false; }
        if (ptrs.size === 2) {
          const [a, b] = [...ptrs.values()];
          pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom }; moved = true;
        }
      });
      root.addEventListener('pointermove', (e) => {
        if (!ptrs.has(e.pointerId)) return;
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && ptrs.size === 2) {
          const [a, b] = [...ptrs.values()];
          const r = root.getBoundingClientRect();
          setZoom(pinch.z + Math.log2(Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
          return;
        }
        if (!start) return;
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (!moved && Math.hypot(dx, dy) < 6) return;
        moved = true; root.classList.add('dragging');
        C = { x: start.C.x - dx, y: start.C.y - dy };
        render();
      });
      const end = (e) => {
        if (!ptrs.has(e.pointerId)) return;
        ptrs.delete(e.pointerId);
        root.classList.remove('dragging');
        if (ptrs.size < 2) pinch = null;
        if (ptrs.size === 0) {
          if (start && !moved && e.type === 'pointerup') {
            const r = root.getBoundingClientRect();
            onTap(toLatLng(e.clientX - r.left, e.clientY - r.top), { long: false });
          }
          start = null;
        } else {
          const [p] = [...ptrs.values()];
          start = { x: p.x, y: p.y, C: { ...C } };
        }
      };
      root.addEventListener('pointerup', end);
      root.addEventListener('pointercancel', end);
      root.addEventListener('wheel', (e) => {
        e.preventDefault();
        const r = root.getBoundingClientRect();
        setZoom(zoom - Math.sign(e.deltaY) * 0.5, e.clientX - r.left, e.clientY - r.top);
      }, { passive: false });
      attachLongPress(root, (x, y) => { moved = true; onTap(toLatLng(x, y), { long: true }); });
      window.addEventListener('resize', render);
      render();
    },

    setMarkers(list, onMarkerTap) {
      tapFn = onMarkerTap;
      layer.innerHTML = '';
      pins = list.map((m) => {
        const node = makePinEl(m, (id) => tapFn && tapFn(id));
        node.style.zIndex = m.temp ? 60 : m.selected ? 50 : m.faded ? 1 : 10;
        layer.appendChild(node);
        return { node, lat: m.lat, lng: m.lng };
      });
      render();
    },

    setRoutes(r) { routes = r; render(); },

    panTo(p, { offsetY = 0 } = {}) {
      if (zoom < 14) zoom = 15;
      const q = project(p.lat, p.lng, zoom);
      C = { x: q.x, y: q.y + offsetY };
      render();
    },

    fitTo(points, { top = 0, bottom = 0 } = {}) {
      if (!points.length) return;
      if (points.length === 1) { this.panTo(points[0], { offsetY: (bottom - top) / 2 }); return; }
      const { w, h } = size();
      const ps = points.map((p) => project(p.lat, p.lng, 0));
      const minX = Math.min(...ps.map((p) => p.x)), maxX = Math.max(...ps.map((p) => p.x));
      const minY = Math.min(...ps.map((p) => p.y)), maxY = Math.max(...ps.map((p) => p.y));
      const availW = Math.max(80, w - 130), availH = Math.max(80, h - top - bottom - 80);
      const zx = Math.log2(availW / Math.max(1e-9, maxX - minX));
      const zy = Math.log2(availH / Math.max(1e-9, maxY - minY));
      zoom = Math.max(5, Math.min(16, Math.min(zx, zy)));
      const s = Math.pow(2, zoom);
      C = { x: ((minX + maxX) / 2) * s, y: ((minY + maxY) / 2) * s + (bottom - top) / 2 };
      render();
    },

    getCenter() { const { w, h } = size(); return toLatLng(w / 2, h / 2); },

    async search(keyword) {
      const tokens = keyword.trim().split(/\s+/).filter(Boolean);
      if (!tokens.length) return [];
      return SAMPLE.map(([name, address, lat, lng, category, tags], i) => {
        const hay = `${name} ${address} ${tags}`;
        const score = tokens.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
        return { score, r: { providerId: `demo:${i}`, name, address, lat, lng, phone: '', url: '', category, categoryText: tags.split(' ')[0] } };
      }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x) => x.r);
    },

    async reverseGeocode({ lat, lng }) {
      return `위도 ${lat.toFixed(4)}, 경도 ${lng.toFixed(4)} 부근`;
    },

    relayout() { render(); },
  };
}
