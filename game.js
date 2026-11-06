'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#7986cb', // J - indigo
  '#ffb74d', // L - orange
  '#90a4ae', // N - tuerca (gris metálico)
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // N - tuerca
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
const pauseMenu = document.getElementById('pause-menu');
const resumeBtn = document.getElementById('pause-resume-btn');
const pauseRestartBtn = document.getElementById('pause-restart-btn');
const startLevelSel = document.getElementById('start-level');
const controlsBtn = document.getElementById('pause-controls-btn');
const pauseControls = document.getElementById('pause-controls');
let startLevel = 1; // nivel inicial elegido en el menú de pausa (se aplica en init)
let fx = { rows: [], particles: [], bolts: [], shake: 0, flash: 0, last: 0 };

// ---------- Sonido (Web Audio, sin archivos externos) ----------
let audioCtx = null;
function getAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function tone(freq, start, dur, type, vol, endFreq) {
  const a = getAudio(); if (!a) return;
  const t = a.currentTime + start;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + dur);
}

function noise(start, dur, vol, cutoff) {
  const a = getAudio(); if (!a) return;
  const t = a.currentTime + start;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = 'lowpass';
  f.frequency.setValueAtTime(cutoff, t);
  f.frequency.exponentialRampToValueAtTime(80, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

function playLineSound(n) {
  if (n >= 4) {
    // Rayo: chasquido agudo + trueno grave
    tone(1800, 0, 0.25, 'sawtooth', 0.25, 60);
    noise(0, 1.1, 0.7, 6000);
    tone(70, 0.05, 0.9, 'sawtooth', 0.35, 30);
    return;
  }
  const notes = [523, 659, 784, 1047];
  for (let i = 0; i <= n; i++) tone(notes[i], i * 0.07, 0.18, 'square', 0.12);
}

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * (PIECES.length - 1)) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  const fullRows = [];
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      fullRows.push({ row: r, cells: [...board[r]] });
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.max(startLevel, Math.floor(lines / 10) + 1);
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
    startLineEffect(fullRows);
  }
}

// ---------- Efectos visuales ----------
function startLineEffect(fullRows) {
  const big = fullRows.length >= 4;
  const now = performance.now();
  fx.last = now;
  for (const { row, cells } of fullRows) {
    fx.rows.push({ row, cells, t0: now, dur: big ? 900 : 350, big, gone: cells.map(() => Math.random()) });
    for (let c = 0; c < COLS; c++) {
      const n = big ? 5 : 2;
      for (let i = 0; i < n; i++) {
        fx.particles.push({
          x: c * BLOCK + Math.random() * BLOCK,
          y: row * BLOCK + Math.random() * BLOCK,
          vx: (Math.random() - 0.5) * (big ? 260 : 160),
          vy: (Math.random() - (big ? 0.8 : 0.6)) * (big ? 260 : 200),
          life: 0, max: (big ? 700 : 450) + Math.random() * 300,
          size: 2 + Math.random() * 3,
          color: big ? (Math.random() < 0.5 ? '#9e9e9e' : '#e0e0e0') : COLORS[cells[c]],
          grav: big ? -60 : 500,
        });
      }
    }
  }
  if (big) {
    for (const { row } of fullRows) fx.bolts.push(makeBolt(row));
    fx.shake = 1;
    fx.flash = 1;
  }
  playLineSound(fullRows.length);
}

function makeBolt(row) {
  const pts = [];
  let x = Math.random() * COLS * BLOCK;
  const ty = row * BLOCK + BLOCK / 2;
  for (let y = 0; y < ty; y += 18) {
    pts.push([x, y]);
    x += (Math.random() - 0.5) * 50;
  }
  pts.push([x, ty]);
  // ramal horizontal por la línea
  const branch = [[x, ty]];
  let bx = x;
  const dir = x < COLS * BLOCK / 2 ? 1 : -1;
  while (bx > 0 && bx < COLS * BLOCK) {
    bx += dir * 16;
    branch.push([bx, ty + (Math.random() - 0.5) * 16]);
  }
  return { pts, branch, t0: performance.now(), dur: 450 };
}

