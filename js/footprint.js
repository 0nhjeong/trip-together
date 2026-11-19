/* ============================================================
 *  내 여행 발자국 — 대한민국 시·군·구 색칠 & 포토맵
 *  - 개인 기록용: 이 기기(브라우저)에만 저장. 여행 방(Supabase)과는 별개.
 *  - 기록: localStorage('gachi:footprint:v1'), 사진: IndexedDB('gachi-footprint')
 *  - 경계 데이터: 통계청(KOSTAT) 2018 시·군·구 경계 (southkorea/southkorea-maps)
 *    → data/skorea-municipalities-2018.topo.json, d3-geo + topojson으로 그림
 * ============================================================ */
const d3 = window.d3;
const topojson = window.topojson;

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let toastT;
function toast(msg, ms = 2400) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const DATA_URL = './data/skorea-municipalities-2018.topo.json';
const LS_KEY = 'gachi:footprint:v1';
const TOTAL_LABEL = '전국 시·군·구';

// 시·도 코드(통계청 2018) → [짧은 이름, 현재 정식 이름]
const PROV = {
  11: ['서울', '서울특별시'], 21: ['부산', '부산광역시'], 22: ['대구', '대구광역시'], 23: ['인천', '인천광역시'],
  24: ['광주', '광주광역시'], 25: ['대전', '대전광역시'], 26: ['울산', '울산광역시'], 29: ['세종', '세종특별자치시'],
  31: ['경기', '경기도'], 32: ['강원', '강원특별자치도'], 33: ['충북', '충청북도'], 34: ['충남', '충청남도'],
  35: ['전북', '전북특별자치도'], 36: ['전남', '전라남도'], 37: ['경북', '경상북도'], 38: ['경남', '경상남도'],
  39: ['제주', '제주특별자치도'],
};
// 2018년 이후 바뀐 소속: 군위군은 2023년 7월 대구광역시로 편입
const PROV_FIX = { 37310: '22' };

// 따뜻한 파스텔 팔레트
const PALETTE = [
  ['#F7A99B', '코랄'], ['#FFC9A0', '살구'], ['#FFE39A', '레몬'], ['#CFE6A8', '연두'], ['#A6DCC5', '민트'],
  ['#A7D0EC', '하늘'], ['#C3BFF0', '라벤더'], ['#F4B5D2', '체리'], ['#E6CBA6', '모래'], ['#B7CEC3', '세이지'],
];
const BASE_FILL = '#EFE7DB';

/* ---------- 저장소 ---------- */
function loadDb() {
  try { const d = JSON.parse(localStorage.getItem(LS_KEY)); if (d && d.regions) return d; } catch (_) {}
  return { regions: {} };
}
let DB = loadDb();
function saveDb() {
  DB.updatedAt = Date.now();
  try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); }
  catch (err) { toast('저장 공간이 부족해요. 백업 후 일부 기록을 지워 주세요.', 4000); }
}
const rec = (code) => DB.regions[code];
const isDecorated = (r) => !!(r && (r.color || r.photo));
function hasAnything(r) { return !!(r && (r.color || r.photo || r.date || r.with || r.memo)); }

// IndexedDB: 사진(Blob) 보관 — localStorage 용량(5MB) 초과를 막기 위해 분리
const idb = (() => {
  let p;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('gachi-footprint', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('photos');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('photos', mode);
      const req = fn(t.objectStore('photos'));
      t.oncomplete = () => res(req ? req.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('저장 실패'));
    });
  };
  return {
    get: (k) => run('readonly', (s) => s.get(k)),
    put: (k, v) => run('readwrite', (s) => s.put(v, k)),
    del: (k) => run('readwrite', (s) => s.delete(k)),
    keys: () => run('readonly', (s) => s.getAllKeys()),
  };
})();
const photoUrl = new Map(); // code → objectURL
async function loadPhotoUrl(code) {
  if (photoUrl.has(code)) return photoUrl.get(code);
  const blob = await idb.get(code).catch(() => null);
  if (!blob) return null;
  const u = URL.createObjectURL(blob); photoUrl.set(code, u); return u;
}
function dropPhotoUrl(code) { const u = photoUrl.get(code); if (u) URL.revokeObjectURL(u); photoUrl.delete(code); }

