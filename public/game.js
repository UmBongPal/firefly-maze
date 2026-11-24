(() => {
'use strict';
// ── Maze ── # 울타리  . 꽃가루  o 등불꽃  - 도깨비불 집 문  P 시작
const MAP = [
"###################",
"#........#........#",
"#o##.###.#.###.##o#",
"#.................#",
"#.##.#.#####.#.##.#",
"#....#...#...#....#",
"####.### # ###.####",
"####.#       #.####",
"####.# ##-## #.####",
"    .  #   #  .    ",
"####.# ##### #.####",
"####.#       #.####",
"####.# ##### #.####",
"#........#........#",
"#.##.###.#.###.##.#",
"#o.#.....P.....#.o#",
"##.#.#.#####.#.#.##",
"#....#...#...#....#",
"#.######.#.######.#",
"#.................#",
"###################"];
const H = MAP.length, W = MAP[0].length;
const EPS = 1e-4;
const DIRS = { up:{x:0,y:-1}, down:{x:0,y:1}, left:{x:-1,y:0}, right:{x:1,y:0} };
const DIR_LIST = [DIRS.up, DIRS.left, DIRS.down, DIRS.right];
const DOOR_OUT = {x:9, y:7};
const TUNNEL_ROW = 9;
const MODES = [['scatter',7],['chase',20],['scatter',7],['chase',20],['scatter',5],['chase',Infinity]];
const STORE_BEST = 'firefly-maze-best', STORE_MUTE = 'firefly-maze-muted';

const WISPS = [
  { name:'홍염', color:'#ff5470', kind:'chase',  corner:{x:W-2,y:-3}, start:{x:9,y:7},  release:0 },
  { name:'자운', color:'#b48cff', kind:'ambush', corner:{x:1,y:-3},   start:{x:9,y:9},  release:1.5 },
  { name:'청람', color:'#3fd6c9', kind:'flank',  corner:{x:W-1,y:H+1},start:{x:8,y:9},  release:4.5 },
  { name:'도화', color:'#ff8fd1', kind:'shy',    corner:{x:0,y:H+1},  start:{x:10,y:9}, release:8 },
];

// ── DOM ──
const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');
const stage = $('stage'), board = $('board'), overlay = $('overlay');
const $score = $('score'), $best = $('best'), $level = $('level'), $lives = $('lives');
const muteBtn = $('muteBtn'), pauseBtn = $('pauseBtn');
// [FIX] 매 프레임 getComputedStyle 호출(강제 스타일 재계산) 제거 — 부팅 시 1회만 읽음
const FONT_DISPLAY = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim() || 'sans-serif';

// ── Safe storage ── [FIX] 사설모드/차단 환경 대비 + 변조 값(음수·NaN·거대값) 차단
const store = {
  get(k){ try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v){ try { localStorage.setItem(k, v); } catch {} },
};
const readInt = v => { const n = Number.parseInt(v ?? '', 10); return Number.isSafeInteger(n) && n > 0 ? n : 0; };

// ── State ──
let grid, seedsLeft, playerStart;
let state = 'title', prevState = null, stateTimer = 0;
let score = 0, best = readInt(store.get(STORE_BEST)), level = 1, lives = 3, extraGiven = false;
let player, ghosts, modeIdx, modeTimer, frightTimer, ghostCombo, elapsed, hitstop = 0;
let popups = [];
let ts = 0, dpr = 0, wallCanvas, litCanvas;

const wrapX = x => ((x % W) + W) % W;
function tileAt(x, y){ if (y < 0 || y >= H) return '#'; return grid[y][wrapX(x)]; }
function blocked(x, y, doorOk){ const c = tileAt(x, y); return c === '#' || (c === '-' && !doorOk); }
function atCenter(e){ return Math.abs(e.x - Math.round(e.x)) < EPS && Math.abs(e.y - Math.round(e.y)) < EPS; }
function wrapPos(e){ if (e.x < -0.5) e.x += W; else if (e.x > W - 0.5) e.x -= W; }

function parseMap(){
  grid = MAP.map(r => r.split(''));
  seedsLeft = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const c = grid[y][x];
    if (c === 'P'){ playerStart = {x, y}; grid[y][x] = ' '; }
    if (c === '.' || c === 'o') seedsLeft++;
  }
}

function resetActors(){
  player = { x:playerStart.x, y:playerStart.y, dir:{x:0,y:0}, next:DIRS.left, face:DIRS.left };
  const scale = Math.max(0.35, 1 - (level - 1) * 0.15);
  ghosts = WISPS.map((d, i) => ({
    def:d, x:d.start.x, y:d.start.y, dir: i === 0 ? {x:-1,y:0} : {x:0,y:0},
    state: i === 0 ? 'active' : 'house', releaseAt: d.release * scale,
    fright:false, lastTile:null, phase: i * 1.7,
  }));
  modeIdx = 0; modeTimer = MODES[0][1]; frightTimer = 0; ghostCombo = 0; elapsed = 0; hitstop = 0;
  popups.length = 0;
  state = 'ready'; stateTimer = 2;
}

// [FIX] 레벨마다 울타리 레이어를 다시 그리던 낭비 제거 — 맵 모양은 고정이라 resize 때만 재생성
function newLevel(){ parseMap(); resetActors(); hud(); }

// ── Speeds (tiles per second) ──
const lvl = () => Math.min(level - 1, 7);
const playerSpeed = () => 7.4 + lvl() * 0.3 + (frightTimer > 0 ? 0.4 : 0);
const frightDuration = () => Math.max(1.5, 7 - (level - 1) * 0.8);
function ghostSpeed(g){
  if (g.state === 'eyes' || g.state === 'entering') return 15;
  if (g.state === 'leaving') return 4;
  const base = 6.4 + lvl() * 0.38;
  const tx = wrapX(Math.round(g.x)), ty = Math.round(g.y);
  if (ty === TUNNEL_ROW && (tx < 4 || tx > 14)) return base * 0.5;
  return g.fright ? base * 0.6 : base;
}

// ── Grid mover: walks center to center, calling onCenter at each tile center ──
function advance(e, dist, onCenter){
  let guard = 0;
  while (dist > EPS && guard++ < 24){
    if (atCenter(e)){
      e.x = Math.round(e.x); e.y = Math.round(e.y);
      onCenter(e);
      if (!e.dir.x && !e.dir.y) return;
    }
    let tx = e.x, ty = e.y;
    if (e.dir.x) tx = e.dir.x > 0 ? Math.floor(e.x + EPS) + 1 : Math.ceil(e.x - EPS) - 1;
    else ty = e.dir.y > 0 ? Math.floor(e.y + EPS) + 1 : Math.ceil(e.y - EPS) - 1;
    const d = Math.abs(tx - e.x) + Math.abs(ty - e.y);
    if (dist >= d - EPS){ e.x = tx; e.y = ty; dist -= d; }
    else { e.x += e.dir.x * dist; e.y += e.dir.y * dist; dist = 0; }
    wrapPos(e);
  }
  if (atCenter(e)){ e.x = Math.round(e.x); e.y = Math.round(e.y); onCenter(e); }
}

// ── Player ──
function playerCenter(p){
  const tx = wrapX(Math.round(p.x)), ty = Math.round(p.y);
  eat(tx, ty);
  if (state !== 'play') return;
  if (p.next && !blocked(tx + p.next.x, ty + p.next.y, false)) p.dir = p.next;
  if (blocked(tx + p.dir.x, ty + p.dir.y, false)) p.dir = {x:0, y:0};
  if (p.dir.x || p.dir.y) p.face = p.dir;
}
// How far (in tiles) from a junction's center a turn is still accepted, before or after it.
const TURN_WINDOW = 0.42;
function movePlayer(dt){
  const p = player, n = p.next;
  if (n && (p.dir.x || p.dir.y) && n.x === -p.dir.x && n.y === -p.dir.y){ p.dir = n; p.face = n; }
  else if (n && (n.x !== p.dir.x || n.y !== p.dir.y)){
    // Turn assist: a key pressed a little before or after the junction still takes the turn.
    const cx = Math.round(p.x), cy = Math.round(p.y);
    const off = Math.abs(p.x - cx) + Math.abs(p.y - cy);
    const tx = wrapX(cx);
    if (off <= TURN_WINDOW && !blocked(tx + n.x, cy + n.y, false)){
      p.x = cx; p.y = cy; wrapPos(p);
      p.dir = n; p.face = n;
      eat(tx, cy);
      if (state !== 'play') return;
    }
  }
  advance(p, playerSpeed() * dt, playerCenter);
}

function eat(x, y){
  const row = grid[y]; if (!row) return;   // [FIX] 범위 밖 좌표 방어
  const c = row[x];
  if (c === '.'){ row[x] = ' '; addScore(10); seedsLeft--; sfx.seed(); }
  else if (c === 'o'){ row[x] = ' '; addScore(50); seedsLeft--; startFright(); }
  else return;
  if (seedsLeft <= 0){ state = 'clear'; stateTimer = 2.4; sfx.clear(); }
}

function addScore(n){
  score += n;
  if (!extraGiven && score >= 10000){ extraGiven = true; lives++; sfx.extra(); popups.push({x:player.x, y:player.y - 1, text:'빛 +1', life:1.4}); }
  // [FIX] 꽃가루 1개마다 localStorage 동기 쓰기 → 최고점 저장은 라운드 종료·탭 이탈 때만
  if (score > best) best = score;
  hud();
}
const saveBest = () => { if (best > readInt(store.get(STORE_BEST))) store.set(STORE_BEST, String(best)); };

// ── Wisps ──
function startFright(){
  frightTimer = frightDuration(); ghostCombo = 0;
  for (const g of ghosts){
    if (g.state === 'active'){ g.fright = true; g.dir = {x:-g.dir.x, y:-g.dir.y}; g.lastTile = null; }
    else if (g.state === 'house' || g.state === 'leaving') g.fright = true;
  }
  sfx.lantern();
}
function reverseAll(){
  for (const g of ghosts) if (g.state === 'active'){ g.dir = {x:-g.dir.x, y:-g.dir.y}; g.lastTile = null; }
}
function targetOf(g){
  if (g.state === 'eyes') return DOOR_OUT;
  if (MODES[modeIdx][0] === 'scatter') return g.def.corner;
  const p = { x:wrapX(Math.round(player.x)), y:Math.round(player.y) }, f = player.face;
  switch (g.def.kind){
    case 'chase':  return p;
    case 'ambush': return { x:p.x + f.x * 4, y:p.y + f.y * 4 };
    case 'flank': { const r = ghosts[0], ax = p.x + f.x * 2, ay = p.y + f.y * 2; return { x:ax * 2 - r.x, y:ay * 2 - r.y }; }
    case 'shy': { const d2 = (g.x - p.x) ** 2 + (g.y - p.y) ** 2; return d2 > 36 ? p : g.def.corner; }
  }
  return p;
}
function ghostCenter(g){
  const tx = wrapX(Math.round(g.x)), ty = Math.round(g.y), key = tx + ',' + ty;
  const ahead = blocked(tx + g.dir.x, ty + g.dir.y, false) || (!g.dir.x && !g.dir.y);
  if (key === g.lastTile && !ahead) return;
  g.lastTile = key;
  if (g.state === 'eyes' && tx === DOOR_OUT.x && ty === DOOR_OUT.y){ g.state = 'entering'; g.dir = {x:0, y:0}; return; }
  const rev = { x:-g.dir.x, y:-g.dir.y };
  let opts = DIR_LIST.filter(d => !(d.x === rev.x && d.y === rev.y) && !blocked(tx + d.x, ty + d.y, false));
  if (!opts.length) opts = DIR_LIST.filter(d => !blocked(tx + d.x, ty + d.y, false));
  if (!opts.length) return;
  if (g.fright && g.state === 'active'){ g.dir = opts[Math.floor(Math.random() * opts.length)]; return; }
  const t = targetOf(g);
  let pick = opts[0], bestD = Infinity;
  for (const d of opts){
    const dd = (tx + d.x - t.x) ** 2 + (ty + d.y - t.y) ** 2;
    if (dd < bestD - 1e-9){ bestD = dd; pick = d; }
  }
  g.dir = pick;
}
function moveScripted(g, dist){
  const goalY = g.state === 'leaving' ? DOOR_OUT.y : 9;
  if (Math.abs(g.x - 9) > EPS){
    const s = Math.sign(9 - g.x), step = Math.min(dist, Math.abs(9 - g.x));
    g.x += s * step; g.dir = {x:s, y:0}; dist -= step;
  }
  if (dist > EPS && Math.abs(g.x - 9) <= EPS){
    g.x = 9;
    const s = Math.sign(goalY - g.y), step = Math.min(dist, Math.abs(goalY - g.y));
    g.y += s * step; g.dir = {x:0, y:s || -1};
    if (Math.abs(g.y - goalY) <= EPS){
      g.y = goalY;
      if (g.state === 'leaving'){ g.state = 'active'; g.dir = {x:-1, y:0}; g.lastTile = null; }
      else { g.state = 'leaving'; g.fright = false; }
    }
  }
}
function moveGhost(g, dt){
  if (g.state === 'house'){ if (elapsed >= g.releaseAt) g.state = 'leaving'; return; }
  const dist = ghostSpeed(g) * dt;
  if (g.state === 'leaving' || g.state === 'entering') return moveScripted(g, dist);
  advance(g, dist, ghostCenter);
}

function collisions(){
  for (const g of ghosts){
    if (g.state !== 'active' && g.state !== 'leaving') continue;
    let dx = Math.abs(g.x - player.x); dx = Math.min(dx, W - dx);
    const dy = Math.abs(g.y - player.y);
    if (dx * dx + dy * dy > 0.42) continue;
    if (g.fright){
      const pts = 200 * 2 ** Math.min(ghostCombo, 3); ghostCombo++;
      addScore(pts);
      popups.push({ x:g.x, y:g.y, text:String(pts), life:1 });
      g.state = 'eyes'; g.fright = false; g.lastTile = null;
      hitstop = 0.45; sfx.eatWisp();
    } else {
      state = 'dying'; stateTimer = 1.7; sfx.die(); return;
    }
  }
}

// ── Main update ──
function update(dt){
  // [FIX] 매 프레임 filter()로 새 배열 할당 → 제자리 압축(GC 압박 제거)
  let k = 0;
  for (const p of popups){ p.life -= dt; if (p.life > 0) popups[k++] = p; }
  popups.length = k;

  if (state === 'ready'){ stateTimer -= dt; if (stateTimer <= 0) state = 'play'; return; }
  if (state === 'dying'){
    stateTimer -= dt;
    if (stateTimer <= 0){ lives--; hud(); if (lives <= 0) gameOver(); else resetActors(); }
    return;
  }
  if (state === 'clear'){ stateTimer -= dt; if (stateTimer <= 0){ level++; saveBest(); newLevel(); } return; }
  if (state !== 'play') return;
  if (hitstop > 0){ hitstop -= dt; return; }
  elapsed += dt;
  if (frightTimer > 0){
    frightTimer -= dt;
    if (frightTimer <= 0){ frightTimer = 0; for (const g of ghosts) g.fright = false; }
  } else if (modeIdx < MODES.length - 1){
    modeTimer -= dt;
    if (modeTimer <= 0){ modeIdx++; modeTimer = MODES[modeIdx][1]; reverseAll(); }
  }
  movePlayer(dt);
  if (state !== 'play') return;
  for (const g of ghosts) moveGhost(g, dt);
  collisions();
}

// ── Rendering ──
function isHedge(x, y){ return x >= 0 && x < W && y >= 0 && y < H && MAP[y][x] === '#'; }
// [FIX] CanvasRenderingContext2D.roundRect 미지원 브라우저(iOS 15 이하 등)에서 TypeError로 게임이 통째로 멈추던 문제
function rrect(c, x, y, w, h, r){
  if (c.roundRect){ c.roundRect(x, y, w, h, r); return; }
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function hedgeLayer(c, inset, color){
  const s = ts, i = inset * s;
  c.fillStyle = color;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    if (!isHedge(x, y)) continue;
    c.beginPath(); rrect(c, x*s + i, y*s + i, s - 2*i, s - 2*i, (s - 2*i) * 0.42); c.fill();
    if (isHedge(x+1, y)) c.fillRect(x*s + s/2, y*s + i, s, s - 2*i);
    if (isHedge(x, y+1)) c.fillRect(x*s + i, y*s + s/2, s - 2*i, s);
    if (isHedge(x+1, y) && isHedge(x, y+1) && isHedge(x+1, y+1)) c.fillRect(x*s + s/2, y*s + s/2, s, s);
  }
}
function makeLayer(edge, fill, leaf, withBackground){
  const cnv = document.createElement('canvas');
  cnv.width = W * ts * dpr; cnv.height = H * ts * dpr;
  const c = cnv.getContext('2d'); c.scale(dpr, dpr);
  // [FIX] 매 프레임 radialGradient 생성 + 전체 화면 채우기 → 정적 레이어에 1회만 베이크
  if (withBackground){
    const g = c.createRadialGradient(W*ts/2, H*ts*0.45, ts, W*ts/2, H*ts*0.45, W*ts*0.8);
    g.addColorStop(0, '#132433'); g.addColorStop(1, '#0a1219');
    c.fillStyle = g; c.fillRect(0, 0, W*ts, H*ts);
  }
  hedgeLayer(c, 0.1, edge);
  hedgeLayer(c, 0.24, fill);
  // leaf speckles, seeded so they stay put
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  c.fillStyle = leaf;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    if (!isHedge(x, y)) continue;
    for (let k = 0; k < 2; k++){
      const lx = (x + 0.3 + rnd() * 0.4) * ts, ly = (y + 0.3 + rnd() * 0.4) * ts;
      c.beginPath(); c.ellipse(lx, ly, ts * 0.07, ts * 0.04, rnd() * Math.PI, 0, Math.PI * 2); c.fill();
    }
  }
  // door of the wisp house
  c.fillStyle = '#ffb38a';
  c.fillRect(9 * ts + ts * 0.1, 8 * ts + ts * 0.43, ts * 0.8, ts * 0.14);
  return cnv;
}
function buildWalls(){
  wallCanvas = makeLayer('#2e7d5b', '#163a2d', 'rgba(70,140,105,.45)', true);
  litCanvas  = makeLayer('#bff5d6', '#2f6a52', 'rgba(220,255,235,.5)', false);
}

