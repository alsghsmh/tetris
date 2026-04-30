const COLS = 10;
const ROWS = 20;
const BLOCK = 30;
const COLORS = {
  I: "#00e7ff",
  O: "#ffe45c",
  T: "#b15cff",
  S: "#46ff77",
  Z: "#ff3c6d",
  J: "#4f8cff",
  L: "#ff9d2e",
};

const SHAPES = {
  I: [[1, 1, 1, 1]],
  O: [
    [1, 1],
    [1, 1],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
  ],
};

const boardCanvas = document.querySelector("#board");
const fxCanvas = document.querySelector("#fx");
const nextCanvas = document.querySelector("#next");
const holdCanvas = document.querySelector("#hold");
const ctx = boardCanvas.getContext("2d");
const fx = fxCanvas.getContext("2d");
const nextCtx = nextCanvas.getContext("2d");
const holdCtx = holdCanvas.getContext("2d");

const scoreEl = document.querySelector("#score");
const levelEl = document.querySelector("#level");
const comboEl = document.querySelector("#combo");
const toast = document.querySelector("#toast");
const shell = document.querySelector(".game-shell");

let grid;
let piece;
let nextPiece;
let heldPiece = null;
let canHold = true;
let score = 0;
let level = 1;
let lines = 0;
let combo = 0;
let running = false;
let paused = false;
let lastTime = 0;
let dropCounter = 0;
let particles = [];
let audioCtx = null;

function emptyGrid() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function randPiece() {
  const keys = Object.keys(SHAPES);
  const type = keys[(Math.random() * keys.length) | 0];
  return {
    type,
    matrix: SHAPES[type].map((row) => [...row]),
    x: Math.floor(COLS / 2) - Math.ceil(SHAPES[type][0].length / 2),
    y: 0,
  };
}

function clonePiece(source) {
  return {
    type: source.type,
    matrix: SHAPES[source.type].map((row) => [...row]),
    x: Math.floor(COLS / 2) - Math.ceil(SHAPES[source.type][0].length / 2),
    y: 0,
  };
}

function rotate(matrix) {
  return matrix[0].map((_, i) => matrix.map((row) => row[i]).reverse());
}

function collides(testPiece) {
  for (let y = 0; y < testPiece.matrix.length; y++) {
    for (let x = 0; x < testPiece.matrix[y].length; x++) {
      if (!testPiece.matrix[y][x]) continue;
      const bx = testPiece.x + x;
      const by = testPiece.y + y;
      if (bx < 0 || bx >= COLS || by >= ROWS || (by >= 0 && grid[by][bx])) return true;
    }
  }
  return false;
}

function merge() {
  piece.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value) grid[piece.y + y][piece.x + x] = piece.type;
    });
  });
}

function clearLines() {
  let cleared = 0;
  for (let y = ROWS - 1; y >= 0; y--) {
    if (grid[y].every(Boolean)) {
      burstLine(y);
      grid.splice(y, 1);
      grid.unshift(Array(COLS).fill(null));
      cleared++;
      y++;
    }
  }
  if (!cleared) {
    combo = 0;
    return;
  }

  combo++;
  lines += cleared;
  level = Math.floor(lines / 8) + 1;
  const base = [0, 100, 320, 520, 900][cleared] * level;
  score += base + combo * 45;
  showToast(cleared === 4 ? "TETRIS!" : `${cleared} LINE${cleared > 1 ? "S" : ""}`);
  beep([320, 480, 640, 880][cleared - 1], 0.11, "triangle", 0.09);
  shell.classList.add("shake");
  setTimeout(() => shell.classList.remove("shake"), 190);
}

function spawn() {
  piece = nextPiece || randPiece();
  nextPiece = randPiece();
  canHold = true;
  if (collides(piece)) gameOver();
}