/* ---------- 지역 데이터 ---------- */
let topo, geoms, regions = [], byCode = new Map(), provs = [];
const provOf = (code) => PROV_FIX[code] || String(code).slice(0, 2);
function prettyName(name, code) {
  if (String(code).startsWith('29')) return '세종특별자치시';
  const m = /^(\S+?시)(\S+구)$/.exec(name); // 수원시장안구 → 수원시 장안구
  return m ? `${m[1]} ${m[2]}` : name;
}
function shortLabel(name, code) {
  if (String(code).startsWith('29')) return '세종';
  const m = /^(\S+?시)(\S+구)$/.exec(name);
  return m ? m[2] : name;
}

/* ---------- 지도 ---------- */
let W = 0, H = 0, proj, pathGen;
let svg, gRoot, gBase, gPhotos, gBorder, gSel, gLabels, defs, zoom;
let curT = d3.zoomIdentity;
let sel = null;

async function boot() {
  try {
    if (!d3 || !topojson) throw new Error('지도 라이브러리를 불러오지 못했어요 (인터넷 연결 확인)');
    topo = await fetch(DATA_URL).then((r) => { if (!r.ok) throw new Error('지도 데이터를 불러오지 못했어요'); return r.json(); });
  } catch (err) { $('#fpLoading').textContent = err.message; return; }

  const obj = topo.objects[Object.keys(topo.objects)[0]];
  geoms = obj.geometries;
  const features = topojson.feature(topo, obj).features;
  regions = features.map((f) => {
    const { code, name } = f.properties;
    const p = provOf(code);
    const r = {
      code: String(code), name, prov: p, provShort: PROV[p][0], provName: PROV[p][1],
      label: shortLabel(name, code), feature: f,
    };
    r.full = String(code).startsWith('29') ? '세종특별자치시' : `${r.provShort} ${prettyName(name, code)}`;
    byCode.set(r.code, r);
    return r;
  });
  provs = Object.keys(PROV).map((p) => ({
    code: p, short: PROV[p][0], name: PROV[p][1],
    geo: topojson.merge(topo, geoms.filter((g) => provOf(g.properties.code) === p)),
  }));

  // 다른 기기에서 가져온 기록 중 사진이 실제로 없으면 표시 정리
  const keys = new Set((await idb.keys().catch(() => [])).map(String));
  Object.entries(DB.regions).forEach(([c, r]) => { if (r.photo && !keys.has(c)) r.photo = false; });

  buildSvg();
  renderAll();
  renderStats();
  bindUi();
  $('#fpLoading').hidden = true;
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

function measure() {
  const el = $('#fpMap');
  W = el.clientWidth; H = el.clientHeight;
}

// 화면 맞춤용 모양: 울릉도·독도까지 모두 첫 화면에 들어오게 전체 기준
function fitShape() {
  return { type: 'FeatureCollection', features: regions.map((r) => r.feature) };
}
// 시·도 이름 위치 (경기·서울, 충남·세종이 겹치지 않게 직접 지정, [경도, 위도])
const PROV_LABEL_AT = {
  11: [126.98, 37.56], 21: [129.05, 35.19], 22: [128.6, 35.85], 23: [126.58, 37.46], 24: [126.86, 35.15],
  25: [127.4, 36.33], 26: [129.25, 35.55], 29: [127.26, 36.58], 31: [127.47, 37.72], 32: [128.3, 37.72],
  33: [127.78, 36.86], 34: [126.78, 36.48], 35: [127.12, 35.74], 36: [126.92, 34.86], 37: [128.75, 36.35],
  38: [128.25, 35.32], 39: [126.55, 33.38],
};

function buildSvg() {
  measure();
  svg = d3.select('#fpSvg').attr('viewBox', `0 0 ${W} ${H}`);
  svg.selectAll('*').remove();
  defs = svg.append('defs');
  gRoot = svg.append('g');
  gBase = gRoot.append('g').attr('class', 'g-base');
  gPhotos = gRoot.append('g').attr('class', 'g-photos').style('pointer-events', 'none');
  gBorder = gRoot.append('g').attr('class', 'g-border').style('pointer-events', 'none');
  gSel = gRoot.append('g').style('pointer-events', 'none');
  gLabels = gRoot.append('g').attr('class', 'g-labels').style('pointer-events', 'none');

  // 위쪽에 떠 있는 통계·검색, 아래쪽 안내 문구를 피해서 맞춤
  const pad = Math.min(W, H) * 0.025;
  const top = floatH() + 6;
  proj = d3.geoMercator().fitExtent([[pad, top], [W - pad, H - 40]], fitShape());
  pathGen = d3.geoPath(proj);
  regions.forEach((r) => {
    r.d = pathGen(r.feature);
    r.b = pathGen.bounds(r.feature);
    r.c = pathGen.centroid(r.feature);
    r.bw = r.b[1][0] - r.b[0][0];
  });
  provs.forEach((p) => { p.b = pathGen.bounds(p.geo); p.c = proj(PROV_LABEL_AT[p.code]) || pathGen.centroid(p.geo); });

  gBase.selectAll('path').data(regions, (r) => r.code).join('path')
    .attr('class', 'rg').attr('d', (r) => r.d).attr('data-code', (r) => r.code)
    .on('click', (e, r) => { e.stopPropagation(); selectRegion(r.code, { zoomTo: false }); });

  // 시·도 경계와 해안선
  gBorder.append('path').attr('class', 'prov-line')
    .attr('d', pathGen(topojson.mesh(topo, topo.objects[Object.keys(topo.objects)[0]], (a, b) => a !== b && provOf(a.properties.code) !== provOf(b.properties.code))));
  gBorder.append('path').attr('class', 'coast-line')
    .attr('d', pathGen(topojson.mesh(topo, topo.objects[Object.keys(topo.objects)[0]], (a, b) => a === b)));

  // 라벨: 시·도(멀리서), 시·군·구(가까이서)
  gLabels.selectAll('text.pl').data(provs).join('text').attr('class', 'pl')
    .attr('x', (p) => p.c[0]).attr('y', (p) => p.c[1]).text((p) => p.short);
  gLabels.selectAll('text.ml').data(regions).join('text').attr('class', 'ml')
    .attr('x', (r) => r.c[0]).attr('y', (r) => r.c[1]).text((r) => r.label);

  zoom = d3.zoom().scaleExtent([1, 60])
    .translateExtent([[-W * 0.3, -H * 0.3], [W * 1.3, H * 1.3]])
    .on('zoom', (e) => {
      curT = e.transform; gRoot.attr('transform', curT);
      scheduleLabels();
      if (e.sourceEvent) $('#fpHint').classList.add('fade');
    });
  svg.call(zoom).on('dblclick.zoom', null);
  svg.on('click', () => { if (sel) closeSheet(); });
  gRoot.attr('transform', curT);
  updateLabels();
}

let labelRaf = 0;
function scheduleLabels() { if (!labelRaf) labelRaf = requestAnimationFrame(() => { labelRaf = 0; updateLabels(); }); }
function updateLabels() {
  const k = curT.k;
  gLabels.selectAll('text.pl').attr('font-size', 13 / k).attr('stroke-width', 3 / k)
    .style('display', k < 2.4 ? null : 'none');
  gLabels.selectAll('text.ml').attr('font-size', 10.5 / k).attr('stroke-width', 2.6 / k)
    .style('display', (r) => (k >= 2.4 && r.bw * k > 38) || (k >= 1.6 && r.bw * k > 60) ? null : 'none');
  gSel.selectAll('path').attr('stroke-width', 2.6);
}

function fillOf(r) {
  const x = rec(r.code);
  if (x && x.color) return x.color;
  if (x && x.photo) return '#FFFFFF';
  return BASE_FILL;
}

function renderAll() {
  gBase.selectAll('path.rg').attr('fill', fillOf).classed('done', (r) => isDecorated(rec(r.code)));
  regions.forEach((r) => renderPhoto(r.code));
  renderSel();
}

// 사진: 지역 모양(clipPath) 안에 이미지를 꽉 채워 넣고, 확대·위치·투명도 반영
async function renderPhoto(code) {
  const r = byCode.get(code); const x = rec(code);
  const gid = `ph-${code}`;
  let g = gPhotos.select(`#${gid}`);
  if (!x || !x.photo) { g.remove(); defs.select(`#clip-${code}`).remove(); return; }
  const url = await loadPhotoUrl(code);
  if (!url) { g.remove(); return; }
  if (defs.select(`#clip-${code}`).empty()) defs.append('clipPath').attr('id', `clip-${code}`).append('path').attr('d', r.d);
  if (g.empty()) { g = gPhotos.append('g').attr('id', gid).attr('clip-path', `url(#clip-${code})`); g.append('image').attr('preserveAspectRatio', 'none'); }
  const box = photoBox(r, x);
  g.select('image').attr('href', url).attr('x', box.x).attr('y', box.y).attr('width', box.w).attr('height', box.h)
    .attr('opacity', x.opacity ?? 1);
}
function photoBox(r, x, b = r.b) {
  const bw = b[1][0] - b[0][0]; const bh = b[1][1] - b[0][1];
  const pw = x.pw || 1; const ph = x.ph || 1;
  const s = Math.max(bw / pw, bh / ph) * (x.zoom || 1);
  const w = pw * s; const h = ph * s;
  const cx = (b[0][0] + b[1][0]) / 2; const cy = (b[0][1] + b[1][1]) / 2;
  return { x: cx - w / 2 - (x.px || 0) * (w - bw) / 2, y: cy - h / 2 - (x.py || 0) * (h - bh) / 2, w, h };
}

function renderSel() {
  const r = sel && byCode.get(sel);
  gSel.selectAll('path').data(r ? [r] : []).join('path').attr('class', 'sel-line').attr('d', (d) => d.d);
}

/* ---------- 확대/이동 ---------- */
const floatH = () => { const f = $('#fpFloat'); return f ? f.offsetTop + f.offsetHeight : 0; };
// 지금 지도에서 가려지지 않고 보이는 세로 구간 [위, 아래]
function visibleBand() {
  const sh = $('#sheet');
  if (sel && !sh.hidden) return [10, Math.max(120, H - sh.offsetHeight)];
  return [floatH() + 4, H - 40];
}
function zoomToBounds(b, { maxK = 24 } = {}) {
  const [[x0, y0], [x1, y1]] = b;
  const [top, bottom] = visibleBand(); const visH = bottom - top;
  const k = Math.max(1, Math.min(maxK, 0.8 / Math.max((x1 - x0) / W, (y1 - y0) / visH)));
  const t = d3.zoomIdentity.translate(W / 2, top + visH / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
  svg.transition().duration(550).call(zoom.transform, t);
}

/* ---------- 상단 통계 ---------- */
function renderStats() {
  const total = regions.length;
  const vals = Object.entries(DB.regions).filter(([c, r]) => byCode.has(c) && isDecorated(r));
  const n = vals.length;
  const photos = vals.filter(([, r]) => r.photo).length;
  const provDone = new Set(vals.map(([c]) => byCode.get(c).prov)).size;
  const pct = total ? (n / total) * 100 : 0;
  $('#fpStats').innerHTML = `
    <div class="st-main"><b>${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%</b><span>전국 정복률</span></div>
    <div class="st-bar"><i style="width:${Math.max(n ? 1.5 : 0, pct)}%"></i></div>
    <div class="st-chips">
      <span>🎨 <b>${n}</b>/${total} 시·군·구</span>
      <span>📷 사진 <b>${photos}</b></span>
      <span>🗾 시·도 <b>${provDone}</b>/17</span>
    </div>`;
  $('#fpSub').textContent = '이 기기에만 저장돼요 · 나만 보는 기록';
}

/* ---------- 지역 시트 ---------- */
function selectRegion(code, { zoomTo = true } = {}) {
  sel = code; renderSel();
  const r = byCode.get(code);
  renderSheet();
  $('#sheet').hidden = false;
  document.body.classList.add('editing');
  requestAnimationFrame(() => $('#sheet').classList.add('open'));
  $('#fpHint').classList.add('fade');
  if (zoomTo) zoomToBounds(r.b);
  else {
    // 이미 보이는 지역을 눌렀을 때: 시트에 가려지면 보이는 곳으로 살짝 이동
    const [top, bottom] = visibleBand();
    const sy = curT.applyY((r.b[0][1] + r.b[1][1]) / 2);
    if (sy > bottom - 30 || sy < top) svg.transition().duration(350).call(zoom.translateBy, 0, ((top + bottom) / 2 - sy) / curT.k);
  }
}
function closeSheet() {
  sel = null; renderSel();
  document.body.classList.remove('editing');
  const s = $('#sheet'); s.classList.remove('open');
  setTimeout(() => { if (!sel) s.hidden = true; }, 220);
}

function renderSheet() {
  const r = byCode.get(sel); if (!r) return;
  const x = rec(sel) || {};
  const swatches = PALETTE.map(([c, n]) => `<button type="button" class="sw ${x.color === c ? 'on' : ''}" style="--c:${c}" data-color="${c}" aria-label="${n}" title="${n}"></button>`).join('');
  $('#sheet').innerHTML = `
    <div class="sh-grip"></div>
    <div class="sh-head">
      <div><h2>${esc(prettyName(r.name, r.code))}</h2><small>${esc(r.provName)}</small></div>
      <button type="button" class="sh-done" data-a="close">완료</button>
    </div>
    <div class="sh-body">
      <div class="sh-sec">
        <div class="sh-lab">🎨 색칠하기</div>
        <div class="swatches">${swatches}<button type="button" class="sw none ${!x.color ? 'on' : ''}" data-color="" aria-label="색 없음" title="색 없음">✕</button></div>
      </div>

      <div class="sh-sec">
        <div class="sh-lab">📷 사진으로 채우기 <small>지역 모양대로 쏙</small></div>
        ${x.photo ? `
          <div class="ph-row">
            <button type="button" class="btn sm" data-a="photo">사진 바꾸기</button>
            <button type="button" class="btn sm danger" data-a="photoDel">사진 빼기</button>
          </div>
          ${slider('opacity', '투명도', Math.round((x.opacity ?? 1) * 100), 10, 100, '%')}
          ${slider('zoom', '확대', Math.round((x.zoom || 1) * 100), 100, 400, '%')}
          ${slider('px', '좌우 위치', Math.round((x.px || 0) * 100), -100, 100, '')}
          ${slider('py', '위아래 위치', Math.round((x.py || 0) * 100), -100, 100, '')}
        ` : `<button type="button" class="btn block ph-add" data-a="photo">＋ 갤러리에서 사진 넣기</button>
             <p class="sh-note">사진은 자동으로 작게 줄여서(최대 너비 600px) 이 기기에 저장해요.</p>`}
      </div>

      <div class="sh-sec">
        <div class="sh-lab">✍️ 추억 기록</div>
        <div class="two">
          <label class="fld"><span>방문 날짜</span><input class="input" type="date" data-f="date" value="${esc(x.date || '')}"></label>
          <label class="fld"><span>함께 간 사람</span><input class="input" data-f="with" maxlength="40" placeholder="예: 가족, 민지" value="${esc(x.with || '')}"></label>
        </div>
        <label class="fld"><span>한 줄 추억</span><input class="input" data-f="memo" maxlength="80" placeholder="예: 경포대 일출 보고 순두부 먹은 날" value="${esc(x.memo || '')}"></label>
      </div>

      ${hasAnything(x) ? `<button type="button" class="btn block danger sh-clear" data-a="clear">이 지역 기록 모두 지우기</button>` : ''}
      <p class="sh-note center">바꾼 내용은 바로 저장돼요</p>
    </div>`;
}
function slider(key, label, val, min, max, unit) {
  return `<label class="sl"><span>${label}</span><input type="range" min="${min}" max="${max}" step="1" value="${val}" data-s="${key}"><output>${val}${unit}</output></label>`;
}

function patch(code, fields) {
  const cur = DB.regions[code] || {};
  const next = { ...cur, ...fields, updatedAt: Date.now() };
  if (!hasAnything(next)) delete DB.regions[code]; else DB.regions[code] = next;
  saveDb();
}

function bindUi() {
  // 뒤로: 같은 사이트에서 왔으면 이전 화면(여행 방)으로
  $('#fpBack').addEventListener('click', (e) => {
    try {
      if (document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1) { e.preventDefault(); history.back(); }
    } catch (_) {}
  });

  $('#zIn').onclick = () => svg.transition().duration(280).call(zoom.scaleBy, 1.7);
  $('#zOut').onclick = () => svg.transition().duration(280).call(zoom.scaleBy, 1 / 1.7);
  $('#zHome').onclick = () => svg.transition().duration(450).call(zoom.transform, d3.zoomIdentity);

  // 시트
  const sh = $('#sheet');
  sh.addEventListener('click', async (e) => {
    const sw = e.target.closest('[data-color]');
    if (sw) {
      patch(sel, { color: sw.dataset.color || null });
      gBase.selectAll('path.rg').filter((r) => r.code === sel).attr('fill', fillOf).classed('done', (r) => isDecorated(rec(r.code)));
      renderSheet(); renderStats(); return;
    }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') closeSheet();
    else if (a === 'photo') { $('#photoInput').value = ''; $('#photoInput').click(); }
    else if (a === 'photoDel') {
      if (!confirm('이 지역의 사진을 뺄까요?')) return;
      const code = sel;
      await idb.del(code).catch(() => {}); dropPhotoUrl(code);
      patch(code, { photo: false, pw: null, ph: null, zoom: null, px: null, py: null, opacity: null });
      gBase.selectAll('path.rg').filter((r) => r.code === code).attr('fill', fillOf);
      renderPhoto(code); renderSheet(); renderStats();
    } else if (a === 'clear') {
      if (!confirm('이 지역의 색·사진·기록을 모두 지울까요?')) return;
      const code = sel;
      await idb.del(code).catch(() => {}); dropPhotoUrl(code);
      delete DB.regions[code]; saveDb();
      gBase.selectAll('path.rg').filter((r) => r.code === code).attr('fill', fillOf).classed('done', false);
      renderPhoto(code); renderSheet(); renderStats(); toast('기록을 지웠어요');
    }
  });
  // 슬라이더: 움직이는 동안 지도에 바로 반영
  sh.addEventListener('input', (e) => {
    const s = e.target.dataset.s;
    if (s) {
      const v = Number(e.target.value);
      e.target.nextElementSibling.textContent = `${v}${s === 'opacity' || s === 'zoom' ? '%' : ''}`;
      const val = s === 'opacity' || s === 'zoom' ? v / 100 : v / 100;
      DB.regions[sel] = { ...(DB.regions[sel] || {}), [s]: val };
      renderPhoto(sel); saveLater();
      return;
    }
    const f = e.target.dataset.f;
    if (f) { patch(sel, { [f]: e.target.value.trim() || null }); renderStatsLater(); }
  });
  sh.addEventListener('change', (e) => { if (e.target.dataset.f) renderSheetKeepFocus(); });

  $('#photoInput').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0]; if (!file || !sel) return;
    const code = sel;
    try {
      toast('사진을 줄이는 중…', 1500);
      const { blob, w, h } = await compressImage(file);
      await idb.put(code, blob);
      dropPhotoUrl(code);
      const prev = rec(code) || {};
      patch(code, { photo: true, pw: w, ph: h, zoom: 1, px: 0, py: 0, opacity: prev.photo ? (prev.opacity ?? 1) : 1 });
      gBase.selectAll('path.rg').filter((r) => r.code === code).attr('fill', fillOf).classed('done', true);
      await renderPhoto(code);
      if (sel === code) renderSheet();
      renderStats();
      toast(`사진을 넣었어요 (${Math.round(blob.size / 1024)}KB)`);
    } catch (err) {
      console.error(err);
      toast(/quota|space|storage/i.test(String(err && (err.name + err.message))) ? '저장 공간이 부족해요' : '사진을 넣지 못했어요. 다른 사진으로 해 볼까요?', 3500);
    }
  });

  // 검색
  const inp = $('#fpSearch'); const box = $('#fpResults');
  const norm = (s) => s.replace(/\s+/g, '').toLowerCase();
  inp.addEventListener('input', () => {
    const q = norm(inp.value);
    if (!q) { box.hidden = true; return; }
    const pr = provs.filter((p) => norm(p.name).includes(q) || norm(p.short) === q)
      .map((p) => ({ t: 'p', key: p.code, title: `${p.name} 전체`, sub: '시·도로 이동' }));
    const rr = regions.filter((r) => norm(r.full).includes(q) || norm(r.provName + r.name).includes(q))
      .slice(0, 14).map((r) => ({ t: 'r', key: r.code, title: prettyName(r.name, r.code), sub: r.provName, done: isDecorated(rec(r.code)) }));
    const list = [...pr.slice(0, 2), ...rr];
    box.innerHTML = list.length
      ? list.map((x) => `<button type="button" data-t="${x.t}" data-k="${x.key}"><b>${esc(x.title)}</b><small>${esc(x.sub)}</small>${x.done ? '<i>🎨</i>' : ''}</button>`).join('')
      : '<div class="none">찾는 지역이 없어요</div>';
    box.hidden = false;
  });
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]'); if (!b) return;
    inp.value = ''; box.hidden = true; inp.blur();
    if (b.dataset.t === 'p') { closeSheet(); const p = provs.find((x) => x.code === b.dataset.k); zoomToBounds(p.b, { maxK: 10 }); }
    else selectRegion(b.dataset.k, { zoomTo: true });
  });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); box.querySelector('button')?.click(); } });
  document.addEventListener('click', (e) => { if (!e.target.closest('.fp-search')) box.hidden = true; });

  // 메뉴
  $('#fpMenuBtn').onclick = openMenu;
  $('#importInput').addEventListener('change', importBackup);

  window.addEventListener('resize', debounce(() => {
    const oldW = W, oldH = H; measure();
    if (Math.abs(oldW - W) < 2 && Math.abs(oldH - H) < 2) return;
    curT = d3.zoomIdentity; buildSvg(); renderAll();
  }, 200));
}
const saveLater = debounce(() => saveDb(), 300);
const renderStatsLater = debounce(() => renderStats(), 300);
function renderSheetKeepFocus() {
  // 기록 입력 후 '지우기' 버튼 표시 여부만 갱신 (입력 중 포커스는 유지)
  const has = hasAnything(rec(sel));
  const exists = !!$('#sheet .sh-clear');
  if (has !== exists && !$('#sheet').contains(document.activeElement)) renderSheet();
}

