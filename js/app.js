/* ============================================================
 *  같이갈래 — 메인 앱
 *  지도/검색: ./map/mapService.js  ·  저장/실시간: ./store.js
 * ============================================================ */
import { createMapService } from './map/mapService.js';
import { createStore, uuid } from './store.js';

/* ---------- 상수 ---------- */
const CFG = window.APP_CONFIG || {};
const CATS = {
  food: { label: '맛집', emoji: '🍜', color: '#E8604C', soft: '#FFE9E4' },
  cafe: { label: '카페', emoji: '☕', color: '#A9733F', soft: '#F6EADC' },
  stay: { label: '숙소', emoji: '🛏️', color: '#5965C0', soft: '#E7E9FA' },
  tour: { label: '관광', emoji: '📸', color: '#1D6B68', soft: '#E2F0EE' },
  shop: { label: '쇼핑', emoji: '🛍️', color: '#C24F8A', soft: '#FBE6F0' },
};
const CAT_KEYS = Object.keys(CATS);
const STATUS = { undecided: '미정', needed: '예약필요', done: '예약완료' };
const DAY_COLORS = ['#F2675A', '#1D6B68', '#5965C0', '#D99A1E', '#9B4FB0', '#2E8B57', '#C24F8A', '#3B82C4'];
const dayColor = (d) => DAY_COLORS[(d - 1) % DAY_COLORS.length];
const TOP_PAD = 116;

/* ---------- 유틸 ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (n) => (n ? `${Number(n).toLocaleString('ko-KR')}원` : '');
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (_) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
let toastT;
function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`;
}
function dayLabel(d, room) {
  if (!room?.start_date) return `${d}일차`;
  const dt = new Date(`${room.start_date}T00:00:00`); dt.setDate(dt.getDate() + d - 1);
  return `${d}일차 · ${dt.getMonth() + 1}/${dt.getDate()}(${'일월화수목금토'[dt.getDay()]})`;
}

/* ---------- 상태 ---------- */
const S = {
  roomId: null, room: null, places: [], memos: [], votes: [],
  me: lsGet('gachi:me', null) || { id: uuid(), name: '' },
  tab: 'cand', day: 0, sort: 'new', cat: null,
  query: '', results: [], searching: false, focusResult: null,
  sel: null, editMemo: null, temp: null, sheet: 'half',
};
lsSet('gachi:me', S.me);
let store, map, unsub;
let mapReady = false;
const demo = { map: false, store: false, mapError: '' };

/* ---------- 데이터 헬퍼 ---------- */
const placeById = (id) => S.places.find((p) => p.id === id);
const votesOf = (id) => S.votes.filter((v) => v.place_id === id);
const iVoted = (id) => S.votes.some((v) => v.place_id === id && v.voter_id === S.me.id);
const memosOf = (id) => S.memos.filter((m) => m.place_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at));
const candidates = () => S.places.filter((p) => !p.day);
const dayList = (d) => S.places.filter((p) => p.day === d)
  .sort((a, b) => (a.order_idx ?? 0) - (b.order_idx ?? 0) || a.created_at.localeCompare(b.created_at));
const sumCost = (list) => list.reduce((n, p) => n + (Number(p.cost) || 0), 0);
const roomDays = () => Math.max(1, S.room?.days || 1, ...S.places.map((p) => p.day || 0));

/* ============================================================
 *  부팅
 * ============================================================ */
boot();

async function boot() {
  store = await createStore(CFG);
  demo.store = store.mode === 'local';
  const code = (new URLSearchParams(location.search).get('room') || '').trim();
  if (code && /^[a-z0-9-]{3,40}$/i.test(code)) enterRoom(code);
  else showLanding();
  showDemoBanner();
}

function showDemoBanner() {
  const parts = [];
  if (!CFG.KAKAO_JS_KEY) parts.push('카카오맵 키 없음 → <b>가짜 지도·부산 샘플 검색</b>');
  else if (demo.mapError) parts.push(`카카오맵 오류(${esc(demo.mapError)}) → 데모 지도`);
  if (demo.store) parts.push(store.error ? `Supabase 오류 → <b>이 기기에만 저장</b>` : 'Supabase 키 없음 → <b>이 브라우저에만 저장</b>(다른 사람과 공유 안 됨)');
  const b = $('#demoBanner');
  // 키는 있는데 카카오맵 연결에 실패한 경우: 대부분 사이트 도메인 미등록
  if (CFG.KAKAO_JS_KEY && demo.mapError && !sessionStorage.getItem('gachi:hideMapErr')) {
    b.innerHTML = `<div>🗺️ <b>카카오맵 연결 실패</b> → 데모 지도로 표시 중<br>카카오 디벨로퍼스 &gt; 플랫폼 &gt; Web 사이트 도메인에 <code>${esc(location.origin)}</code> 를 등록하고, 카카오맵 사용 설정이 ON인지 확인해 주세요.</div><button type="button" aria-label="닫기">✕</button>`;
    b.hidden = false;
    b.querySelector('button').onclick = () => { b.hidden = true; sessionStorage.setItem('gachi:hideMapErr', '1'); };
    return;
  }
  if (!parts.length || sessionStorage.getItem('gachi:hideDemo')) { b.hidden = true; return; }
  const short = document.body.classList.contains('in-room');
  b.innerHTML = short
    ? `<div>🧪 <b>데모 모드</b> · ${demo.store ? '이 브라우저에만 저장돼요' : '데모 지도로 보는 중'} — <code>config.js</code>에 키를 넣으면 실제로 동작해요</div><button type="button" aria-label="닫기">✕</button>`
    : `<div>🧪 <b>데모 모드</b> — ${parts.join(' · ')}<br>실제 사용하려면 <code>config.js</code>에 키를 넣어 주세요.</div><button type="button" aria-label="닫기">✕</button>`;
  b.hidden = false;
  b.querySelector('button').onclick = () => { b.hidden = true; sessionStorage.setItem('gachi:hideDemo', '1'); };
}

/* ============================================================
 *  시작 화면 (방 만들기 / 참여)
 * ============================================================ */