function hold() {
  if (!running || paused || !canHold) return;
  beep(250, 0.06, "sine", 0.06);
  const current = piece.type;
  if (!heldPiece) {
    heldPiece = clonePiece(piece);
    spawn();
  } else {
    piece = clonePiece(heldPiece);
    heldPiece = { type: current };
    if (collides(piece)) gameOver();
  }
  canHold = false;
}

function hardDrop() {
  if (!running || paused) return;
  let distance = 0;
  while (!collides({ ...piece, y: piece.y + 1 })) {
    piece.y++;
    distance++;
  }
  score += distance * 2;
  beep(90, 0.08, "sawtooth", 0.07);
  lockPiece();
}

function softDrop() {
  if (!running || paused) return;
  if (!collides({ ...piece, y: piece.y + 1 })) {
    piece.y++;
    score += 1;
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
  updateHud();
}

function move(dir) {
  if (!running || paused) return;
  const moved = { ...piece, x: piece.x + dir };
  if (!collides(moved)) {
    piece.x += dir;
    beep(180 + dir * 20, 0.025, "square", 0.025);
  }
}

function turn() {
  if (!running || paused) return;
  const rotated = { ...piece, matrix: rotate(piece.matrix) };
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    rotated.x = piece.x + kick;
    if (!collides(rotated)) {
      piece.matrix = rotated.matrix;
      piece.x = rotated.x;
      beep(520, 0.04, "triangle", 0.05);
      return;
    }
  }
}

function drawCell(target, x, y, size, color, alpha = 1) {
  target.save();
  target.globalAlpha = alpha;
  const px = x * size;
  const py = y * size;
  const grad = target.createLinearGradient(px, py, px + size, py + size);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.16, color);
  grad.addColorStop(1, "#060718");
  target.fillStyle = grad;
  target.shadowColor = color;
  target.shadowBlur = 12;
  target.fillRect(px + 2, py + 2, size - 4, size - 4);
  target.strokeStyle = "rgba(255,255,255,0.42)";
  target.lineWidth = 1;
  target.strokeRect(px + 3.5, py + 3.5, size - 7, size - 7);
  target.restore();
}

function drawGrid() {
  ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
  ctx.fillStyle = "#070918";
  ctx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
  ctx.strokeStyle = "rgba(255,255,255,0.055)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= COLS; x++) {
    ctx.beginPath();
    ctx.moveTo(x * BLOCK + 0.5, 0);
    ctx.lineTo(x * BLOCK + 0.5, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let y = 0; y <= ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * BLOCK + 0.5);
    ctx.lineTo(COLS * BLOCK, y * BLOCK + 0.5);
    ctx.stroke();
  }

  grid.forEach((row, y) => {
    row.forEach((type, x) => {
      if (type) drawCell(ctx, x, y, BLOCK, COLORS[type]);
    });
  });

  drawGhost();
  drawPiece(ctx, piece, BLOCK);
}

function drawPiece(target, targetPiece, size) {
  if (!targetPiece) return;
  targetPiece.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value) drawCell(target, targetPiece.x + x, targetPiece.y + y, size, COLORS[targetPiece.type]);
    });
  });
}

function drawGhost() {
  let ghostY = piece.y;
  while (!collides({ ...piece, y: ghostY + 1 })) ghostY++;
  piece.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value) drawCell(ctx, piece.x + x, ghostY + y, BLOCK, COLORS[piece.type], 0.22);
    });
  });
}

function drawMini(target, targetPiece) {
  target.clearRect(0, 0, 92, 92);
  if (!targetPiece) return;
  const matrix = SHAPES[targetPiece.type];
  const size = matrix.length > 2 || matrix[0].length > 3 ? 18 : 22;
  const offsetX = (92 - matrix[0].length * size) / 2;
  const offsetY = (92 - matrix.length * size) / 2;
  const miniPiece = { type: targetPiece.type, matrix, x: offsetX / size, y: offsetY / size };
  drawPiece(target, miniPiece, size);
}

