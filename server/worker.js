// 랜선 스키장 멀티플레이 서버 (Cloudflare Workers + Durable Objects)
// 방 하나(main)에 모두 접속. 위치는 모아서 일정 간격으로 뿌리고, 채팅은 바로 전달.

const MAX_PLAYERS = 40;          // 동시 접속 상한
const TICK_MS = 150;             // 위치 묶음 전송 간격
const STALE_MS = 30000;          // 이 시간 동안 아무 소식 없으면 연결 정리
const CHAT_GAP_MS = 700;         // 채팅 도배 방지

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      const id = env.ROOM.idFromName('main');
      return env.ROOM.get(id).fetch(request);
    }
    if (url.pathname === '/health') return new Response('ok');
    return new Response('랜선 스키장 서버가 켜져 있어요 ⛷️', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
};

const clean = (s, n) => Array.from(String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '')).slice(0, n).join('').trim();
const num = (v, lo, hi, d = 0) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const STR_KEYS = ['style', 'pattern', 'pantsStyle', 'hat', 'gear'];
const COL_KEYS = ['jacket', 'jacket2', 'pants', 'hatColor', 'lens', 'glove', 'skiCol', 'boardCol'];
function cleanOutfit(o) {
  const r = {};
  if (!o || typeof o !== 'object') return r;
  for (const k of STR_KEYS) if (typeof o[k] === 'string') r[k] = o[k].slice(0, 12);
  for (const k of COL_KEYS) if (typeof o[k] === 'number') r[k] = Math.floor(num(o[k], 0, 0xffffff));
  r.neck = typeof o.neck === 'number' ? Math.floor(num(o.neck, 0, 0xffffff)) : null;
  return r;
}

export class Room {
  constructor(state, env) {
    this.players = new Map();
    this.nextId = 1;
    this.timer = null;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    if (this.players.size >= MAX_PLAYERS) {
      server.send(JSON.stringify({ t: 'full', max: MAX_PLAYERS }));
      server.close(1013, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }

    const id = this.nextId++;
    const p = { id, ws: server, n: '스키어', g: 'm', o: {}, last: null, dirty: false, seen: Date.now(), lastChat: 0, hello: false };
    this.players.set(id, p);

    server.addEventListener('message', (ev) => this.onMessage(p, ev.data));
    const gone = () => this.drop(p);
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);

    this.startTimer();
    return new Response(null, { status: 101, webSocket: client });
  }

  onMessage(p, raw) {
    p.seen = Date.now();
    if (typeof raw !== 'string' || raw.length > 2000) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'hi' && !p.hello) {
      p.hello = true;
      p.n = clean(m.n, 8) || '스키어';
      p.g = m.g === 'f' ? 'f' : 'm';
      p.o = cleanOutfit(m.o);
      const list = [];
      for (const q of this.players.values()) if (q !== p && q.hello) list.push({ id: q.id, n: q.n, g: q.g, o: q.o, a: q.last });
      this.send(p, { t: 'w', you: p.id, list, online: this.count() });
      this.broadcast({ t: 'j', id: p.id, n: p.n, g: p.g, o: p.o, online: this.count() }, p);
    } else if (m.t === 'o' && p.hello) {
      p.o = cleanOutfit(m.o);
      this.broadcast({ t: 'o', id: p.id, o: p.o }, p);
    } else if (m.t === 'p' && p.hello && Array.isArray(m.a) && m.a.length === 13) {
      const a = m.a;
      p.last = [
        num(a[0], -2000, 2000), num(a[1], -200, 2000), num(a[2], -2000, 2000), num(a[3], -10, 10),
        a[4] | 0, a[5] | 0, num(a[6], 0, 80), num(a[7], -20, 20), num(a[8], -20, 20), num(a[9], -1, 1),
        a[10] | 0, a[11] | 0, a[12] | 0,
      ].map((v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : 0));
      p.dirty = true;
    } else if (m.t === 'c' && p.hello) {
      const now = Date.now();
      if (now - p.lastChat < CHAT_GAP_MS) return;
      const text = clean(m.m, 60);
      if (!text) return;
      p.lastChat = now;
      this.broadcast({ t: 'c', id: p.id, n: p.n, m: text }, p);
    }
  }

  send(p, obj) { try { p.ws.send(JSON.stringify(obj)); } catch {} }

  broadcast(obj, except) {
    const s = JSON.stringify(obj);
    for (const q of this.players.values()) if (q !== except && q.hello) { try { q.ws.send(s); } catch {} }
  }

  count() { let n = 0; for (const q of this.players.values()) if (q.hello) n++; return n; }

  drop(p) {
    if (!this.players.delete(p.id)) return;
    try { p.ws.close(); } catch {}
    if (p.hello) this.broadcast({ t: 'l', id: p.id, online: this.count() });
    if (this.players.size === 0) this.stopTimer();
  }

  startTimer() { if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS); }
  stopTimer() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  tick() {
    const now = Date.now();
    for (const p of [...this.players.values()]) if (now - p.seen > STALE_MS) this.drop(p);
    const moved = [];
    for (const p of this.players.values()) if (p.dirty && p.last) { moved.push([p.id, ...p.last]); p.dirty = false; }
    if (!moved.length) return;
    for (const q of this.players.values()) {
      if (!q.hello) continue;
      const list = moved.filter((r) => r[0] !== q.id);
      if (list.length) this.send(q, { t: 's', p: list });
    }
  }
}