function showLanding(msg) {
  $('#app').hidden = true;
  const L = $('#landing'); L.hidden = false;
  const recent = lsGet('gachi:recent', []);
  L.innerHTML = `<div class="landing-in">
    <div class="hero">
      <span class="stamp">TRAVEL NOTE</span>
      <h1>링크 하나로<br>같이 짜는 여행 계획</h1>
      <p>회원가입 없이, 닉네임만 정하면 친구들과 함께 지도에 핀을 찍어요.</p>
      <div class="dash">📍<i></i>🍜<i></i>☕<i></i>🛏️</div>
    </div>
    ${msg ? `<p class="empty" style="padding:14px 0 0">${esc(msg)}</p>` : ''}
    <form class="l-card" id="createForm">
      <h2>새 여행 만들기</h2>
      <div class="field"><label for="fTitle">여행 이름</label><input class="input" id="fTitle" maxlength="40" placeholder="예: 부산 2박 3일 먹방 여행" required></div>
      <div class="two">
        <div class="field"><label for="fDays">며칠 동안?</label><input class="input" id="fDays" type="number" min="1" max="30" value="3" inputmode="numeric"></div>
        <div class="field"><label for="fStart">출발일 (선택)</label><input class="input" id="fStart" type="date"></div>
      </div>
      <div class="field"><label for="fNick">내 닉네임</label><input class="input" id="fNick" maxlength="12" placeholder="예: 민지" value="${esc(S.me.name)}" required></div>
      <button class="btn primary block" style="margin-top:16px" type="submit">방 만들고 공유 링크 받기</button>
    </form>
    <form class="l-card" id="joinForm">
      <h2>받은 링크로 참여</h2>
      <div class="join-row"><input class="input" id="fJoin" placeholder="링크 또는 방 코드 붙여넣기"><button class="btn teal" type="submit">입장</button></div>
    </form>
    ${recent.length ? `<div class="l-card recent"><h2>최근 여행</h2>${recent.slice(0, 6).map((r) => `<a href="?room=${encodeURIComponent(r.id)}">${esc(r.title)}<small>${esc(r.id)} ›</small></a>`).join('')}</div>` : ''}
  </div>`;

  $('#createForm').onsubmit = async (e) => {
    e.preventDefault();
    const title = $('#fTitle').value.trim(); const name = $('#fNick').value.trim();
    if (!title || !name) return;
    const btn = e.submitter || e.target.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      setMyName(name);
      const days = Math.max(1, Math.min(30, Number($('#fDays').value) || 1));
      const id = await store.createRoom({ title, days, startDate: $('#fStart').value || null });
      history.replaceState(null, '', `?room=${id}`);
      await enterRoom(id, { justCreated: true });
    } catch (err) { toast(`방 만들기 실패: ${err.message}`, 4000); btn.disabled = false; }
  };
  $('#joinForm').onsubmit = (e) => {
    e.preventDefault();
    const v = $('#fJoin').value.trim(); if (!v) return;
    let code = v;
    try { code = new URL(v).searchParams.get('room') || v; } catch (_) {}
    location.href = `?room=${encodeURIComponent(code.trim())}`;
  };
}

function setMyName(name) { S.me.name = name; lsSet('gachi:me', S.me); }

/* ============================================================
 *  방 입장
 * ============================================================ */
async function enterRoom(id, { justCreated = false } = {}) {
  S.roomId = id;
  let data;
  try { data = await store.loadRoom(id); }
  catch (err) { showLanding(`방을 불러오지 못했어요: ${err.message}`); return; }
  if (!data) { history.replaceState(null, '', location.pathname); showLanding('해당 링크의 여행 방을 찾을 수 없어요. (데모 모드라면 만든 브라우저에서만 열려요)'); return; }
  Object.assign(S, data);

  $('#landing').hidden = true;
  $('#app').hidden = false;
  document.body.classList.add('in-room');
  showDemoBanner();
  document.title = `${S.room.title} · 같이갈래`;

  const recent = lsGet('gachi:recent', []).filter((r) => r.id !== id);
  recent.unshift({ id, title: S.room.title }); lsSet('gachi:recent', recent.slice(0, 10));

  if (!S.me.name) await askNickname();

  initSheet();
  bindUi();
  const res = await createMapService(CFG, $('#map'), {
    center: CFG.DEFAULT_CENTER || { lat: 35.1532, lng: 129.1186 },
    onMapTap,
  });
  map = res.map; mapReady = true;
  demo.map = res.demo; demo.mapError = res.error || '';
  if (res.error) { toast('카카오맵을 불러오지 못해 데모 지도로 보여드려요', 3500); showDemoBanner(); }

  renderAll();
  fitVisible();
  setTimeout(() => $('#mapHint').classList.add('fade'), 4500);

  unsub = store.subscribe(id, debounce(reload, 250), (st) => { S.live = st; renderHeader(); });
  if (justCreated) setTimeout(() => shareRoom(true), 400);
}

let knownIds = null;
async function reload() {
  const data = await store.loadRoom(S.roomId).catch(() => null);
  if (!data) return;
  if (knownIds) {
    const fresh = data.places.filter((p) => !knownIds.has(p.id) && p.proposer_id !== S.me.id);
    if (fresh.length) toast(`${fresh[0].proposer}님이 '${fresh[0].name}'을(를) 추가했어요`);
  }
  knownIds = new Set(data.places.map((p) => p.id));
  Object.assign(S, data);
  if (S.sel && !placeById(S.sel)) closeDetail();
  renderAll();
}

/* ============================================================
 *  렌더링
 * ============================================================ */
function renderAll() {
  if (!knownIds) knownIds = new Set(S.places.map((p) => p.id));
  renderHeader();
  renderSheet();
  renderMap();
  renderTempbar();
  if (S.sel) renderDetail();
}

function renderHeader() {
  if (!S.room) return;
  $('#roomTitle').textContent = S.room.title;
  const live = store.mode === 'local' ? '데모(이 기기)' : S.live === 'SUBSCRIBED' ? '● 실시간 공유 중' : '연결 중…';
  $('#roomSub').textContent = `${roomDays()}일 일정 · ${S.places.length}곳 · ${live}`;
  $('#meBtn').textContent = `🙂 ${S.me.name || '닉네임'}`;
}

