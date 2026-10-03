# Chess AI for PewPlay

This directory contains the original static game adapted for the PewPlay game template. Open `index.html` to play.

`game.json` holds the game page text. `preview.png` and `cover.png` provide the page images. The PewPlay workflow checks pushes to `preview` and `main`. The game remains a draft until you remove `"draft": true` after reviewing it.

Game controls: Select a piece, then select its destination square to play against the computer. Use the on-screen options to adjust the view or AI speed.

## Update (second pass)
- Rewrote the game around a new, verified rules engine (`engine.js`, perft-tested): full castling rules, en passant, promotion choice, checkmate/stalemate and draw detection (repetition, fifty-move rule, insufficient material).
- Computer opponent: Random (original behaviour) plus Easy, Medium and Hard levels; the search runs in a Web Worker (Blob) so the UI never freezes, with a short main-thread fallback.
- Responsive layout: the board is as large as the screen allows, with a side panel in landscape and a bottom panel in portrait; options move to a pop-up sheet when space is short.
- Touch: tap-to-select + tap-to-move and drag-and-drop with Pointer Events; legal-move dots/rings, last-move and check highlights.
- In-page status, promotion picker and game-over card (the old `alert()` is gone), Undo, New game, Flip, move list, captured pieces.
- Game and options saved in `chess-ai:game` / `chess-ai:settings` (no previous keys to migrate).
- Removed the normalize.css CDN link; new cover and screenshots. `script.js` is excluded owner material and left untouched.
