/* Chess AI - board, controls and computer opponent (UI side). */
(function () {
  "use strict";
  var E = createChessEngine();
  var Position = E.Position;
  var STORE = "chess-ai:";
  var NAMES = ["", "pawn", "knight", "bishop", "rook", "queen", "king"];
  var START_COUNTS = [0, 8, 2, 2, 2, 1, 1];

  // ---------- Storage ----------
  function load(key, fallback) {
    try {
      var v = window.localStorage.getItem(STORE + key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { window.localStorage.setItem(STORE + key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  }

  var DEFAULTS = { mode: "white", level: "easy", speed: "2", hints: "on", flip: false };
  var ALLOWED = {
    mode: ["white", "black", "both", "watch"],
    level: ["random", "easy", "medium", "hard"],
    speed: ["1", "2", "4", "20"],
    hints: ["on", "off"]
  };
  var settings = Object.assign({}, DEFAULTS, load("settings", {}));
  Object.keys(ALLOWED).forEach(function (k) { if (ALLOWED[k].indexOf(settings[k]) < 0) settings[k] = DEFAULTS[k]; });
  settings.flip = !!settings.flip;

  // ---------- DOM ----------
  function $(id) { return document.getElementById(id); }
  var app = $("app"), boardEl = $("board"), squaresEl = $("squares"), piecesEl = $("pieces");
  var promoEl = $("promo"), resultEl = $("result"), panel = $("panel"), movesEl = $("moves");
  var statusCard = $("status-card"), statusEl = $("status"), subEl = $("substatus"), dotEl = $("turn-dot"), thinkingEl = $("thinking");
  var btnNew = $("btn-new"), btnUndo = $("btn-undo"), btnFlip = $("btn-flip"), btnSettings = $("btn-settings");
  var scrim = $("scrim");

  // ---------- Game state ----------
  var pos, history, keys, legal, gameOver, selected = -1, lastMove = 0;
  var pieceEls = {};
  var squareEls = [];
  var thinkToken = 0, aiTimer = 0, aiBusy = false;
  var drag = null, pendingPromo = null, resultDismissed = false;

  function isAI(side) {
    var m = settings.mode;
    return m === "watch" || (m === "white" && side === -1) || (m === "black" && side === 1);
  }
  function sideName(side) { return side === 1 ? "White" : "Black"; }
  function uci(m) {
    var p = E.mPromo(m);
    return E.sqName(E.mFrom(m)) + E.sqName(E.mTo(m)) + (p ? " pnbrq".charAt(p) : "");
  }

  // ---------- Geometry ----------
  function sqToXY(sq) {
    var r = sq >> 4, f = sq & 7;
    return settings.flip ? { x: 7 - f, y: r } : { x: f, y: 7 - r };
  }
  function xyToSq(x, y) {
    return settings.flip ? y * 16 + (7 - x) : (7 - y) * 16 + x;
  }
  function eventSq(e) {
    var r = boardEl.getBoundingClientRect();
    var x = Math.floor((e.clientX - r.left) / r.width * 8);
    var y = Math.floor((e.clientY - r.top) / r.height * 8);
    if (x < 0 || y < 0 || x > 7 || y > 7) return -1;
    return xyToSq(x, y);
  }

  function pieceSVG(v) {
    var cls = v > 0 ? "white" : "black";
    return '<svg class="' + cls + '" viewBox="0 0 170 170" aria-hidden="true"><use href="#' + NAMES[Math.abs(v)] + '"/></svg>';
  }

  // ---------- Board construction ----------
  function buildSquares() {
    squaresEl.innerHTML = "";
    squareEls = [];
    for (var y = 0; y < 8; y++) {
      for (var x = 0; x < 8; x++) {
        var d = document.createElement("div");
        d.className = "sq";
        squaresEl.appendChild(d);
        squareEls.push(d);
      }
    }
    orientSquares();
  }
  function orientSquares() {
    for (var i = 0; i < 64; i++) {
      var x = i % 8, y = (i / 8) | 0, sq = xyToSq(x, y);
      var d = squareEls[i];
      d.dataset.sq = sq;
      d.classList.toggle("light", (((sq >> 4) + (sq & 7)) & 1) === 1);
    }
    boardEl.classList.toggle("flipped", settings.flip);
  }
  function squareEl(sq) {
    var p = sqToXY(sq);
    return squareEls[p.y * 8 + p.x];
  }
  function placePiece(el, sq) {
    var p = sqToXY(sq);
    el.style.setProperty("--x", p.x);
    el.style.setProperty("--y", p.y);
  }
  function rebuildPieces() {
    piecesEl.innerHTML = "";
    pieceEls = {};
    for (var sq = 0; sq < 120; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      var v = pos.b[sq];
      if (!v) continue;
      var el = document.createElement("div");
      el.className = "piece no-anim";
      el.innerHTML = pieceSVG(v);
      el.dataset.v = v;
      placePiece(el, sq);
      piecesEl.appendChild(el);
      pieceEls[sq] = el;
    }
    // Re-enable sliding once the pieces are in place.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        for (var k in pieceEls) pieceEls[k].classList.remove("no-anim");
      });
    });
  }
  function repositionPieces() {
    for (var k in pieceEls) {
      pieceEls[k].classList.add("no-anim");
      placePiece(pieceEls[k], +k);
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        for (var k in pieceEls) pieceEls[k].classList.remove("no-anim");
      });
    });
  }

  // Animate the DOM pieces for move m (called before pos.make(m)).
  function animateMove(m, dropped) {
    var from = E.mFrom(m), to = E.mTo(m), flag = E.mFlag(m), promo = E.mPromo(m);
    var side = pos.side;
    var capSq = (flag & E.FLAG_EP) ? to - (side === 1 ? 16 : -16) : to;
    var capEl = pieceEls[capSq];
    if (capEl) {
      delete pieceEls[capSq];
      capEl.classList.add("gone");
      setTimeout(function () { if (capEl.parentNode) capEl.parentNode.removeChild(capEl); }, 260);
    }
    var el = pieceEls[from];
    if (el) {
      delete pieceEls[from];
      pieceEls[to] = el;
      if (dropped) {
        el.classList.add("no-anim");
        el.classList.remove("dragging");
        el.style.transform = "";
        placePiece(el, to);
        requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.remove("no-anim"); }); });
      } else {
        placePiece(el, to);
      }
      if (promo) {
        el.innerHTML = pieceSVG(promo * side);
        el.dataset.v = promo * side;
      }
    }
    if (flag & E.FLAG_CASTLE) {
      var rf, rt;
      if (to === 6) { rf = 7; rt = 5; } else if (to === 2) { rf = 0; rt = 3; }
      else if (to === 118) { rf = 119; rt = 117; } else { rf = 112; rt = 115; }
      var rook = pieceEls[rf];
      if (rook) { delete pieceEls[rf]; pieceEls[rt] = rook; placePiece(rook, rt); }
    }
  }
  function piecesInSync() {
    var count = 0;
    for (var sq = 0; sq < 120; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      var v = pos.b[sq], el = pieceEls[sq];
      if (!v) continue;
      count++;
      if (!el || +el.dataset.v !== v) return false;
    }
    return count === Object.keys(pieceEls).length;
  }

  // ---------- Status ----------
  function repetitionCount() {
    var cur = keys[keys.length - 1], n = 0;
    for (var i = 0; i < keys.length; i++) if (keys[i] === cur) n++;
    return n;
  }
  function computeGameOver() {
    if (!legal.length) {
      if (pos.inCheck()) {
        return { title: "Checkmate!", text: sideName(-pos.side) + " wins", winner: -pos.side };
      }
      return { title: "Stalemate", text: "It's a draw: " + sideName(pos.side) + " has no legal moves", winner: 0 };
    }
    if (pos.insufficientMaterial()) return { title: "Draw", text: "Not enough material to checkmate", winner: 0 };
    if (pos.half >= 100) return { title: "Draw", text: "Fifty moves without a capture or pawn move", winner: 0 };
    if (repetitionCount() >= 3) return { title: "Draw", text: "Threefold repetition", winner: 0 };
    return null;
  }
  function resultHeadline() {
    if (!gameOver) return "";
    var vsAI = settings.mode === "white" || settings.mode === "black";
    if (gameOver.winner && vsAI) {
      var human = settings.mode === "white" ? 1 : -1;
      return gameOver.winner === human ? "You win!" : "The computer wins";
    }
    return gameOver.text;
  }

  // ---------- Rendering ----------
  function render() {
    var side = pos.side;
    var inCheck = pos.inCheck();
    var targets = {};
    if (selected >= 0) {
      legal.forEach(function (m) { if (E.mFrom(m) === selected) targets[E.mTo(m)] = m; });
    }
    var showHints = settings.hints === "on" && selected < 0 && !gameOver && !drag;
    var reach = {};
    if (showHints) {
      legal.forEach(function (m) {
        var to = E.mTo(m), t = Math.abs(pos.b[E.mFrom(m)]);
        if (E.mPromo(m) && E.mPromo(m) !== E.QUEEN) return;
        var cap = !!pos.b[to] || (E.mFlag(m) & E.FLAG_EP);
        var r = reach[to] || (reach[to] = { cap: cap, list: [] });
        r.list.push(t * side);
      });
    }
    var lf = lastMove ? E.mFrom(lastMove) : -1, lt = lastMove ? E.mTo(lastMove) : -1;
    var kingSq = pos.k[side === 1 ? 0 : 1];
    for (var i = 0; i < 64; i++) {
      var d = squareEls[i];
      var sq = +d.dataset.sq;
      var x = i % 8, y = (i / 8) | 0;
      var html = "";
      if (y === 7) html += '<span class="coord file">' + "abcdefgh".charAt(sq & 7) + "</span>";
      if (x === 0) html += '<span class="coord rank">' + ((sq >> 4) + 1) + "</span>";
      if (targets[sq] !== undefined) {
        var isCap = !!pos.b[sq] || (E.mFlag(targets[sq]) & E.FLAG_EP);
        html += isCap ? '<span class="ring"></span>' : '<span class="dot"></span>';
      } else if (reach[sq]) {
        var r = reach[sq];
        html += '<div class="hints' + (r.cap ? " caps" : "") + '">' + r.list.slice(0, r.cap ? 4 : 8).map(pieceSVG).join("") + "</div>";
      }
      d.innerHTML = html;
      d.classList.toggle("last", sq === lf || sq === lt);
      d.classList.toggle("sel", sq === selected);
      d.classList.toggle("check", inCheck && sq === kingSq);
      d.classList.remove("over");
    }
    // Piece emphasis like the original: pieces that can act are outlined.
    var movable = {};
    legal.forEach(function (m) { movable[E.mFrom(m)] = true; });
    for (var k in pieceEls) {
      var el = pieceEls[k], s = +k;
      el.classList.toggle("sel", s === selected);
      el.classList.toggle("target", targets[s] !== undefined);
      el.classList.toggle("inactive", !movable[s] || !!gameOver);
    }
    renderStatus(inCheck);
    renderCaptures();
    renderMoves();
    renderButtons();
  }

  function renderStatus(inCheck) {
    var side = pos.side;
    dotEl.className = "dot " + (side === 1 ? "white" : "black");
    statusCard.classList.toggle("alert", !!gameOver || inCheck);
    thinkingEl.classList.toggle("hidden", !aiBusy);
    var last = history.length ? history[history.length - 1] : null;
    var lastText = last ? "Last move: " + Math.ceil(history.length / 2) + (history.length % 2 ? ". " : "... ") + last.san : "";
    if (gameOver) {
      statusEl.textContent = gameOver.title + (gameOver.winner ? " " + resultHeadline() : "");
      subEl.textContent = gameOver.winner && resultHeadline() === gameOver.text ? (lastText || " ") : gameOver.text;
      dotEl.className = "dot " + (gameOver.winner === -1 ? "black" : "white");
      return;
    }
    var mode = settings.mode;
    if (isAI(side)) {
      statusEl.textContent = mode === "watch" ? sideName(side) + " is thinking" : "Computer is thinking";
    } else if (mode === "white" || mode === "black") {
      statusEl.textContent = inCheck ? "Check! Your move" : "Your move";
    } else {
      statusEl.textContent = (inCheck ? "Check! " : "") + sideName(side) + " to move";
    }
    if (inCheck && isAI(side)) subEl.textContent = sideName(side) + " is in check";
    else subEl.textContent = lastText || (mode === "white" || mode === "black" ? "You play " + (mode === "white" ? "White" : "Black") + ". Tap or drag a piece." : "Tap or drag a piece to move.");
  }

  function renderCaptures() {
    var counts = { 1: [0, 0, 0, 0, 0, 0, 0], "-1": [0, 0, 0, 0, 0, 0, 0] };
    var mat = { 1: 0, "-1": 0 };
    for (var sq = 0; sq < 120; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      var v = pos.b[sq];
      if (!v) continue;
      var s = v > 0 ? 1 : -1;
      counts[s][Math.abs(v)]++;
      mat[s] += E.VAL[Math.abs(v)];
    }
    [1, -1].forEach(function (s) {
      // Pieces of the other colour that are missing were taken by side s.
      var other = -s, html = "";
      var extraPromoted = 0;
      for (var t = 2; t <= 5; t++) extraPromoted += Math.max(0, counts[other][t] - START_COUNTS[t]);
      for (t = 5; t >= 1; t--) {
        var missing = START_COUNTS[t] - counts[other][t];
        if (t === 1) missing -= extraPromoted;
        for (var n = 0; n < missing; n++) html += pieceSVG(t * other);
      }
      $(s === 1 ? "cap-white" : "cap-black").innerHTML = html;
      var adv = mat[s] - mat[other];
      $(s === 1 ? "adv-white" : "adv-black").textContent = adv > 0 ? "+" + Math.round(adv / 100) : "";
    });
  }

  function renderMoves() {
    var html = "";
    for (var i = 0; i < history.length; i += 2) {
      html += '<li><span class="n">' + (i / 2 + 1) + '.</span><span class="mv' + (i === history.length - 1 ? " cur" : "") + '">' + history[i].san + "</span>" +
        (history[i + 1] ? '<span class="mv' + (i + 1 === history.length - 1 ? " cur" : "") + '">' + history[i + 1].san + "</span>" : "<span></span>") + "</li>";
    }
    movesEl.innerHTML = html;
    movesEl.classList.toggle("empty", !history.length);
    movesEl.scrollTop = movesEl.scrollHeight;
  }

  function renderButtons() {
    btnUndo.disabled = !canUndo();
    document.querySelectorAll(".seg").forEach(function (seg) {
      var key = seg.getAttribute("data-setting");
      seg.querySelectorAll("button").forEach(function (b) {
        var on = b.getAttribute("data-value") === String(settings[key]);
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    });
  }

  // ---------- Moves ----------
  function refreshLegal() {
    legal = pos.legalMoves();
    gameOver = computeGameOver();
  }

  function applyMove(m, opts) {
    opts = opts || {};
    var san = pos.san(m, legal);
    animateMove(m, opts.dropped);
    pos.make(m);
    history.push({ m: m, san: san });
    keys.push(pos.key());
    lastMove = m;
    selected = -1;
    refreshLegal();
    if (!piecesInSync()) rebuildPieces();
    resultDismissed = false;
    persistGame();
    render();
    if (gameOver) showResult();
    scheduleAI();
  }

  function tryMove(from, to, opts) {
    var options = legal.filter(function (m) { return E.mFrom(m) === from && E.mTo(m) === to; });
    if (!options.length) return false;
    if (options.length > 1) { showPromo(from, to, options, opts); return true; }
    applyMove(options[0], opts);
    return true;
  }

  function showPromo(from, to, options, opts) {
    // Put a dragged pawn back on its square while the player chooses.
    if (opts && opts.dropped) snapBack(from);
    pendingPromo = { from: from, to: to, options: options, at: Date.now() };
    var side = pos.side;
    var html = '<div class="promo-box"><div class="promo-title">Promote to</div>';
    [E.QUEEN, E.ROOK, E.BISHOP, E.KNIGHT].forEach(function (t) {
      html += '<button type="button" data-t="' + t + '" aria-label="' + NAMES[t] + '">' + pieceSVG(t * side) + "</button>";
    });
    html += "</div>";
    promoEl.innerHTML = html;
    promoEl.classList.remove("hidden");
    var first = promoEl.querySelector("button");
    if (first) first.focus({ preventScroll: true });
  }
  function hidePromo() {
    pendingPromo = null;
    promoEl.classList.add("hidden");
    promoEl.innerHTML = "";
  }
  promoEl.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
  promoEl.addEventListener("click", function (e) {
    e.stopPropagation();
    var b = e.target.closest("button");
    var pp = pendingPromo;
    if (!pp) return;
    if (!b) {
      // Ignore the click that a tap on the board synthesizes right after opening.
      if (Date.now() - pp.at < 450) return;
      hidePromo(); selected = -1; render(); return;
    }
    var t = +b.getAttribute("data-t");
    var m = pp.options.filter(function (o) { return E.mPromo(o) === t; })[0];
    hidePromo();
    if (m) applyMove(m);
  });

  function showResult() {
    if (!gameOver || resultDismissed) return;
    $("result-title").textContent = gameOver.title;
    $("result-text").textContent = resultHeadline() + (gameOver.winner && (settings.mode === "white" || settings.mode === "black") ? " (" + gameOver.text + ")" : "");
    resultEl.classList.remove("hidden");
  }
  function hideResult() { resultEl.classList.add("hidden"); }

  // ---------- Computer player ----------
  var worker = null, workerFailed = false;
  function makeWorker() {
    if (worker || workerFailed) return worker;
    try {
      var src = "(" + createChessEngine.toString() + ")();";
      var url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      worker = new Worker(url);
      worker.onmessage = onWorkerMessage;
      worker.onerror = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        workerFailed = true;
        try { worker.terminate(); } catch (err) { /* ignore */ }
        worker = null;
        if (aiBusy) { var t = thinkToken; aiBusy = false; startThinking(t); }
      };
    } catch (e) {
      workerFailed = true;
      worker = null;
    }
    return worker;
  }
  var thinkStarted = 0;
  function moveDelay() { return Math.round(1000 / (+settings.speed || 2)); }

  function cancelAI() {
    thinkToken++;
    clearTimeout(aiTimer);
    aiBusy = false;
  }
  function scheduleAI() {
    cancelAI();
    if (gameOver || pendingPromo || !isAI(pos.side) || document.hidden) { renderStatus(pos.inCheck()); return; }
    aiBusy = true;
    renderStatus(pos.inCheck());
    var token = thinkToken;
    // Let the last move finish sliding before starting the search.
    aiTimer = setTimeout(function () { startThinking(token); }, 60);
  }
  function startThinking(token) {
    if (token !== thinkToken) return;
    aiBusy = true;
    thinkStarted = Date.now();
    var req = { id: token, fen: pos.fen(), level: settings.level, history: keys.slice() };
    if (settings.level !== "random" && makeWorker()) {
      worker.postMessage(req);
    } else {
      // Fallback without a worker: short, time-boxed search on the main thread.
      setTimeout(function () {
        if (token !== thinkToken) return;
        req.maxTime = 250;
        var r = E.think(req);
        deliverMove(token, r.move);
      }, 20);
    }
  }
  function onWorkerMessage(e) {
    var d = e.data || {};
    deliverMove(d.id, d.move);
  }
  function deliverMove(token, move) {
    if (token !== thinkToken) return;
    var wait = Math.max(0, moveDelay() - (Date.now() - thinkStarted));
    aiTimer = setTimeout(function () {
      if (token !== thinkToken) return;
      aiBusy = false;
      if (legal.indexOf(move) < 0) move = legal[Math.floor(Math.random() * legal.length)];
      if (!move) return;
      selected = -1;
      applyMove(move);
    }, wait);
  }

  // ---------- Undo / new game ----------
  function canUndo() {
    if (!history.length || settings.mode === "watch") return false;
    if (settings.mode === "both") return true;
    // Against the computer there must be a move of yours to take back.
    var human = settings.mode === "white" ? 1 : -1;
    for (var i = 0; i < history.length; i++) {
      var moverSide = (i % 2 === 0) ? startSide() : -startSide();
      if (moverSide === human) return true;
    }
    return false;
  }
  function startSide() { return 1; }
  function popMove() {
    pos.unmake();
    history.pop();
    keys.pop();
  }
  function undo() {
    if (!canUndo()) return;
    cancelAI();
    hidePromo();
    hideResult();
    if (settings.mode === "both") popMove();
    else {
      popMove();
      while (history.length && isAI(pos.side)) popMove();
    }
    lastMove = history.length ? history[history.length - 1].m : 0;
    selected = -1;
    refreshLegal();
    rebuildPieces();
    persistGame();
    render();
    scheduleAI();
  }

  var newConfirmTimer = 0;
  function requestNewGame() {
    if (!history.length || gameOver || btnNew.classList.contains("confirm")) { newGame(); return; }
    btnNew.classList.add("confirm");
    btnNew.textContent = "Sure?";
    clearTimeout(newConfirmTimer);
    newConfirmTimer = setTimeout(resetNewButton, 3000);
  }
  function resetNewButton() {
    clearTimeout(newConfirmTimer);
    btnNew.classList.remove("confirm");
    btnNew.textContent = "New game";
  }
  function newGame() {
    resetNewButton();
    cancelAI();
    hidePromo();
    hideResult();
    pos = Position.fromFEN(Position.START);
    history = [];
    keys = [pos.key()];
    lastMove = 0;
    selected = -1;
    if (settings.mode === "white") settings.flip = false;
    else if (settings.mode === "black") settings.flip = true;
    saveSettings();
    orientSquares();
    refreshLegal();
    rebuildPieces();
    persistGame();
    render();
    scheduleAI();
  }

  function persistGame() {
    save("game", { moves: history.map(function (h) { return uci(h.m); }) });
  }
  function saveSettings() { save("settings", settings); }

  function restoreGame() {
    pos = Position.fromFEN(Position.START);
    history = [];
    keys = [pos.key()];
    var saved = load("game", null);
    var list = saved && Array.isArray(saved.moves) ? saved.moves : [];
    for (var i = 0; i < list.length; i++) {
      var ms = pos.legalMoves(), found = 0;
      for (var j = 0; j < ms.length; j++) if (uci(ms[j]) === list[i]) { found = ms[j]; break; }
      if (!found) break;
      var san = pos.san(found, ms);
      pos.make(found);
      history.push({ m: found, san: san });
      keys.push(pos.key());
    }
    lastMove = history.length ? history[history.length - 1].m : 0;
    refreshLegal();
    resultDismissed = !!gameOver; // don't greet a returning player with an old result card
  }

  // ---------- Pointer input on the board ----------
  function canHumanMove() {
    return !gameOver && !pendingPromo && !isAI(pos.side);
  }
  function snapBack(sq) {
    var el = pieceEls[sq];
    if (!el) return;
    el.classList.remove("dragging");
    el.style.transform = "";
  }
  function setOver(sq) {
    squareEls.forEach(function (d) { d.classList.toggle("over", +d.dataset.sq === sq); });
  }
  function hasTarget(from, to) {
    for (var i = 0; i < legal.length; i++) if (E.mFrom(legal[i]) === from && E.mTo(legal[i]) === to) return true;
    return false;
  }

  boardEl.addEventListener("pointerdown", function (e) {
    if (e.button !== undefined && e.button > 0) return;
    if (!resultEl.classList.contains("hidden")) return;
    if (!canHumanMove()) return;
    var sq = eventSq(e);
    if (sq < 0) return;
    e.preventDefault();
    var v = pos.b[sq];
    if (selected >= 0 && hasTarget(selected, sq)) {
      tryMove(selected, sq);
      return;
    }
    if (v && (v > 0 ? 1 : -1) === pos.side) {
      var wasSelected = selected === sq;
      selected = sq;
      render();
      var rect = boardEl.getBoundingClientRect();
      drag = { sq: sq, x0: e.clientX, y0: e.clientY, moved: false, wasSelected: wasSelected, id: e.pointerId, rect: rect };
      try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    } else if (selected >= 0) {
      selected = -1;
      render();
    }
  });
  boardEl.addEventListener("pointermove", function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var tile = drag.rect.width / 8;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < Math.max(6, tile * 0.12)) return;
    var el = pieceEls[drag.sq];
    if (!el) return;
    drag.moved = true;
    el.classList.add("dragging");
    var px = e.clientX - drag.rect.left - tile / 2, py = e.clientY - drag.rect.top - tile / 2;
    el.style.transform = "translate(" + px + "px," + py + "px)";
    var over = eventSq(e);
    setOver(over >= 0 && hasTarget(drag.sq, over) ? over : -1);
  });
  function endDrag(e, cancelled) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    var d = drag;
    drag = null;
    try { boardEl.releasePointerCapture(d.id); } catch (err) { /* ignore */ }
    setOver(-1);
    if (d.moved) {
      var to = cancelled ? -1 : eventSq(e);
      if (to >= 0 && to !== d.sq && hasTarget(d.sq, to)) {
        tryMove(d.sq, to, { dropped: true });
        return;
      }
      snapBack(d.sq);
      render();
    } else if (d.wasSelected) {
      selected = -1;
      render();
    }
  }
  boardEl.addEventListener("pointerup", function (e) { endDrag(e, false); });
  boardEl.addEventListener("pointercancel", function (e) { endDrag(e, true); });
  boardEl.addEventListener("lostpointercapture", function (e) { if (drag && e.pointerId === drag.id) endDrag(e, true); });
  document.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  // ---------- Buttons & settings ----------
  btnNew.addEventListener("click", requestNewGame);
  btnUndo.addEventListener("click", undo);
  btnFlip.addEventListener("click", function () {
    settings.flip = !settings.flip;
    saveSettings();
    orientSquares();
    repositionPieces();
    render();
  });
  $("result-new").addEventListener("click", newGame);
  $("result-close").addEventListener("click", function () { resultDismissed = true; hideResult(); });

  function openSheet() { app.classList.add("sheet-open"); scrim.classList.remove("hidden"); }
  function closeSheet() { app.classList.remove("sheet-open"); scrim.classList.add("hidden"); }
  btnSettings.addEventListener("click", openSheet);
  $("settings-close").addEventListener("click", closeSheet);
  scrim.addEventListener("click", closeSheet);

  document.querySelectorAll(".seg").forEach(function (seg) {
    seg.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var key = seg.getAttribute("data-setting"), value = b.getAttribute("data-value");
      if (settings[key] === value) return;
      settings[key] = value;
      if (key === "mode") {
        var flip = settings.flip;
        if (value === "white") flip = false;
        else if (value === "black") flip = true;
        if (flip !== settings.flip) { settings.flip = flip; orientSquares(); repositionPieces(); }
        selected = -1;
      }
      saveSettings();
      render();
      if (key === "mode" || key === "level") scheduleAI();
      if (key === "mode" && gameOver && !resultDismissed) showResult();
    });
  });

  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key.toLowerCase();
    if (k === "escape") {
      if (app.classList.contains("sheet-open")) closeSheet();
      else if (pendingPromo) { hidePromo(); render(); }
      else if (selected >= 0) { selected = -1; render(); }
    } else if (k === "u" || k === "backspace") { e.preventDefault(); undo(); }
    else if (k === "f") btnFlip.click();
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { cancelAI(); renderStatus(pos.inCheck()); }
    else scheduleAI();
  });

  // ---------- Layout ----------
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function layout() {
    var W = window.innerWidth, H = window.innerHeight;
    var gap = Math.round(clamp(Math.min(W, H) * 0.022, 8, 22));
    var landW = Math.min(H - 2 * gap, W - 3 * gap - 250);
    var portH = Math.min(W - 2 * gap, H - 3 * gap - 150);
    var landscape = landW > portH;
    var outer = Math.max(160, Math.floor(landscape ? landW : portH));
    var frame = Math.max(6, Math.round(outer * 0.028));
    var board = Math.floor((outer - 2 * frame) / 8) * 8;
    outer = board + 2 * frame;
    var st = document.documentElement.style;
    st.setProperty("--board", board + "px");
    st.setProperty("--frame", frame + "px");
    st.setProperty("--gap", gap + "px");
    app.classList.toggle("landscape", landscape);
    app.classList.toggle("portrait", !landscape);
    var panelW, panelH;
    if (landscape) {
      panelW = clamp(W - outer - 3 * gap, 250, 380);
      panelH = outer;
    } else {
      panelW = Math.min(W - 2 * gap, Math.max(outer, 320));
      panelH = H - outer - 3 * gap;
    }
    st.setProperty("--panel-w", panelW + "px");
    st.setProperty("--panel-h", panelH + "px");
    panel.style.height = panelH + "px";
    panel.style.overflow = "hidden";
    app.classList.remove("compact", "tight", "no-moves");
    if (panel.scrollHeight > panelH + 1) app.classList.add("compact");
    if (panel.scrollHeight > panelH + 1) app.classList.add("tight");
    if (movesEl.clientHeight < 56) app.classList.add("no-moves");
    if (!app.classList.contains("compact")) closeSheet();
    movesEl.scrollTop = movesEl.scrollHeight;
  }
  var layoutRaf = 0;
  function queueLayout() {
    cancelAnimationFrame(layoutRaf);
    layoutRaf = requestAnimationFrame(layout);
  }
  window.addEventListener("resize", queueLayout);
  window.addEventListener("orientationchange", function () { setTimeout(layout, 150); });

  // ---------- Start ----------
  buildSquares();
  restoreGame();
  rebuildPieces();
  render();
  layout();
  if (gameOver) showResult();
  scheduleAI();

  // Small hook for automated screenshots/tests.
  window.ChessAI = {
    get fen() { return pos.fen(); },
    play: function (list) {
      cancelAI();
      list.forEach(function (s) {
        var m = legal.filter(function (x) { return uci(x) === s; })[0];
        if (m) { animateMove(m); pos.make(m); history.push({ m: m, san: "" }); keys.push(pos.key()); lastMove = m; refreshLegal(); }
      });
      // recompute SAN for the list
      var p = Position.fromFEN(Position.START);
      history.forEach(function (h) { h.san = p.san(h.m); p.make(h.m); });
      rebuildPieces(); persistGame(); render(); if (gameOver) showResult(); scheduleAI();
    },
    newGame: newGame
  };
})();
