/* ============================================================
 *  store — 저장/실시간 공유 계층
 *   · SupabaseStore : config.js 에 URL/Anon Key가 있을 때 (실시간 공유)
 *   · LocalStore    : 데모 모드 (이 브라우저 localStorage + 탭 간 동기화)
 *  두 구현은 같은 메서드를 가집니다.
 * ============================================================ */

const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }));

export function makeRoomCode(len = 7) {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const a = new Uint32Array(len); crypto.getRandomValues(a);
  return [...a].map((n) => abc[n % abc.length]).join('');
}

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Supabase 라이브러리 로드 실패'));
    document.head.appendChild(s);
  });
}

export async function createStore(cfg) {
  if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) {
    try {
      if (!window.supabase) await loadScript(SUPABASE_CDN);
      // 'https://xxx.supabase.co/rest/v1/' 처럼 붙여넣어도 기본 주소만 사용
      const url = String(cfg.SUPABASE_URL).trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
      return new SupabaseStore(window.supabase.createClient(url, String(cfg.SUPABASE_ANON_KEY).trim(), {
        auth: { persistSession: false },
        realtime: { params: { eventsPerSecond: 10 } },
      }));
    } catch (err) {
      console.warn('[store] Supabase 사용 불가 → 로컬 데모 저장소', err);
      const s = new LocalStore(); s.error = err.message; return s;
    }
  }
  return new LocalStore();
}

/* ---------------- Supabase ---------------- */
class SupabaseStore {
  constructor(sb) { this.sb = sb; this.mode = 'supabase'; }

  _ok({ data, error }) { if (error) throw new Error(error.message); return data; }

  async createRoom({ title, days, startDate }) {
    for (let i = 0; i < 4; i++) {
      const id = makeRoomCode();
      const { error } = await this.sb.from('rooms').insert({ id, title, days, start_date: startDate || null });
      if (!error) return id;
      if (error.code !== '23505') throw new Error(error.message); // 23505 = 코드 중복 → 재시도
    }
    throw new Error('방 코드를 만들지 못했어요. 다시 시도해 주세요.');
  }

  async loadRoom(id) {
    const sb = this.sb;
    const [room, places, memos, votes] = await Promise.all([
      sb.from('rooms').select('*').eq('id', id).maybeSingle(),
      sb.from('places').select('*').eq('room_id', id),
      sb.from('memos').select('*').eq('room_id', id).order('created_at'),
      sb.from('votes').select('*').eq('room_id', id),
    ]);
    const r = this._ok(room);
    if (!r) return null;
    return { room: r, places: this._ok(places), memos: this._ok(memos), votes: this._ok(votes) };
  }

  async updateRoom(id, patch) { this._ok(await this.sb.from('rooms').update(patch).eq('id', id)); }

  async addPlace(p) { return this._ok(await this.sb.from('places').insert(p).select().single()); }
  async updatePlace(id, patch) {
    this._ok(await this.sb.from('places').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id));
  }
  async deletePlace(id) { this._ok(await this.sb.from('places').delete().eq('id', id)); }

  async addMemo(m) { this._ok(await this.sb.from('memos').insert(m)); }
  async updateMemo(id, body) { this._ok(await this.sb.from('memos').update({ body, edited_at: new Date().toISOString() }).eq('id', id)); }
  async deleteMemo(id) { this._ok(await this.sb.from('memos').delete().eq('id', id)); }

  async setVote({ place_id, room_id, voter_id, voter_name }, on) {
    if (on) this._ok(await this.sb.from('votes').upsert({ place_id, room_id, voter_id, voter_name }));
    else this._ok(await this.sb.from('votes').delete().eq('place_id', place_id).eq('voter_id', voter_id));
  }

  /** 방 안의 어떤 변경이든 onChange() 호출. 반환값: 구독 해제 함수 */
  subscribe(roomId, onChange, onStatus) {
    const ch = this.sb.channel(`room:${roomId}`);
    for (const t of ['places', 'memos', 'votes']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: `room_id=eq.${roomId}` }, onChange);
    }
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, onChange);
    ch.subscribe((status) => onStatus && onStatus(status));
    return () => this.sb.removeChannel(ch);
  }
}

/* ---------------- Local (데모) ---------------- */
const LS_KEY = 'gachi:demo-db';

class LocalStore {
  constructor() {
    this.mode = 'local';
    this.bc = 'BroadcastChannel' in window ? new BroadcastChannel('gachi-demo') : null;
  }
  _db() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || { rooms: {}, places: [], memos: [], votes: [] }; }
    catch (_) { return { rooms: {}, places: [], memos: [], votes: [] }; }
  }
  _save(db) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch (_) {}
    this.bc && this.bc.postMessage('change');
    this._local && this._local();
  }
  _now() { return new Date().toISOString(); }

  async createRoom({ title, days, startDate }) {
    const db = this._db(); const id = makeRoomCode();
    db.rooms[id] = { id, title, days, start_date: startDate || null, created_at: this._now() };
    this._save(db); return id;
  }
  async loadRoom(id) {
    const db = this._db(); const room = db.rooms[id];
    if (!room) return null;
    const f = (x) => x.room_id === id;
    return { room, places: db.places.filter(f), memos: db.memos.filter(f), votes: db.votes.filter(f) };
  }
  async updateRoom(id, patch) { const db = this._db(); Object.assign(db.rooms[id], patch); this._save(db); }

  async addPlace(p) {
    const db = this._db(); const row = { created_at: this._now(), updated_at: this._now(), ...p };
    db.places.push(row); this._save(db); return row;
  }
  async updatePlace(id, patch) {
    const db = this._db(); const p = db.places.find((x) => x.id === id);
    if (p) Object.assign(p, patch, { updated_at: this._now() }); this._save(db);
  }
  async deletePlace(id) {
    const db = this._db();
    db.places = db.places.filter((x) => x.id !== id);
    db.memos = db.memos.filter((x) => x.place_id !== id);
    db.votes = db.votes.filter((x) => x.place_id !== id);
    this._save(db);
  }
  async addMemo(m) { const db = this._db(); db.memos.push({ id: uuid(), created_at: this._now(), ...m }); this._save(db); }
  async updateMemo(id, body) { const db = this._db(); const m = db.memos.find((x) => x.id === id); if (m) Object.assign(m, { body, edited_at: this._now() }); this._save(db); }
  async deleteMemo(id) { const db = this._db(); db.memos = db.memos.filter((x) => x.id !== id); this._save(db); }
  async setVote(v, on) {
    const db = this._db();
    db.votes = db.votes.filter((x) => !(x.place_id === v.place_id && x.voter_id === v.voter_id));
    if (on) db.votes.push({ ...v, created_at: this._now() });
    this._save(db);
  }
  subscribe(roomId, onChange, onStatus) {
    const h = () => onChange();
    this.bc && this.bc.addEventListener('message', h);
    const sh = (e) => { if (e.key === LS_KEY) onChange(); };
    window.addEventListener('storage', sh);
    onStatus && onStatus('LOCAL');
    return () => { this.bc && this.bc.removeEventListener('message', h); window.removeEventListener('storage', sh); };
  }
}