/* ---------- 바텀시트 ---------- */
function renderSheet() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
  $('#cntCand').textContent = candidates().length;
  $('#cntPlan').textContent = S.places.length - candidates().length;
  $('#cntSearch').textContent = S.results.length;
  const tools = $('#sheetTools'); const body = $('#sheetBody');
  const scroll = body.scrollTop;
  if (S.tab === 'cand') { tools.innerHTML = candTools(); body.innerHTML = candBody(); }
  else if (S.tab === 'plan') { tools.innerHTML = planTools(); body.innerHTML = planBody(); }
  else { tools.innerHTML = ''; body.innerHTML = searchBody(); }
  body.scrollTop = scroll;
}

function catPills() {
  return `<span class="tools-sep"></span><button class="pill ${!S.cat ? 'on' : ''}" data-act="cat" data-v="">전체</button>`
    + CAT_KEYS.map((k) => `<button class="pill ${S.cat === k ? 'on' : ''}" data-act="cat" data-v="${k}">${CATS[k].emoji} ${CATS[k].label}</button>`).join('');
}
function candTools() {
  return `<button class="pill ${S.sort === 'new' ? 'on' : ''}" data-act="sort" data-v="new">최신순</button>
    <button class="pill ${S.sort === 'hot' ? 'on' : ''}" data-act="sort" data-v="hot">❤️ 인기순</button>${catPills()}`;
}

function daySelect(p) {
  const n = roomDays();
  let o = `<option value="">후보</option>`;
  for (let d = 1; d <= n; d++) o += `<option value="${d}" ${p.day === d ? 'selected' : ''}>${d}일차</option>`;
  return `<select class="mini-select" data-act="assign" data-id="${p.id}" aria-label="일정 배정">${o}</select>`;
}
function heartBtn(p) {
  const n = votesOf(p.id).length;
  return `<button class="heart ${iVoted(p.id) ? 'on' : ''}" data-act="vote" data-id="${p.id}" aria-label="가고 싶어요"><span class="h">❤️</span>${n}</button>`;
}
function metaBadges(p) {
  return `<span class="badge who">👤 ${esc(p.proposer)}</span>`
    + (p.status && p.status !== 'undecided' ? `<span class="badge st-${p.status}">${STATUS[p.status]}</span>` : '')
    + (p.cost ? `<span class="badge cost">${won(p.cost)}</span>` : '')
    + (memosOf(p.id).length ? `<span class="badge">💬 ${memosOf(p.id).length}</span>` : '');
}

function candBody() {
  let list = candidates();
  if (S.cat) list = list.filter((p) => p.category === S.cat);
  list.sort(S.sort === 'hot'
    ? (a, b) => votesOf(b.id).length - votesOf(a.id).length || b.created_at.localeCompare(a.created_at)
    : (a, b) => b.created_at.localeCompare(a.created_at));
  if (!list.length) {
    return S.places.length && !S.cat
      ? `<div class="empty"><span class="big">🗓️</span>후보가 모두 일정에 배정됐어요!<br>‘일차별 일정’ 탭에서 동선을 확인하세요.</div>`
      : `<div class="empty"><span class="big">📍</span>${S.cat ? `${CATS[S.cat].label} 후보가 아직 없어요.` : '아직 후보가 없어요.'}<br>위 검색창에서 장소를 찾거나<br>지도를 탭해서 직접 핀을 찍어 보세요.</div>`;
  }
  return list.map((p) => {
    const c = CATS[p.category] || CATS.tour;
    return `<div class="card ${S.sel === p.id ? 'sel' : ''}" data-act="open" data-id="${p.id}">
      <div class="ico" style="--cs:${c.soft}">${c.emoji}</div>
      <div class="body"><div class="name">${esc(p.name)}</div><div class="meta">${metaBadges(p)}</div></div>
      <div class="side">${heartBtn(p)}${daySelect(p)}</div>
    </div>`;
  }).join('');
}

function planTools() {
  const n = roomDays();
  let h = `<button class="pill ${S.day === 0 ? 'on' : ''}" data-act="day" data-v="0">전체</button>`;
  for (let d = 1; d <= n; d++) {
    h += `<button class="pill ${S.day === d ? 'on' : ''}" data-act="day" data-v="${d}"><span class="dot" style="--c:${dayColor(d)}"></span>${d}일차</button>`;
  }
  return `${h}<button class="pill ghost" data-act="addDay">＋ 일차</button>`;
}

function dayBlock(d) {
  const list = dayList(d);
  const head = `<div class="day-head"><h3 style="--c:${dayColor(d)}"><i></i>${esc(dayLabel(d, S.room))}</h3><small>${list.length}곳${sumCost(list) ? ` · ${won(sumCost(list))}` : ''}</small></div>`;
  if (!list.length) return `${head}<div class="card" style="justify-content:center;color:var(--muted);font-size:13px">아직 비어 있어요 · 후보에서 ‘${d}일차’로 배정해 보세요</div>`;
  return head + list.map((p, i) => {
    const c = CATS[p.category] || CATS.tour;
    return `${i ? `<div class="leg" style="--c:${dayColor(d)}"></div>` : ''}<div class="card ${S.sel === p.id ? 'sel' : ''}" data-act="open" data-id="${p.id}">
      <div class="ico num" style="--c:${dayColor(d)}">${i + 1}</div>
      <div class="body"><div class="name">${c.emoji} ${esc(p.name)}</div><div class="meta">${metaBadges(p)}</div></div>
      <div class="side"><div class="order-btns">
        <button data-act="move" data-id="${p.id}" data-v="-1" ${i === 0 ? 'disabled' : ''} aria-label="앞으로">↑</button>
        <button data-act="move" data-id="${p.id}" data-v="1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="뒤로">↓</button>
        <button data-act="unassign" data-id="${p.id}" aria-label="후보로 돌리기" title="후보로">↩</button>
      </div></div>
    </div>`;
  }).join('');
}

