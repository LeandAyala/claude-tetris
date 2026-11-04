# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vanilla JS Tetris (HTML5 Canvas + CSS). No `package.json`, no build, no linter, no tests. The README is in Spanish, as are the UI strings (`PAUSA`, `Puntuación`, `Reiniciar`) — keep new user-facing text in Spanish.

## Running

Open `index.html` directly, or serve the folder statically (e.g. `python -m http.server 8000`) and visit `http://localhost:8000`. Verify changes manually in the browser.

## Architecture

Three files: `index.html` (DOM, two canvases, overlay), `style.css` (dark theme), and `game.js` (all logic, a single script loaded as a classic `<script>`, `'use strict'`, global state).

Key points in `game.js` that span multiple functions:

- **State is module-level `let` variables** (`board`, `current`, `next`, `score`, `lines`, `level`, `paused`, `gameOver`, `dropInterval`, `animId`, ...), all reset in `init()`. Restart is just `init()` again.
- **Board cells and pieces share one encoding**: `0` is empty, `1–7` is a piece type that indexes both `COLORS` and `PIECES`. Pieces are square matrices; rotation is `rotateCW` (transpose + reverse), applied with horizontal-only wall kicks `[0,-1,1,-2,2]` in `tryRotate`.
- **Piece lifecycle**: `randomPiece` → `spawn` (promotes `next` to `current`, calls `endGame` if it collides immediately) → moves → `lockPiece` = `merge` + `clearLines` + `spawn`. `lockPiece` is reached from three places: the gravity tick in `loop`, `softDrop` when blocked, and `hardDrop`.
- **Game loop** (`loop`) uses `requestAnimationFrame` and a `dropAccum` time accumulator against `dropInterval`. Pause and game over stop it with `cancelAnimationFrame(animId)`; unpausing restarts it by calling `loop` directly after resetting `lastTime`. Anything that stops or restarts the loop must keep `animId` consistent.
- **Scoring/levels** live in `clearLines`: `LINE_SCORES[cleared] * level`; level = `floor(lines/10)+1`; `dropInterval = max(100, 1000 - (level-1)*90)`. Soft drop gives 1 point per row, hard drop 2 per row.
- **Canvas size is hardcoded in `index.html`** (`300×600` for the board = `COLS*BLOCK` × `ROWS*BLOCK`, `120×120` for the next-piece preview, which `drawNext` renders in a 4×4 grid at 30px). Changing `COLS`, `ROWS`, or `BLOCK` in `game.js` requires updating the canvas attributes too.
