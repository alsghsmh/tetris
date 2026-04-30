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
let acceleratedDropping = false;
let dropToken = 0;
let fastDropping = false;
let fastDropCounter = 0;
let fastDropDelay = 54;
let bgmTimer = null;
let bgmStep = 0;
let musicGain = null;

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
  if (!running || paused || !canHold || acceleratedDropping) return;
  beep(260, 0.05, "triangle", 0.07);
  beep(520, 0.05, "sine", 0.045);
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

function acceleratedDrop() {
  if (!running || paused || acceleratedDropping) return;
  acceleratedDropping = true;
  const token = ++dropToken;
  let distance = 0;
  let delay = 86;
  beep(120, 0.08, "sawtooth", 0.075);

  const step = () => {
    if (token !== dropToken) return;
    if (!running || paused) {
      acceleratedDropping = false;
      return;
    }

    if (!collides({ ...piece, y: piece.y + 1 })) {
      piece.y++;
      distance++;
      score += 2;
      updateHud();
      beep(150 + Math.min(distance, 14) * 22, 0.018, "square", 0.018);
      delay = Math.max(18, delay * 0.78);
      setTimeout(step, delay);
      return;
    }

    acceleratedDropping = false;
    if (distance > 0) {
      burstLanding();
      beep(85, 0.09, "sawtooth", 0.07);
    }
    lockPiece();
  };

  step();
}

function startFastDrop() {
  if (!running || paused || acceleratedDropping || fastDropping) return;
  fastDropping = true;
  fastDropCounter = 0;
  fastDropDelay = 54;
  beep(180, 0.035, "sawtooth", 0.045);
}

function stopFastDrop() {
  fastDropping = false;
  fastDropCounter = 0;
  fastDropDelay = 54;
}

function softDrop() {
  if (!running || paused || acceleratedDropping) return;
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
  if (!running || paused || acceleratedDropping) return;
  const moved = { ...piece, x: piece.x + dir };
  if (!collides(moved)) {
    piece.x += dir;
    beep(dir < 0 ? 190 : 235, 0.026, "square", 0.032);
  }
}

function turn() {
  if (!running || paused || acceleratedDropping) return;
  const rotated = { ...piece, matrix: rotate(piece.matrix) };
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    rotated.x = piece.x + kick;
    if (!collides(rotated)) {
      piece.matrix = rotated.matrix;
      piece.x = rotated.x;
      beep(610, 0.038, "triangle", 0.055);
      beep(820, 0.03, "sine", 0.028);
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

function burstLanding() {
  piece.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (!value) return;
      const px = (piece.x + x) * BLOCK + BLOCK / 2;
      const py = (piece.y + y) * BLOCK + BLOCK / 2;
      for (let i = 0; i < 4; i++) {
        particles.push({
          x: px,
          y: py,
          vx: (Math.random() - 0.5) * 4,
          vy: Math.random() * -3,
          life: 18 + Math.random() * 10,
          color: COLORS[piece.type],
          size: 2 + Math.random() * 3,
        });
      }
    });
  });
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
    if (fastDropping) {
      fastDropCounter += delta;
      fastDropDelay = Math.max(22, fastDropDelay - delta * 0.045);
      while (fastDropCounter > fastDropDelay) {
        softDrop();
        fastDropCounter -= fastDropDelay;
        beep(120 + Math.random() * 80, 0.012, "square", 0.012);
      }
      dropCounter = 0;
    }
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