function planBody() {
  const n = roomDays();
  const total = sumCost(S.places.filter((p) => p.day));
  let h = `<div class="summary"><span>🧾 일정에 담긴 예상 비용</span><span>${won(total) || '0원'}</span></div>`;
  if (S.day === 0) { for (let d = 1; d <= n; d++) h += dayBlock(d); return h; }
  h = dayBlock(S.day);
  const cands = candidates();
  if (cands.length) {
    h += `<div class="day-head"><h3>후보에서 가져오기</h3><small>${cands.length}곳</small></div>`
      + cands.map((p) => `<div class="card" data-act="open" data-id="${p.id}"><div class="ico" style="--cs:${(CATS[p.category] || CATS.tour).soft}">${(CATS[p.category] || CATS.tour).emoji}</div>
        <div class="body"><div class="name">${esc(p.name)}</div><div class="meta"><span class="badge who">👤 ${esc(p.proposer)}</span><span class="badge">❤️ ${votesOf(p.id).length}</span></div></div>
        <button class="btn teal xs" data-act="assignTo" data-id="${p.id}" data-v="${S.day}">＋ ${S.day}일차</button></div>`).join('');
  }
  return h;
}

function searchBody() {
  if (S.searching) return `<div class="empty"><span class="big">🔎</span>‘${esc(S.query)}’ 찾는 중…</div>`;
  if (!S.query) {
    return `<div class="empty"><span class="big">🔎</span>상단 검색창에 가고 싶은 곳을 입력해 보세요.<div style="display:flex;gap:6px;justify-content:center;margin-top:12px;flex-wrap:wrap">
      ${['광안리 국밥', '해운대 카페', '부산 숙소', '감천문화마을'].map((q) => `<button class="pill" data-act="quick" data-v="${q}">${q}</button>`).join('')}</div></div>`;
  }
  if (!S.results.length) return `<div class="empty"><span class="big">🫥</span>‘${esc(S.query)}’ 검색 결과가 없어요.<br>다른 키워드로 찾아보거나 지도를 탭해 직접 핀을 찍어 주세요.</div>`;
  return S.results.map((r, i) => {
    const added = S.places.find((p) => p.kakao_id === r.providerId);
    const c = CATS[r.category];
    return `<div class="card ${S.focusResult === r.providerId ? 'sel' : ''}" data-act="focusResult" data-v="${esc(r.providerId)}">
      <div class="ico num" style="--c:var(--teal)">${i + 1}</div>
      <div class="body"><div class="name">${esc(r.name)}</div>
        <div class="addr">${c ? `${c.emoji} ` : ''}${esc(r.categoryText || '')}${r.categoryText ? ' · ' : ''}${esc(r.address)}</div></div>
      ${added ? `<button class="btn xs" data-act="open" data-id="${added.id}">추가됨 ✓</button>`
        : `<button class="btn primary xs" data-act="addResult" data-v="${esc(r.providerId)}">＋ 핀</button>`}
    </div>`;
  }).join('');
}

/* ---------- 지도 ---------- */
function markerOf(p, extra = {}) {
  const c = CATS[p.category] || CATS.tour;
  return { id: p.id, lat: p.lat, lng: p.lng, color: c.color, label: c.emoji, title: p.name, selected: S.sel === p.id, ...extra };
}
function mapModel() {
  const markers = []; const routes = [];
  if (S.tab === 'search') {
    S.places.forEach((p) => markers.push(markerOf(p, { faded: S.sel !== p.id })));
    S.results.forEach((r, i) => markers.push({
      id: `r:${r.providerId}`, lat: r.lat, lng: r.lng, color: '#1D6B68', label: i + 1, numbered: true,
      title: r.name, selected: S.focusResult === r.providerId,
    }));
  } else if (S.tab === 'plan') {
    const days = S.day ? [S.day] : Array.from({ length: roomDays() }, (_, i) => i + 1);
    days.forEach((d) => {
      const list = dayList(d);
      list.forEach((p, i) => markers.push(markerOf(p, { color: dayColor(d), label: i + 1, numbered: true })));
      routes.push({ points: list.map((p) => ({ lat: p.lat, lng: p.lng })), color: dayColor(d) });
    });
    if (S.sel && !markers.some((m) => m.id === S.sel) && placeById(S.sel)) markers.push(markerOf(placeById(S.sel)));
  } else {
    S.places.forEach((p) => {
      if (S.cat && p.category !== S.cat && S.sel !== p.id) return;
      markers.push(p.day ? markerOf(p, { faded: S.sel !== p.id, tag: `${p.day}일차` }) : markerOf(p));
    });
  }
  if (S.temp) markers.push({ id: '__temp', temp: true, lat: S.temp.lat, lng: S.temp.lng, color: '#2B2926', label: '＋' });
  return { markers, routes };
}
function renderMap() {
  if (!mapReady) return;
  const { markers, routes } = mapModel();
  map.setMarkers(markers, onMarkerTap);
  map.setRoutes(routes);
}
function fitVisible() {
  if (!mapReady) return;
  const { markers } = mapModel();
  let pts = markers.filter((m) => !m.faded && !m.temp);
  if (!pts.length) pts = markers.filter((m) => !m.temp);
  if (pts.length) map.fitTo(pts, { top: TOP_PAD, bottom: sheetVis() });
}
function onMarkerTap(id) {
  if (id.startsWith('r:')) { focusResult(id.slice(2), true); return; }
  openDetail(id);
}

let lastTap = { t: 0, lat: 0, lng: 0 };
async function onMapTap(ll) {
  const now = Date.now();
  if (now - lastTap.t < 800 && Math.abs(ll.lat - lastTap.lat) < 1e-3 && Math.abs(ll.lng - lastTap.lng) < 1e-3) return;
  lastTap = { t: now, ...ll };
  if (S.sel) { closeDetail(); return; }
  S.temp = { ...ll, address: '주소 확인 중…' };
  $('#mapHint').classList.add('fade');
  renderMap(); renderTempbar();
  const addr = await map.reverseGeocode(ll).catch(() => '');
  if (S.temp && S.temp.lat === ll.lat) { S.temp.address = addr || '이름 없는 위치'; renderTempbar(); }
}
function renderTempbar() {
  const tb = $('#tempbar');
  if (!S.temp) { tb.hidden = true; return; }
  tb.hidden = false;
  tb.style.bottom = `${sheetVis() + 10}px`;
  tb.innerHTML = `<div class="t-text"><b>📍 이 위치에 핀을 추가할까요?</b><small>${esc(S.temp.address)}</small></div>
    <button class="btn primary sm" data-t="add">핀 추가</button><button class="btn sm" data-t="x" aria-label="취소">✕</button>`;
}