/* ---------- 사진 압축 (Canvas, 최대 너비 600px, WebP → 안 되면 JPEG) ---------- */
function loadImg(file) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(file); const img = new Image();
    img.onload = () => { res(img); setTimeout(() => URL.revokeObjectURL(u), 1000); };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('이미지를 읽을 수 없어요')); };
    img.src = u;
  });
}
const toBlob = (cv, type, q) => new Promise((res) => cv.toBlob(res, type, q));
async function compressImage(file, maxW = 600, maxH = 900) {
  const img = await loadImg(file);
  const s = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
  const w = Math.max(1, Math.round(img.naturalWidth * s)); const h = Math.max(1, Math.round(img.naturalHeight * s));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, w, h);
  let blob = await toBlob(cv, 'image/webp', 0.8);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob(cv, 'image/jpeg', 0.82); // 아이폰 사파리 등
  if (!blob) throw new Error('압축 실패');
  return { blob, w, h };
}
const blobToDataUrl = (b) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(b); });

/* ---------- 메뉴: PNG 저장 / 백업 / 복원 ---------- */
function openMenu() {
  const M = $('#menu');
  M.innerHTML = `<div class="panel center fp-menu">
    <h2>저장 · 백업</h2>
    <button type="button" class="btn block primary" data-m="png">🖼️ 지도를 이미지로 저장 (PNG)</button>
    <button type="button" class="btn block" data-m="export">📦 데이터 백업 (내보내기)</button>
    <button type="button" class="btn block" data-m="import">📥 백업 파일 가져오기 (복원)</button>
    <p class="sub">기록은 이 기기의 브라우저에만 저장돼요. 브라우저 데이터를 지우거나 폰을 바꾸기 전에 꼭 백업 파일을 저장해 두세요.</p>
    <button type="button" class="btn block" data-m="close" style="margin-top:4px">닫기</button>
  </div>`;
  M.hidden = false;
  M.onclick = async (e) => {
    if (e.target === M) { M.hidden = true; return; }
    const m = e.target.closest('[data-m]')?.dataset.m; if (!m) return;
    if (m === 'close') M.hidden = true;
    else if (m === 'png') { M.hidden = true; await exportPng(); }
    else if (m === 'export') { M.hidden = true; await exportBackup(); }
    else if (m === 'import') { M.hidden = true; $('#importInput').value = ''; $('#importInput').click(); }
  };
}