function drawEffects() {
  const now = performance.now();
  const dt = Math.min(50, now - fx.last) / 1000;
  fx.last = now;

  // filas que destellan / se desintegran
  fx.rows = fx.rows.filter(f => now - f.t0 < f.dur);
  for (const f of fx.rows) {
    const p = (now - f.t0) / f.dur;
    for (let c = 0; c < COLS; c++) {
      if (f.big) {
        if (p > f.gone[c] * 0.8) continue; // celda desintegrada
        drawBlock(ctx, c, f.row, f.cells[c], BLOCK, 1 - p * 0.5);
        ctx.fillStyle = `rgba(255,255,255,${0.9 * (1 - p)})`;
        ctx.fillRect(c * BLOCK, f.row * BLOCK, BLOCK, BLOCK);
      } else {
        ctx.fillStyle = `rgba(255,255,255,${0.85 * (1 - p)})`;
        ctx.fillRect(c * BLOCK, f.row * BLOCK, BLOCK, BLOCK);
      }
    }
  }

  // partículas
  fx.particles = fx.particles.filter(q => q.life < q.max);
  for (const q of fx.particles) {
    q.life += dt * 1000;
    q.vy += q.grav * dt;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    ctx.globalAlpha = Math.max(0, 1 - q.life / q.max);
    ctx.fillStyle = q.color;
    ctx.fillRect(q.x, q.y, q.size, q.size);
  }
  ctx.globalAlpha = 1;

  // rayos
  fx.bolts = fx.bolts.filter(b => now - b.t0 < b.dur);
  for (const b of fx.bolts) {
    const p = (now - b.t0) / b.dur;
    if (Math.random() < 0.25) continue; // parpadeo
    ctx.save();
    ctx.globalAlpha = 1 - p;
    ctx.shadowColor = '#80d8ff';
    ctx.shadowBlur = 18;
    ctx.lineJoin = 'round';
    for (const [w, col] of [[6, '#4fc3f7'], [2, '#ffffff']]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      for (const path of [b.pts, b.branch]) {
        ctx.beginPath();
        path.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // destello de pantalla y temblor
  if (fx.flash > 0) {
    ctx.fillStyle = `rgba(200,230,255,${fx.flash * 0.45})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    fx.flash = Math.max(0, fx.flash - dt * 3);
  }
  if (fx.shake > 0) fx.shake = Math.max(0, fx.shake - dt * 1.8);
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = '#22222e';
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (fx.shake > 0) ctx.translate((Math.random() - 0.5) * 12 * fx.shake, (Math.random() - 0.5) * 12 * fx.shake);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);

  drawEffects();
  ctx.restore();
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

// ---------- Menú de pausa ----------
function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    pauseMenu.classList.add('hidden');
    // quitar el foco para que Space/Enter no activen un botón tras reanudar
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    lastTime = performance.now();
    dropAccum = 0;
    cancelAnimationFrame(animId);
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    pauseMenu.classList.remove('hidden');
    resumeBtn.focus();
  }
}

function restartFromMenu() {
  if (document.activeElement) document.activeElement.blur();
  init();
}

resumeBtn.addEventListener('click', togglePause);
pauseRestartBtn.addEventListener('click', restartFromMenu);
// El selector solo se lee en init(): cambiarlo no afecta a la partida en curso.
function readStartLevel() {
  return Math.min(10, Math.max(1, parseInt(startLevelSel.value, 10) || 1));
}
controlsBtn.addEventListener('click', () => {
  const open = pauseControls.classList.toggle('hidden') === false;
  controlsBtn.setAttribute('aria-expanded', String(open));
});

function loop(ts) {
  if (gameOver || paused) return;
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  if (gameOver) return;
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  fx = { rows: [], particles: [], bolts: [], shake: 0, flash: 0, last: performance.now() };
  score = 0;
  lines = 0;
  startLevel = readStartLevel();
  level = startLevel;
  paused = false;
  gameOver = false;
  dropInterval = Math.max(100, 1000 - (level - 1) * 90);
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  pauseMenu.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  getAudio(); // el navegador exige un gesto del usuario para activar el audio
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (e.target === startLevelSel) return; // Esc cierra el desplegable sin reanudar
    if (!e.repeat) togglePause();
    return;
  }
  if (paused || gameOver) return; // con el menú abierto no se procesan teclas de juego
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

init();