/* ============================================================
 *  바텀시트 드래그
 * ============================================================ */
const sheetEl = () => $('#sheet');
function snaps() {
  const H = $('#app').clientHeight;
  return { peek: 150, half: Math.round(H * 0.5), full: H - TOP_PAD + 4, H };
}
let curVis = 0;
const sheetVis = () => curVis || snaps().half;
/** 시트는 화면 아래에 붙어 있고(full 높이), translateY로 vis(px)만큼만 보이게 함 */
function applySheet(vis, animate = true) {
  const { full } = snaps();
  const el = sheetEl();
  curVis = vis;
  el.classList.toggle('dragging', !animate);
  el.style.height = `${full}px`;
  el.style.transform = `translateY(${full - vis}px)`;
  $('#sheetBody').style.paddingBottom = `${Math.max(0, full - vis) + 24}px`;
  if (S.temp) $('#tempbar').style.bottom = `${vis + 10}px`;
}
function setSheet(state) { S.sheet = state; applySheet(snaps()[state]); }

let sheetInited = false;
function initSheet() {
  if (sheetInited) return; sheetInited = true;
  setSheet('half');

  let drag = null;
  const startDrag = (e) => {
    if (e.button > 0) return;
    drag = { y: e.clientY, vis: curVis, t: performance.now(), moved: false, id: e.pointerId, src: e.currentTarget };
  };
  const moveDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) < 6) return;
    if (!drag.moved) drag.moved = true;
    const { full } = snaps();
    applySheet(Math.max(110, Math.min(full, drag.vis - dy)), false);
  };
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    if (!d.moved) return;
    const dy = e.clientY - d.y; const v = dy / Math.max(1, performance.now() - d.t);
    const s = snaps(); const order = ['peek', 'half', 'full'];
    let best = order.reduce((a, b) => (Math.abs(s[b] - curVis) < Math.abs(s[a] - curVis) ? b : a));
    if (Math.abs(v) > 0.6) {
      const i = order.indexOf(S.sheet);
      best = order[Math.max(0, Math.min(2, i + (v < 0 ? 1 : -1)))];
    }
    setSheet(best);
    // 드래그 직후 따라오는 click(탭 전환 등)은 무시
    const kill = (ev) => ev.stopPropagation();
    sheetEl().addEventListener('click', kill, true);
    setTimeout(() => sheetEl().removeEventListener('click', kill, true), 80);
  };
  ['#sheetGrip', '#tabs', '#sheetTools'].forEach((s) => $(s).addEventListener('pointerdown', startDrag));
  window.addEventListener('pointermove', moveDrag);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  $('#sheetGrip').addEventListener('click', () => setSheet(S.sheet === 'full' ? 'half' : S.sheet === 'half' ? 'full' : 'half'));
  window.addEventListener('resize', debounce(() => { setSheet(S.sheet); map && map.relayout(); }, 150));
}

/* ============================================================
 *  이벤트 바인딩
 * ============================================================ */
let uiBound = false;
function bindUi() {
  if (uiBound) return; uiBound = true;

  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]'); if (!b) return;
    switchTab(b.dataset.tab);
  });

  const sheetClick = async (e) => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    const { act, id, v } = t.dataset;
    if (t.tagName === 'SELECT') return;
    if (act === 'open') { e.stopPropagation(); openDetail(id); }
    else if (act === 'vote') { e.stopPropagation(); toggleVote(id); }
    else if (act === 'sort') { S.sort = v; renderSheet(); }
    else if (act === 'cat') { S.cat = v || null; renderSheet(); renderMap(); fitVisible(); }
    else if (act === 'day') { S.day = Number(v); renderSheet(); renderMap(); fitVisible(); }
    else if (act === 'addDay') { await store.updateRoom(S.roomId, { days: roomDays() + 1 }); await reload(); S.day = roomDays(); renderSheet(); renderMap(); toast(`${S.day}일차를 추가했어요`); }
    else if (act === 'move') { e.stopPropagation(); movePlace(id, Number(v)); }
    else if (act === 'unassign') { e.stopPropagation(); assignDay(id, null); }
    else if (act === 'assignTo') { e.stopPropagation(); assignDay(id, Number(v)); }
    else if (act === 'quick') { $('#searchInput').value = v; doSearch(v); }
    else if (act === 'focusResult') focusResult(v);
    else if (act === 'addResult') { e.stopPropagation(); addFromResult(v); }
  };
  $('#sheetBody').addEventListener('click', sheetClick);
  $('#sheetTools').addEventListener('click', sheetClick);
  $('#sheetBody').addEventListener('change', (e) => {
    const t = e.target.closest('select[data-act="assign"]'); if (!t) return;
    assignDay(t.dataset.id, t.value ? Number(t.value) : null);
  });

  // 검색
  const input = $('#searchInput');
  input.addEventListener('input', () => { $('#searchClear').hidden = !input.value; });
  $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); input.blur(); doSearch(input.value); });
  $('#searchClear').addEventListener('click', () => {
    input.value = ''; $('#searchClear').hidden = true; S.query = ''; S.results = []; S.focusResult = null;
    renderSheet(); renderMap();
  });

  // 임시 핀
  $('#tempbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    if (b.dataset.t === 'x') { S.temp = null; renderTempbar(); renderMap(); }
    else openManualAdd();
  });

  $('#shareBtn').addEventListener('click', () => shareRoom(false));
  $('#meBtn').addEventListener('click', async () => { await askNickname(true); renderAll(); });
  $('#roomTitleBtn').addEventListener('click', openRoomSettings);

  // 상세 패널
  $('#detail').addEventListener('click', onDetailClick);
  $('#detail').addEventListener('change', onDetailChange);
  // 입력 중에는 상세를 다시 그리지 않고, 포커스가 빠진 뒤(버튼 클릭이 끝난 뒤) 반영
  $('#detail').addEventListener('focusout', () => setTimeout(() => { if (detailDirty && !detailFocused()) renderDetail(); }, 300));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (!$('#modal').hidden) closeModal(); else if (S.sel) closeDetail(); }
  });
}