function ymd() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; }
async function saveFile(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return true; }
    catch (err) { if (err.name === 'AbortError') return false; }
  }
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
  return true;
}

// 인증샷: 1080×1350(인스타 4:5) 카드로 전국 지도 + 통계를 그려서 PNG로
async function exportPng() {
  toast('이미지를 만드는 중…', 4000);
  try {
    const CW = 1080, CH = 1350;
    const p2 = d3.geoMercator().fitExtent([[70, 250], [CW - 70, CH - 90]], fitShape());
    const g2 = d3.geoPath(p2);
    const obj = topo.objects[Object.keys(topo.objects)[0]];
    let clip = ''; let base = ''; let photos = '';
    for (const r of regions) {
      const d = g2(r.feature); const x = rec(r.code);
      base += `<path d="${d}" fill="${fillOf(r)}" stroke="#FFFFFF" stroke-width="0.8"/>`;
      if (x && x.photo) {
        const blob = await idb.get(r.code).catch(() => null);
        if (blob) {
          const url = await blobToDataUrl(blob);
          const box = photoBox(r, x, g2.bounds(r.feature));
          clip += `<clipPath id="c${r.code}"><path d="${d}"/></clipPath>`;
          photos += `<g clip-path="url(#c${r.code})"><image href="${url}" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" preserveAspectRatio="none" opacity="${x.opacity ?? 1}"/></g>`;
        }
      }
    }
    const provLine = g2(topojson.mesh(topo, obj, (a, b) => a !== b && provOf(a.properties.code) !== provOf(b.properties.code)));
    const coast = g2(topojson.mesh(topo, obj, (a, b) => a === b));
    const n = Object.entries(DB.regions).filter(([c, r]) => byCode.has(c) && isDecorated(r)).length;
    const pct = (n / regions.length) * 100;
    const provDone = new Set(Object.entries(DB.regions).filter(([c, r]) => byCode.has(c) && isDecorated(r)).map(([c]) => byCode.get(c).prov)).size;
    const font = `'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif`;
    const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}">
      <defs>${clip}</defs>
      <rect width="${CW}" height="${CH}" fill="#FBF8F3"/>
      <circle cx="${CW - 40}" cy="40" r="170" fill="#F2675A" opacity=".9"/>
      <text x="70" y="118" font-family="${font}" font-size="58" font-weight="800" fill="#2B2926">내 여행 발자국</text>
      <text x="72" y="178" font-family="${font}" font-size="30" fill="#5A554E">${TOTAL_LABEL} ${n}/${regions.length}곳 · 시·도 ${provDone}/17</text>
      <text x="${CW - 70}" y="${CH - 40}" text-anchor="end" font-family="${font}" font-size="24" fill="#9A938A">같이갈래 · ${new Date().toLocaleDateString('ko-KR')}</text>
      <g>${base}</g><g>${photos}</g>
      <path d="${provLine}" fill="none" stroke="#B9AC99" stroke-width="1.6"/>
      <path d="${coast}" fill="none" stroke="#A89A86" stroke-width="1.2"/>
      <g transform="translate(${CW - 250} 300)">
        <rect x="0" y="0" width="190" height="120" rx="26" fill="#1D6B68"/>
        <text x="95" y="66" text-anchor="middle" font-family="${font}" font-size="50" font-weight="800" fill="#FFFFFF">${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%</text>
        <text x="95" y="100" text-anchor="middle" font-family="${font}" font-size="22" fill="#E2F0EE">전국 정복률</text>
      </g>
    </svg>`;
    const url = URL.createObjectURL(new Blob([svgStr], { type: 'image/svg+xml' }));
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('그리기 실패')); i.src = url; });
    const cv = document.createElement('canvas'); cv.width = CW; cv.height = CH;
    cv.getContext('2d').drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    const png = await toBlob(cv, 'image/png');
    const ok = await saveFile(png, `내여행발자국-${ymd()}.png`);
    if (ok) toast('지도 이미지를 저장했어요 🖼️');
  } catch (err) { console.error(err); toast(`이미지 저장 실패: ${err.message}`, 3500); }
}

async function exportBackup() {
  try {
    const photos = {};
    for (const [code, r] of Object.entries(DB.regions)) {
      if (!r.photo) continue;
      const blob = await idb.get(code).catch(() => null);
      if (blob) photos[code] = await blobToDataUrl(blob);
    }
    const data = { app: 'gachi-footprint', version: 1, exportedAt: new Date().toISOString(), regions: DB.regions, photos };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const ok = await saveFile(blob, `내여행발자국-백업-${ymd()}.json`);
    if (ok) toast(`백업 파일을 만들었어요 (${Object.keys(DB.regions).length}곳, ${(blob.size / 1024 / 1024).toFixed(1)}MB)`, 3200);
  } catch (err) { console.error(err); toast(`백업 실패: ${err.message}`, 3500); }
}

async function importBackup(e) {
  const file = e.target.files && e.target.files[0]; if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch (_) { toast('백업 파일을 읽을 수 없어요', 3000); return; }
  if (!data || data.app !== 'gachi-footprint' || typeof data.regions !== 'object') { toast('같이갈래 발자국 백업 파일이 아니에요', 3000); return; }
  const incoming = Object.entries(data.regions).filter(([c]) => byCode.has(c));
  if (!confirm(`백업에서 ${incoming.length}곳의 기록을 가져올까요?\n같은 지역은 백업 내용으로 바뀌고, 나머지 기록은 그대로 남아요.`)) return;
  let fail = 0;
  for (const [code, r] of incoming) {
    const clean = {};
    for (const k of ['color', 'photo', 'pw', 'ph', 'zoom', 'px', 'py', 'opacity', 'date', 'with', 'memo', 'updatedAt']) if (r[k] != null) clean[k] = r[k];
    if (clean.color && !/^#[0-9a-f]{6}$/i.test(clean.color)) delete clean.color;
    const src = data.photos && data.photos[code];
    if (clean.photo && typeof src === 'string' && src.startsWith('data:image/')) {
      try { const blob = await (await fetch(src)).blob(); await idb.put(code, blob); dropPhotoUrl(code); }
      catch (_) { clean.photo = false; fail++; }
    } else clean.photo = false;
    DB.regions[code] = clean;
  }
  saveDb(); renderAll(); renderStats(); if (sel) renderSheet();
  toast(`${incoming.length}곳을 가져왔어요${fail ? ` (사진 ${fail}장 실패)` : ''}`, 3200);
}

boot();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