function drawSeeds(t){
  const s = ts;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const c = grid[y][x];
    const cx = (x + 0.5) * s, cy = (y + 0.5) * s;
    if (c === '.'){
      ctx.fillStyle = 'rgba(255,226,122,.13)';
      ctx.beginPath(); ctx.arc(cx, cy, s * 0.22, 0, 7); ctx.fill();
      ctx.fillStyle = '#f8dc8c';
      ctx.beginPath(); ctx.arc(cx, cy, s * 0.085, 0, 7); ctx.fill();
    } else if (c === 'o'){
      const pulse = 1 + Math.sin(t * 5 + x) * 0.12;
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 0.75 * pulse);
      halo.addColorStop(0, 'rgba(255,155,84,.55)'); halo.addColorStop(1, 'rgba(255,155,84,0)');
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, s * 0.75 * pulse, 0, 7); ctx.fill();
      ctx.fillStyle = '#ff9b54';
      for (let k = 0; k < 5; k++){
        const a = t * 0.8 + k * Math.PI * 2 / 5;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * s * 0.17 * pulse, cy + Math.sin(a) * s * 0.17 * pulse, s * 0.11, 0, 7); ctx.fill();
      }
      ctx.fillStyle = '#fff2b0'; ctx.beginPath(); ctx.arc(cx, cy, s * 0.1, 0, 7); ctx.fill();
    }
  }
}
function drawFirefly(t){
  const s = ts, p = player;
  const cx = (p.x + 0.5) * s, cy = (p.y + 0.5) * s;
  let scale = 1, glowA = 0.42, spin = 0;
  if (state === 'dying'){
    const k = Math.max(0, stateTimer / 1.7);
    scale = k; spin = (1 - k) * 9; glowA = 0.42 * k * (0.6 + 0.4 * Math.sin(t * 40));
  }
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 1.25 * Math.max(scale, 0.2));
  glow.addColorStop(0, `rgba(255,226,122,${glowA})`); glow.addColorStop(1, 'rgba(255,226,122,0)');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, s * 1.25, 0, 7); ctx.fill();
  if (scale <= 0.02) return;
  const moving = (p.dir.x || p.dir.y) && state === 'play';
  const flap = Math.sin(t * (moving ? 34 : 12)) * 0.45;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.atan2(p.face.y, p.face.x) + spin);
  ctx.scale(scale, scale);
  ctx.fillStyle = 'rgba(205,232,255,.5)';
  for (const side of [-1, 1]){
    ctx.save(); ctx.rotate(side * (0.9 + flap));
    ctx.beginPath(); ctx.ellipse(-s * 0.16, 0, s * 0.26, s * 0.1, 0, 0, 7); ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = '#ffe27a';
  ctx.beginPath(); ctx.ellipse(-s * 0.12, 0, s * 0.24, s * 0.16, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#fff8d6';
  ctx.beginPath(); ctx.ellipse(-s * 0.18, 0, s * 0.11, s * 0.08, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#3b2f22';
  ctx.beginPath(); ctx.arc(s * 0.17, 0, s * 0.12, 0, 7); ctx.fill();
  ctx.strokeStyle = '#3b2f22'; ctx.lineWidth = Math.max(1, s * 0.04); ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(s * 0.24, -s * 0.05); ctx.quadraticCurveTo(s * 0.38, -s * 0.12, s * 0.42, -s * 0.24);
  ctx.moveTo(s * 0.24, s * 0.05);  ctx.quadraticCurveTo(s * 0.38, s * 0.12, s * 0.42, s * 0.24);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(s * 0.22, -s * 0.05, s * 0.03, 0, 7); ctx.arc(s * 0.22, s * 0.05, s * 0.03, 0, 7); ctx.fill();
  ctx.restore();
}
function drawWisp(g, t){
  const s = ts * 0.42;
  const bob = g.state === 'house' ? Math.sin(t * 4 + g.phase) * ts * 0.15 : 0;
  const cx = (g.x + 0.5) * ts, cy = (g.y + 0.5) * ts + bob;
  const eyesOnly = g.state === 'eyes' || g.state === 'entering';
  if (!eyesOnly){
    let col = g.def.color;
    if (g.fright) col = (frightTimer < 2 && Math.floor(t * 8) % 2) ? '#eef3ff' : '#5f7dff';
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, ts * 0.95);
    halo.addColorStop(0, col + '55'); halo.addColorStop(1, col + '00');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, ts * 0.95, 0, 7); ctx.fill();
    const sway = Math.sin(t * 7 + g.phase) * s * 0.3 - g.dir.x * s * 0.25;
    const shake = g.fright ? Math.sin(t * 50) * ts * 0.03 : 0;
    const bx = cx + shake, by = cy + s * 0.25;
    ctx.beginPath();
    ctx.moveTo(bx + sway, cy - s * 1.35);
    ctx.quadraticCurveTo(bx + s * 1.05, cy - s * 0.45, bx + s * 0.95, by);
    ctx.arc(bx, by, s * 0.95, 0, Math.PI, false);
    ctx.quadraticCurveTo(bx - s * 1.05, cy - s * 0.45, bx + sway, cy - s * 1.35);
    ctx.closePath();
    const body = ctx.createLinearGradient(0, cy - s * 1.35, 0, by + s);
    body.addColorStop(0, col + 'aa'); body.addColorStop(0.55, col); body.addColorStop(1, col);
    ctx.fillStyle = body; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.beginPath(); ctx.ellipse(bx, by + s * 0.1, s * 0.45, s * 0.38, 0, 0, 7); ctx.fill();
    if (g.fright){
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(bx - s * 0.32, cy, s * 0.12, 0, 7); ctx.arc(bx + s * 0.32, cy, s * 0.12, 0, 7); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1, s * 0.09);
      ctx.beginPath();
      for (let k = 0; k <= 4; k++){ const xx = bx - s * 0.4 + k * s * 0.2, yy = cy + s * 0.42 + (k % 2 ? -1 : 1) * s * 0.09; k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
      ctx.stroke();
      return;
    }
  }
  const ex = g.dir.x * s * 0.15, ey = g.dir.y * s * 0.15;
  for (const side of [-1, 1]){
    const x0 = cx + side * s * 0.36, y0 = cy + s * 0.05;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(x0, y0, s * 0.26, s * 0.32, 0, 0, 7); ctx.fill();
    ctx.fillStyle = eyesOnly ? '#3d5cff' : '#1a1430';
    ctx.beginPath(); ctx.arc(x0 + ex, y0 + ey, s * 0.14, 0, 7); ctx.fill();
  }
}
function drawText(text, x, y, color, size){
  ctx.font = `${size}px ${FONT_DISPLAY}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 12;
  ctx.fillText(text, x, y); ctx.shadowBlur = 0;
}
function render(t){
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.drawImage(wallCanvas, 0, 0, W * ts, H * ts);
  if (state === 'clear' && Math.floor(t * 6) % 2 === 0) ctx.drawImage(litCanvas, 0, 0, W * ts, H * ts);
  drawSeeds(t);
  const hideWisps = state === 'clear' || (state === 'dying' && stateTimer < 1.3);
  if (!hideWisps) for (const g of ghosts) drawWisp(g, t);
  drawFirefly(t);
  for (const p of popups){
    ctx.globalAlpha = Math.min(1, p.life * 2);
    drawText(p.text, (p.x + 0.5) * ts, (p.y + 0.5 - (1 - p.life) * 0.8) * ts, '#9ff0ff', Math.round(ts * 0.62));
    ctx.globalAlpha = 1;
  }
  if (state === 'ready') drawText(level > 1 ? `${level}번째 밤` : '준비!', 9.5 * ts, 11.5 * ts, '#ffe27a', Math.round(ts * 0.85));
}

function resize(){
  const r = stage.getBoundingClientRect();
  const nts = Math.max(8, Math.min(34, Math.floor(Math.min(r.width / W, r.height / H))));
  const ndpr = Math.min(window.devicePixelRatio || 1, 2);
  // [FIX] ResizeObserver가 크기 변화 없이도 호출될 때 캔버스 3장을 재할당하던 낭비 제거
  if (nts === ts && ndpr === dpr) return;
  ts = nts; dpr = ndpr;
  cv.width = W * ts * dpr; cv.height = H * ts * dpr;
  cv.style.width = board.style.width = W * ts + 'px';
  cv.style.height = board.style.height = H * ts + 'px';
  buildWalls();
}

// ── HUD & overlay ──
// [FIX] 꽃가루 1개마다 innerHTML로 생명 아이콘 DOM 재생성 → 값이 바뀐 항목만 갱신
const hudCache = {};
function setText(el, key, v){ if (hudCache[key] !== v){ hudCache[key] = v; el.textContent = v; } }
function hud(){
  setText($score, 'score', score); setText($best, 'best', best); setText($level, 'level', level);
  setText(pauseBtn, 'pause', state === 'paused' ? '계속' : '멈춤');
  const n = Math.max(0, lives);
  if (hudCache.lives !== n){ hudCache.lives = n; $lives.replaceChildren(...Array.from({length:n}, () => document.createElement('i'))); }
}
const LEGEND = `
  <ul class="legend">
    <li><i class="w0"></i>홍염 <span>뒤를 쫓아요</span></li>
    <li><i class="w1"></i>자운 <span>앞을 막아요</span></li>
    <li><i class="w2"></i>청람 <span>홍염과 협공</span></li>
    <li><i class="w3"></i>도화 <span>가까우면 피해요</span></li>
  </ul>`;
// 템플릿에 들어가는 값은 전부 코드 내부 상수·정수뿐(사용자 입력 없음) → innerHTML 사용이 안전한 범위
function showOverlay(html){ overlay.innerHTML = `<div class="card">${html}</div>`; overlay.hidden = false; overlay.querySelector('button')?.focus({preventScroll:true}); }
function hideOverlay(){ overlay.hidden = true; overlay.replaceChildren(); }
function showTitle(){
  showOverlay(`
    <span class="sub">밤 정원 미로 추격</span>
    <h2>반딧불 미로</h2>
    <p>반딧불이 <b>루미</b>가 되어 정원의 꽃가루를 모두 모으세요. 주황 <b>등불꽃</b>을 먹으면 도깨비불이 잠시 겁을 먹고, 그때는 거꾸로 잡을 수 있어요.</p>
    ${LEGEND}
    <span class="sub">꽃가루 10 · 등불꽃 50 · 도깨비불 200→1600 · 10000점에 빛 +1</span>
    <button type="button" class="primary" data-action="start">시작하기</button>`);
}
function gameOver(){
  state = 'over';
  saveBest(); hud();
  showOverlay(`
    <span class="sub">${level}번째 밤에서 빛이 꺼졌어요</span>
    <h2>게임 끝</h2>
    <div class="big">${score.toLocaleString()}</div>
    <span class="sub">최고 기록 ${best.toLocaleString()}</span>
    <button type="button" class="primary" data-action="start">다시 하기</button>`);
}
function startGame(){
  audio.unlock();
  score = 0; lives = 3; level = 1; extraGiven = false;
  newLevel(); hideOverlay(); hud();
}
function togglePause(){
  if (state === 'paused'){ state = prevState; hideOverlay(); }
  else if (state === 'play' || state === 'ready'){
    prevState = state; state = 'paused'; saveBest();
    showOverlay(`<h2>잠시 멈춤</h2><p>정원이 조용히 기다리고 있어요.</p><button type="button" class="primary" data-action="resume">계속하기</button>`);
  }
  hud();
}
overlay.addEventListener('click', e => {
  const a = e.target.closest('[data-action]'); if (!a) return;
  if (a.dataset.action === 'start') startGame();
  if (a.dataset.action === 'resume') togglePause();
});

// ── Input ──
const KEYS = { ArrowUp:'up', KeyW:'up', ArrowDown:'down', KeyS:'down', ArrowLeft:'left', KeyA:'left', ArrowRight:'right', KeyD:'right' };
function setDir(name){ if (player) player.next = DIRS[name]; }
window.addEventListener('keydown', e => {
  if (e.repeat && !KEYS[e.code]) return;   // [FIX] P/Enter 꾹 누르면 멈춤·재시작이 연타되던 문제
  if (KEYS[e.code]){ e.preventDefault(); setDir(KEYS[e.code]); return; }
  if (e.code === 'KeyP' || e.code === 'Escape'){ e.preventDefault(); togglePause(); return; }
  if ((e.code === 'Enter' || e.code === 'Space') && (state === 'title' || state === 'over')){ e.preventDefault(); startGame(); }
});
let touchStart = null;
cv.addEventListener('pointerdown', e => { touchStart = {x:e.clientX, y:e.clientY}; cv.setPointerCapture?.(e.pointerId); });
cv.addEventListener('pointermove', e => {
  if (!touchStart) return;
  const dx = e.clientX - touchStart.x, dy = e.clientY - touchStart.y;
  if (Math.hypot(dx, dy) < 18) return;
  setDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  touchStart = {x:e.clientX, y:e.clientY};
});
// [FIX] pointercancel(스크롤 제스처·알림 등으로 터치 취소) 시 touchStart가 남아 다음 터치가 오작동하던 문제
const endTouch = () => { touchStart = null; };
window.addEventListener('pointerup', endTouch);
window.addEventListener('pointercancel', endTouch);
$('pad').addEventListener('pointerdown', e => {
  const b = e.target.closest('[data-d]'); if (!b) return;
  e.preventDefault(); audio.unlock(); setDir(b.dataset.d);
});
pauseBtn.addEventListener('click', () => { togglePause(); pauseBtn.blur(); });
// [FIX] 같은 버튼에 click 리스너 2개 등록되던 것 통합 + 음소거 설정 유지
function applyMute(m){
  audio.muted = m;
  muteBtn.textContent = m ? '소리 끔' : '소리 켬';
  muteBtn.setAttribute('aria-pressed', String(m));
}
muteBtn.addEventListener('click', () => {
  applyMute(!audio.muted); store.set(STORE_MUTE, audio.muted ? '1' : '0');
  if (!audio.muted) audio.unlock();
  muteBtn.blur();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  saveBest();
  if (state === 'play' || state === 'ready') togglePause();
});
window.addEventListener('pagehide', saveBest);   // [FIX] 탭을 닫을 때 최고 기록 유실 방지

// ── Sound ──
const audio = {
  ctx:null, muted:false, flip:false,
  unlock(){
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch {}
  },
  tone(freq, dur, type = 'square', vol = 0.04, slideTo = 0, delay = 0){
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;   // [FIX] suspended 상태에서 노드만 쌓이던 문제
    const c = this.ctx, now = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, now);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, now + dur);
    g.gain.setValueAtTime(vol, now); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g); g.connect(c.destination); o.start(now); o.stop(now + dur + 0.02);
    o.onended = () => { o.disconnect(); g.disconnect(); };   // [FIX] 오디오 그래프 노드 누수 방지
  },
};
const sfx = {
  seed(){ audio.flip = !audio.flip; audio.tone(audio.flip ? 988 : 1319, 0.05, 'triangle', 0.035); },
  lantern(){ audio.tone(330, 0.35, 'sine', 0.07, 990); },
  eatWisp(){ audio.tone(520, 0.28, 'square', 0.04, 1560); },
  die(){ audio.tone(760, 1.3, 'sawtooth', 0.035, 70); },
  clear(){ [523, 659, 784, 1047].forEach((f, i) => audio.tone(f, 0.18, 'triangle', 0.05, 0, i * 0.12)); },
  extra(){ [784, 988, 1175].forEach((f, i) => audio.tone(f, 0.12, 'square', 0.035, 0, i * 0.08)); },
};

// ── Boot ──
applyMute(store.get(STORE_MUTE) === '1');
parseMap(); resize(); resetActors(); state = 'title'; hud(); showTitle();
new ResizeObserver(resize).observe(stage);
let last = performance.now();
function frame(now){
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;   // [FIX] 음수 dt 방어
  update(dt); render(now / 1000);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
})();