function switchTab(tab) {
  S.tab = tab;
  if (tab !== 'search') S.focusResult = null;
  renderSheet(); renderMap(); fitVisible();
  $('#sheetBody').scrollTop = 0;
  if (S.sheet === 'peek') setSheet('half');
}

/* ============================================================
 *  검색
 * ============================================================ */
async function doSearch(q) {
  q = (q || '').trim(); if (!q) return;
  S.query = q; S.searching = true; S.results = []; S.focusResult = null; S.temp = null;
  S.tab = 'search'; renderSheet(); renderTempbar(); if (S.sheet === 'peek') setSheet('half');
  try { S.results = await map.search(q, { center: map.getCenter() }); }
  catch (err) { toast(err.message || '검색 실패'); S.results = []; }
  S.searching = false;
  renderSheet(); renderMap(); fitVisible();
}
function focusResult(pid, fromMap = false) {
  const r = S.results.find((x) => x.providerId === pid); if (!r) return;
  S.focusResult = pid; renderSheet(); renderMap();
  map.panTo(r, { offsetY: (sheetVis() - TOP_PAD) / 2 });
  if (fromMap) {
    if (S.tab !== 'search') { S.tab = 'search'; renderSheet(); }
    const idx = S.results.indexOf(r);
    const card = $('#sheetBody').children[idx];
    card && card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}
async function addFromResult(pid) {
  const r = S.results.find((x) => x.providerId === pid); if (!r) return;
  const dup = S.places.find((p) => p.kakao_id === pid);
  if (dup) { toast('이미 추가된 장소예요'); openDetail(dup.id); return; }
  const p = await addPlace({
    name: r.name, address: r.address, lat: r.lat, lng: r.lng,
    category: r.category || 'tour', kakao_id: r.providerId, phone: r.phone, place_url: r.url,
  });
  if (p) { toast(`‘${r.name}’ 후보에 추가!`); renderSheet(); }
}

/* ============================================================
 *  데이터 변경 액션
 * ============================================================ */
async function run(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); await reload(); return r ?? true; }
  catch (err) { console.error(err); toast(`저장 실패: ${err.message}`, 3500); await reload(); return null; }
}

async function addPlace(fields) {
  const row = {
    id: uuid(), room_id: S.roomId, proposer: S.me.name, proposer_id: S.me.id,
    status: 'undecided', cost: null, day: null, order_idx: null,
    kakao_id: null, phone: '', place_url: '', address: '', ...fields,
  };
  S.places.push({ ...row, created_at: new Date().toISOString() }); // 낙관적 반영
  knownIds && knownIds.add(row.id);
  renderAll();
  return run(() => store.addPlace(row));
}

function updatePlace(id, patch, msg) {
  const p = placeById(id); if (p) Object.assign(p, patch);
  renderAll();
  return run(() => store.updatePlace(id, patch), msg);
}

function assignDay(id, day) {
  const p = placeById(id); if (!p || p.day === day) return;
  const order = day ? Math.max(-1, ...dayList(day).map((x) => x.order_idx ?? 0)) + 1 : null;
  updatePlace(id, { day, order_idx: order }, day ? `${day}일차에 배정했어요` : '후보로 옮겼어요');
}

async function movePlace(id, dir) {
  const p = placeById(id); if (!p?.day) return;
  const list = dayList(p.day); const i = list.findIndex((x) => x.id === id); const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  const changes = list.map((x, k) => ({ x, k })).filter(({ x, k }) => x.order_idx !== k);
  changes.forEach(({ x, k }) => { x.order_idx = k; });
  renderAll();
  await run(() => Promise.all(changes.map(({ x, k }) => store.updatePlace(x.id, { order_idx: k }))));
}

function toggleVote(id) {
  const on = !iVoted(id);
  const v = { place_id: id, room_id: S.roomId, voter_id: S.me.id, voter_name: S.me.name };
  if (on) S.votes.push({ ...v, created_at: new Date().toISOString() });
  else S.votes = S.votes.filter((x) => !(x.place_id === id && x.voter_id === S.me.id));
  renderAll();
  run(() => store.setVote(v, on));
}

/* ============================================================
 *  장소 상세
 * ============================================================ */
let detailDirty = false;
const detailFocused = () => {
  const a = document.activeElement;
  return a && $('#detail').contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName);
};

function openDetail(id) {
  const p = placeById(id); if (!p) return;
  S.sel = id; S.editMemo = null; S.temp = null;
  renderTempbar(); renderSheet(); renderMap();
  map.panTo(p, { offsetY: ($('#app').clientHeight * 0.68 - TOP_PAD) / 2 });
  renderDetail(true);
}
function closeDetail() {
  S.sel = null; S.editMemo = null;
  $('#detail').hidden = true; $('#detail').innerHTML = '';
  renderSheet(); renderMap();
}

