/* 지도 provider 공용: 핀 DOM 만들기 + 꾹 누르기 감지 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function makePinEl(m, onTap) {
  const wrap = document.createElement('div');
  wrap.className = 'pin-wrap'
    + (m.numbered ? ' num' : '')
    + (m.faded ? ' faded' : '')
    + (m.selected ? ' sel' : '')
    + (m.temp ? ' temp' : '');
  wrap.style.setProperty('--c', m.color || '#F2675A');
  if (m.title) wrap.title = m.title;
  wrap.innerHTML = `<div class="pin"><span>${esc(m.label ?? '')}</span></div>${m.tag ? `<b class="pin-tag">${esc(m.tag)}</b>` : ''}`;
  const stop = (e) => e.stopPropagation();
  wrap.addEventListener('pointerdown', stop);
  wrap.addEventListener('mousedown', stop);
  wrap.addEventListener('touchstart', stop, { passive: true });
  wrap.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!m.temp && onTap) onTap(m.id);
  });
  return wrap;
}

/** 지도 컨테이너 위에서 550ms 이상 누르고 있으면 cb(x, y) 호출 (컨테이너 기준 좌표) */
export function attachLongPress(el, cb, ms = 550) {
  let timer = null, sx = 0, sy = 0, pointers = 0;
  const cancel = () => { clearTimeout(timer); timer = null; };
  el.addEventListener('pointerdown', (e) => {
    pointers++;
    if (pointers > 1 || e.target.closest('.pin-wrap') || e.button > 0) return cancel();
    sx = e.clientX; sy = e.clientY;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      const r = el.getBoundingClientRect();
      if (navigator.vibrate) try { navigator.vibrate(15); } catch (_) {}
      cb(sx - r.left, sy - r.top);
    }, ms);
  });
  el.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) cancel();
  });
  const up = () => { pointers = Math.max(0, pointers - 1); cancel(); };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', () => { pointers = 0; cancel(); });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