function musicTone(freq, duration, type = "triangle", volume = 0.04) {
  if (!audioCtx || !musicGain) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const now = audioCtx.currentTime;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.connect(gain).connect(musicGain);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

function musicKick() {
  if (!audioCtx || !musicGain) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const now = audioCtx.currentTime;
  osc.type = "sine";
  osc.frequency.setValueAtTime(118, now);
  osc.frequency.exponentialRampToValueAtTime(42, now + 0.09);
  gain.gain.setValueAtTime(0.2, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
  osc.connect(gain).connect(musicGain);
  osc.start(now);
  osc.stop(now + 0.12);
}

function musicHat() {
  musicTone(2100 + Math.random() * 700, 0.018, "square", 0.045);
}

function startBgm() {
  stopBgm();
  if (!audioCtx) return;
  musicGain = audioCtx.createGain();
  musicGain.gain.setValueAtTime(0.72, audioCtx.currentTime);
  musicGain.connect(audioCtx.destination);
  bgmStep = 0;
  musicKick();
  musicTone(659.25, 0.12, "square", 0.14);
  musicTone(329.63, 0.18, "sawtooth", 0.12);
  playBgmStep();
}

function stopBgm() {
  clearTimeout(bgmTimer);
  bgmTimer = null;
  if (musicGain && audioCtx) {
    const gainToStop = musicGain;
    musicGain = null;
    gainToStop.gain.cancelScheduledValues(audioCtx.currentTime);
    gainToStop.gain.setTargetAtTime(0.001, audioCtx.currentTime, 0.08);
    setTimeout(() => {
      gainToStop.disconnect();
    }, 220);
  }
}

function playBgmStep() {
  if (!running || !audioCtx) return;
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
    bgmTimer = setTimeout(playBgmStep, 120);
    return;
  }
  if (paused) {
    bgmTimer = setTimeout(playBgmStep, 180);
    return;
  }

  const lead = [659.25, 0, 783.99, 659.25, 987.77, 880, 783.99, 0, 587.33, 659.25, 783.99, 880, 783.99, 659.25, 587.33, 523.25];
  const counter = [329.63, 392, 493.88, 392, 329.63, 293.66, 329.63, 0, 440, 493.88, 523.25, 493.88, 440, 392, 329.63, 0];
  const bass = [82.41, 82.41, 98, 98, 110, 110, 73.42, 73.42];
  const step = bgmStep % 16;
  if (lead[step]) musicTone(lead[step], 0.13, step % 4 === 0 ? "square" : "triangle", 0.12);
  if (counter[step] && step % 2 === 1) musicTone(counter[step], 0.1, "triangle", 0.055);
  if (step % 2 === 0) musicTone(bass[(bgmStep / 2) % bass.length | 0], 0.22, "sawtooth", 0.115);
  if (step % 4 === 0) musicKick();
  if (step % 2 === 1) musicHat();
  bgmStep++;
  bgmTimer = setTimeout(playBgmStep, Math.max(86, 132 - level * 3));
}

function unlockAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") return audioCtx.resume().catch(() => {});
  return Promise.resolve();
}

function newGame() {
  unlockAudio().then(() => {
    if (running) startBgm();
  });
  dropToken++;
  acceleratedDropping = false;
  stopFastDrop();
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
  beep(990, 0.06, "sine", 0.045);
}

function gameOver() {
  dropToken++;
  acceleratedDropping = false;
  stopFastDrop();
  running = false;
  stopBgm();
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

const startBtn = document.querySelector("#startBtn");
startBtn.addEventListener("pointerdown", unlockAudio);
startBtn.addEventListener("click", newGame);
document.querySelector("#rotateBtn").addEventListener("click", turn);
document.querySelector("#holdBtn").addEventListener("click", hold);
bindHoldButton(document.querySelector("#leftBtn"), () => move(-1));
bindHoldButton(document.querySelector("#rightBtn"), () => move(1));
const dropBtn = document.querySelector("#dropBtn");
dropBtn.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  startFastDrop();
});
dropBtn.addEventListener("pointerup", stopFastDrop);
dropBtn.addEventListener("pointercancel", stopFastDrop);
dropBtn.addEventListener("pointerleave", stopFastDrop);

document.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") move(-1);
  if (event.key === "ArrowRight") move(1);
  if (event.key === "ArrowUp") turn();
  if (event.key === "ArrowDown") softDrop();
  if (event.code === "Space") {
    event.preventDefault();
    startFastDrop();
  }
  if (event.key.toLowerCase() === "c") hold();
  if (event.key.toLowerCase() === "p") paused = !paused;
});
document.addEventListener("keyup", (event) => {
  if (event.code === "Space") stopFastDrop();
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
  else if (dy > 48) {
    startFastDrop();
    setTimeout(stopFastDrop, 260);
  }
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