function renderDetail(force = false) {
  const p = placeById(S.sel);
  const D = $('#detail');
  if (!p) { D.hidden = true; return; }
  if (!force && detailFocused()) { detailDirty = true; return; }
  detailDirty = false;
  const c = CATS[p.category] || CATS.tour;
  const votes = votesOf(p.id);
  const memos = memosOf(p.id);
  const links = map.links(p);
  const n = roomDays();
  const scroll = D.firstElementChild ? D.firstElementChild.scrollTop : 0;
  let dayOpts = `<option value="">📥 후보 (미배정)</option>`;
  for (let d = 1; d <= n; d++) dayOpts += `<option value="${d}" ${p.day === d ? 'selected' : ''}>🗓️ ${esc(dayLabel(d, S.room))}${p.day === d ? ` · ${dayList(d).findIndex((x) => x.id === p.id) + 1}번째` : ''}</option>`;

  D.innerHTML = `<div class="panel" style="max-height:68dvh" role="dialog" aria-label="${esc(p.name)} 상세">
    <div class="grip"></div>
    <div class="d-head">
      <div class="ico" style="--cs:${c.soft}">${c.emoji}</div>
      <div class="t">
        <input class="d-name" data-f="name" value="${esc(p.name)}" maxlength="60" aria-label="장소 이름">
        <div class="d-addr">${esc(p.address || '주소 정보 없음')}${p.phone ? ` · ${esc(p.phone)}` : ''}</div>
      </div>
      <button class="d-close" data-d="close" aria-label="닫기">✕</button>
    </div>

    <div class="d-row">
      <span class="badge who">👤 ${esc(p.proposer)} 제안</span>
      <button class="heart ${iVoted(p.id) ? 'on' : ''}" data-d="vote"><span class="h">❤️</span>가고 싶어요 ${votes.length}</button>
      ${votes.length ? `<small style="color:var(--muted);font-size:12px">${votes.map((v) => esc(v.voter_name)).join(', ')}</small>` : ''}
    </div>

    <div class="d-links">
      <a class="btn sm naver" href="${links.naver}" target="_blank" rel="noopener">N 네이버지도로 보기</a>
      <a class="btn sm kakao" href="${links.directions}" target="_blank" rel="noopener">🧭 카카오맵 길찾기</a>
    </div>

    <div class="field"><span class="lab">카테고리</span>
      <div class="cats">${CAT_KEYS.map((k) => `<button style="--c:${CATS[k].color}" class="${p.category === k ? 'on' : ''}" data-d="cat" data-v="${k}">${CATS[k].emoji} ${CATS[k].label}</button>`).join('')}</div>
    </div>

    <div class="field"><label for="dDay">일정</label>
      <select class="input" id="dDay" data-f="day">${dayOpts}</select>
    </div>

    <div class="field"><span class="lab">예약 상태</span>
      <div class="seg">${Object.entries(STATUS).map(([k, l]) => `<button class="st-${k} ${(p.status || 'undecided') === k ? 'on' : ''}" data-d="status" data-v="${k}">${l}</button>`).join('')}</div>
    </div>

    <div class="field"><label for="dCost">예상 비용 (전체 기준)</label>
      <div class="cost-wrap"><input class="input" id="dCost" data-f="cost" inputmode="numeric" placeholder="0" value="${p.cost ? Number(p.cost).toLocaleString('ko-KR') : ''}"></div>
    </div>

    <div class="field"><span class="lab">공동 메모 ${memos.length ? `(${memos.length})` : ''}</span>
      <div class="memos">${memos.map((m) => memoHtml(m)).join('') || '<div style="color:var(--muted);font-size:13px">예약 팁, 메뉴 추천, 영업시간 등을 함께 적어 보세요.</div>'}</div>
      <div class="memo-add"><textarea class="input" id="memoInput" rows="1" maxlength="500" placeholder="${esc(S.me.name)}(으)로 메모 남기기"></textarea><button class="btn teal" data-d="memo">등록</button></div>
    </div>

    <div class="d-foot">
      <span>${timeAgo(p.created_at)} 추가${p.updated_at && p.updated_at !== p.created_at ? ` · ${timeAgo(p.updated_at)} 수정` : ''}</span>
      <button class="btn danger sm" data-d="delete">🗑️ 핀 삭제</button>
    </div>
  </div>`;
  D.classList.toggle('opening', D.hidden);
  D.hidden = false;
  D.style.background = 'rgba(43,41,38,.12)';
  D.firstElementChild.scrollTop = scroll;
}

function memoHtml(m) {
  const mine = m.author_id === S.me.id;
  if (S.editMemo === m.id) {
    return `<div class="memo mine"><textarea class="input" id="memoEdit" rows="2" maxlength="500">${esc(m.body)}</textarea>
      <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:6px"><button class="btn xs" data-d="memoCancel">취소</button><button class="btn teal xs" data-d="memoSave" data-id="${m.id}">저장</button></div></div>`;
  }
  return `<div class="memo ${mine ? 'mine' : ''}"><div class="m-top"><span class="badge who">${esc(m.author)}</span><span>${timeAgo(m.created_at)}${m.edited_at ? ' · 수정됨' : ''}</span><span class="sp"></span>
    ${mine ? `<button data-d="memoEditStart" data-id="${m.id}">수정</button><button data-d="memoDel" data-id="${m.id}">삭제</button>` : ''}</div>
    <div class="m-body">${esc(m.body)}</div></div>`;
}

async function onDetailClick(e) {
  if (e.target === $('#detail')) { closeDetail(); return; }
  const b = e.target.closest('[data-d]'); if (!b) return;
  const p = placeById(S.sel); if (!p) return;
  const { d, v, id } = b.dataset;
  if (d === 'close') closeDetail();
  else if (d === 'vote') toggleVote(p.id);
  else if (d === 'cat') updatePlace(p.id, { category: v });
  else if (d === 'status') updatePlace(p.id, { status: v });
  else if (d === 'memo') {
    const ta = $('#memoInput'); const body = ta.value.trim(); if (!body) { ta.focus(); return; }
    ta.value = ''; ta.blur();
    const m = { id: uuid(), place_id: p.id, room_id: S.roomId, author: S.me.name, author_id: S.me.id, body };
    S.memos.push({ ...m, created_at: new Date().toISOString() }); renderDetail(true); renderSheet();
    run(() => store.addMemo(m));
  } else if (d === 'memoEditStart') { S.editMemo = id; renderDetail(true); const t = $('#memoEdit'); t && t.focus(); }
  else if (d === 'memoCancel') { S.editMemo = null; renderDetail(true); }
  else if (d === 'memoSave') {
    const body = $('#memoEdit').value.trim(); if (!body) return;
    const m = S.memos.find((x) => x.id === id); if (m) { m.body = body; m.edited_at = new Date().toISOString(); }
    S.editMemo = null; renderDetail(true);
    run(() => store.updateMemo(id, body));
  } else if (d === 'memoDel') {
    if (!confirm('이 메모를 삭제할까요?')) return;
    S.memos = S.memos.filter((x) => x.id !== id); renderDetail(true);
    run(() => store.deleteMemo(id));
  } else if (d === 'delete') {
    if (!confirm(`‘${p.name}’ 핀을 삭제할까요?\n메모와 하트도 함께 지워져요.`)) return;
    S.places = S.places.filter((x) => x.id !== p.id);
    closeDetail(); renderAll();
    run(() => store.deletePlace(p.id), '핀을 삭제했어요');
  }
}