function burstLine(line) {
  for (let i = 0; i < 34; i++) {
    particles.push({
      x: Math.random() * boardCanvas.width,
      y: line * BLOCK + BLOCK / 2,
      vx: (Math.random() - 0.5) * 7,
      vy: (Math.random() - 0.5) * 6 - 2,
      life: 34 + Math.random() * 16,
      color: Object.values(COLORS)[(Math.random() * 7) | 0],
      size: 2 + Math.random() * 5,
    });
  }
}

function drawFx() {
  fx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
  particles = particles.filter((p) => p.life > 0);
  particles.forEach((p) => {
    p.life--;
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.12;
    fx.save();
    fx.globalAlpha = Math.max(p.life / 48, 0);
    fx.shadowColor = p.color;
    fx.shadowBlur = 14;
    fx.fillStyle = p.color;
    fx.fillRect(p.x, p.y, p.size, p.size);
    fx.restore();
  });
}

function update(time = 0) {
  const delta = time - lastTime;
  lastTime = time;
  if (running && !paused) {
    dropCounter += delta;
    if (dropCounter > Math.max(120, 820 - level * 58)) {
      softDrop();
      dropCounter = 0;
    }
  }
  drawGrid();
  drawMini(nextCtx, nextPiece);
  drawMini(holdCtx, heldPiece);
  drawFx();
  requestAnimationFrame(update);
}

function updateHud() {
  scoreEl.textContent = score.toLocaleString("ko-KR");
  levelEl.textContent = level;
  comboEl.textContent = combo;
}

function showToast(text) {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 650);
}

function beep(freq, duration, type = "sine", volume = 0.05) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function unlockAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function newGame() {
  unlockAudio();
  grid = emptyGrid();
  piece = null;
  nextPiece = randPiece();
  heldPiece = null;
  canHold = true;
  score = 0;
  level = 1;
  lines = 0;
  combo = 0;
  running = true;
  paused = false;
  spawn();
  updateHud();
  showToast("GO!");
  beep(660, 0.08, "triangle", 0.08);
}

function gameOver() {
  running = false;
  showToast("GAME OVER");
  beep(120, 0.35, "sawtooth", 0.08);
}

function bindHoldButton(button, onPress) {
  let timer = null;
  let repeat = null;
  const stop = () => {
    clearTimeout(timer);
    clearInterval(repeat);
  };
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    onPress();
    timer = setTimeout(() => {
      repeat = setInterval(onPress, 82);
    }, 210);
  });
  button.addEventListener("pointerup", stop);
  button.addEventListener("pointercancel", stop);
  button.addEventListener("pointerleave", stop);
}

document.querySelector("#startBtn").addEventListener("click", newGame);
document.querySelector("#rotateBtn").addEventListener("click", turn);
document.querySelector("#dropBtn").addEventListener("click", hardDrop);
document.querySelector("#holdBtn").addEventListener("click", hold);
bindHoldButton(document.querySelector("#leftBtn"), () => move(-1));
bindHoldButton(document.querySelector("#rightBtn"), () => move(1));

document.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") move(-1);
  if (event.key === "ArrowRight") move(1);
  if (event.key === "ArrowUp") turn();
  if (event.key === "ArrowDown") softDrop();
  if (event.code === "Space") hardDrop();
  if (event.key.toLowerCase() === "c") hold();
  if (event.key.toLowerCase() === "p") paused = !paused;
});

let touchStart = null;
boardCanvas.addEventListener("pointerdown", (event) => {
  touchStart = { x: event.clientX, y: event.clientY, t: performance.now() };
});
boardCanvas.addEventListener("pointerup", (event) => {
  if (!touchStart) return;
  const dx = event.clientX - touchStart.x;
  const dy = event.clientY - touchStart.y;
  if (Math.abs(dx) < 18 && Math.abs(dy) < 18) turn();
  else if (dy > 48) hardDrop();
  else if (dx > 34) move(1);
  else if (dx < -34) move(-1);
  touchStart = null;
});

grid = emptyGrid();
nextPiece = randPiece();
spawn();
running = false;
updateHud();
showToast("READY");
requestAnimationFrame(update);