function onDetailChange(e) {
  const f = e.target.dataset.f; const p = placeById(S.sel); if (!f || !p) return;
  if (f === 'name') {
    const name = e.target.value.trim();
    if (!name) { e.target.value = p.name; return; }
    if (name !== p.name) updatePlace(p.id, { name });
  } else if (f === 'cost') {
    const n = Number(String(e.target.value).replace(/[^\d]/g, '')) || null;
    e.target.value = n ? n.toLocaleString('ko-KR') : '';
    if (n !== (p.cost || null)) updatePlace(p.id, { cost: n });
  } else if (f === 'day') {
    e.target.blur();
    assignDay(p.id, e.target.value ? Number(e.target.value) : null);
  }
}

/* ============================================================
 *  모달 (닉네임 / 방 설정 / 직접 핀 추가)
 * ============================================================ */
function openModal(html, { center = true } = {}) {
  const M = $('#modal');
  M.className = `overlay opening${center ? ' mid' : ''}`;
  M.innerHTML = `<div class="panel ${center ? 'center' : ''}">${html}</div>`;
  M.hidden = false;
  M.onclick = (e) => { if (e.target === M && M.dataset.lock !== '1') closeModal(); };
  return M;
}
function closeModal() { const M = $('#modal'); M.hidden = true; M.innerHTML = ''; M.dataset.lock = ''; }

function askNickname(change = false) {
  return new Promise((resolve) => {
    const M = openModal(`<h2>${change ? '닉네임 바꾸기' : '반가워요! 👋'}</h2>
      <p class="sub">${change ? '앞으로 추가하는 핀·메모에 표시돼요.' : `‘${esc(S.room?.title || '여행')}’에 참여할 닉네임을 정해 주세요.<br>핀과 메모에 이름이 표시돼요.`}</p>
      <form id="nickForm"><input class="input" id="nickInput" maxlength="12" placeholder="예: 민지" value="${esc(S.me.name)}" required>
      <button class="btn primary block" style="margin-top:12px" type="submit">${change ? '저장' : '여행 계획 보러 가기'}</button></form>`);
    M.dataset.lock = change ? '' : '1';
    const inp = $('#nickInput'); setTimeout(() => inp.focus(), 50);
    $('#nickForm').onsubmit = (e) => {
      e.preventDefault(); const v = inp.value.trim(); if (!v) return;
      setMyName(v); closeModal(); resolve(v);
    };
  });
}

function openRoomSettings() {
  const r = S.room;
  const minDays = Math.max(1, ...S.places.map((p) => p.day || 0));
  openModal(`<h2>여행 정보</h2><p class="sub">방 코드 <b>${esc(S.roomId)}</b> · 링크를 가진 누구나 함께 편집할 수 있어요.</p>
    <form id="roomForm">
      <div class="field"><label for="rTitle">여행 이름</label><input class="input" id="rTitle" maxlength="40" value="${esc(r.title)}" required></div>
      <div class="two">
        <div class="field"><label for="rDays">일수</label><input class="input" id="rDays" type="number" min="${minDays}" max="30" value="${roomDays()}"></div>
        <div class="field"><label for="rStart">출발일</label><input class="input" id="rStart" type="date" value="${esc(r.start_date || '')}"></div>
      </div>
      <button class="btn primary block" style="margin-top:16px" type="submit">저장</button>
    </form>
    <div class="two" style="margin-top:10px"><button class="btn sm" id="rShare">🔗 링크 공유</button><a class="btn sm" href="./">＋ 새 여행</a></div>`);
  $('#rShare').onclick = () => shareRoom(false);
  $('#roomForm').onsubmit = async (e) => {
    e.preventDefault();
    const days = Math.max(minDays, Math.min(30, Number($('#rDays').value) || 1));
    const patch = { title: $('#rTitle').value.trim() || r.title, days, start_date: $('#rStart').value || null };
    closeModal();
    Object.assign(S.room, patch); renderAll();
    run(() => store.updateRoom(S.roomId, patch), '저장했어요');
  };
}

function openManualAdd() {
  const t = S.temp; if (!t) return;
  let cat = 'food';
  openModal(`<div class="grip"></div><h2>📍 직접 핀 추가</h2><p class="sub">${esc(t.address)}</p>
    <form id="manForm">
      <div class="field"><label for="mName">장소 이름</label><input class="input" id="mName" maxlength="60" placeholder="예: 숙소 앞 포장마차" required></div>
      <div class="field"><span class="lab">카테고리</span><div class="cats" id="mCats">${CAT_KEYS.map((k) => `<button type="button" style="--c:${CATS[k].color}" class="${k === cat ? 'on' : ''}" data-v="${k}">${CATS[k].emoji} ${CATS[k].label}</button>`).join('')}</div></div>
      <button class="btn primary block" style="margin-top:16px" type="submit">후보에 추가</button>
    </form>`, { center: false });
  setTimeout(() => $('#mName').focus(), 50);
  $('#mCats').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return; cat = b.dataset.v;
    $('#mCats').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  };
  $('#manForm').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#mName').value.trim(); if (!name) return;
    closeModal();
    const addr = t.address === '주소 확인 중…' || t.address === '이름 없는 위치' ? '' : t.address;
    S.temp = null; renderTempbar();
    if (S.tab === 'search') S.tab = 'cand';
    await addPlace({ name, address: addr, lat: t.lat, lng: t.lng, category: cat });
    toast(`‘${name}’ 후보에 추가!`);
  };
}

/* ============================================================
 *  공유
 * ============================================================ */
async function shareRoom(first) {
  const url = `${location.origin}${location.pathname}?room=${S.roomId}`;
  const text = `‘${S.room.title}’ 여행 계획 같이 짜요! 링크 열고 닉네임만 입력하면 돼요 ✈️`;
  if (navigator.share && !first) {
    try { await navigator.share({ title: S.room.title, text, url }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast(first ? '방을 만들었어요! 공유 링크가 복사됐어요 🔗' : '링크를 복사했어요 🔗', 3000); }
  catch (_) {
    openModal(`<h2>공유 링크</h2><p class="sub">아래 링크를 복사해서 친구에게 보내 주세요.</p><input class="input" value="${esc(url)}" readonly onclick="this.select()"><button class="btn primary block" style="margin-top:12px" onclick="this.closest('.overlay').hidden=true">확인</button>`);
  }
}
