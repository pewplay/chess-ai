/* Chess AI - rules engine and computer player.
 * The whole engine lives in one function so the same source can also run
 * inside a Web Worker (built from a Blob), keeping the page responsive while
 * the computer thinks. */
function createChessEngine() {
  "use strict";
  var PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
  var N_OFF = [33, 31, 18, 14, -33, -31, -18, -14];
  var K_OFF = [1, -1, 16, -16, 15, 17, -15, -17];
  var B_OFF = [15, 17, -15, -17];
  var R_OFF = [1, -1, 16, -16];
  var VAL = [0, 100, 320, 330, 500, 900, 0];
  var FLAG_EP = 1, FLAG_CASTLE = 2, FLAG_DOUBLE = 4;
  var MATE = 100000, INF = 1000000;
  var LETTERS = " pnbrqk";

  // Piece-square tables, written from White's point of view with rank 8 first.
  var PST = [
    null,
    [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
    [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20]
  ];
  var KING_END = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];

  // Castling-rights masks: moving from/to these squares removes rights.
  var CR = new Int8Array(128);
  for (var i = 0; i < 128; i++) CR[i] = 15;
  CR[0] = 15 & ~2; CR[4] = 15 & ~3; CR[7] = 15 & ~1;
  CR[112] = 15 & ~8; CR[116] = 15 & ~12; CR[119] = 15 & ~4;

  function sqName(sq) { return "abcdefgh".charAt(sq & 7) + ((sq >> 4) + 1); }
  function nameSq(n) { return (n.charCodeAt(1) - 49) * 16 + (n.charCodeAt(0) - 97); }
  function mFrom(m) { return m & 127; }
  function mTo(m) { return (m >> 7) & 127; }
  function mPromo(m) { return (m >> 14) & 7; }
  function mFlag(m) { return m >> 17; }
  function encode(from, to, promo, flag) { return from | (to << 7) | (promo << 14) | (flag << 17); }
  function pstIndex(sq, white) { var r = sq >> 4, f = sq & 7; return white ? (7 - r) * 8 + f : r * 8 + f; }

  function Position() {
    this.b = new Int8Array(128);
    this.side = 1;
    this.castle = 0;
    this.ep = -1;
    this.half = 0;
    this.full = 1;
    this.k = [-1, -1];
    this.stack = [];
  }
  Position.START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  Position.fromFEN = function (fen) {
    var p = new Position();
    var parts = fen.split(/\s+/);
    var rows = parts[0].split("/");
    for (var r = 0; r < 8; r++) {
      var f = 0, row = rows[r];
      for (var j = 0; j < row.length; j++) {
        var c = row.charAt(j);
        if (c >= "1" && c <= "8") { f += +c; continue; }
        var t = LETTERS.indexOf(c.toLowerCase());
        var sq = (7 - r) * 16 + f;
        p.b[sq] = c === c.toUpperCase() ? t : -t;
        if (t === KING) p.k[c === c.toUpperCase() ? 0 : 1] = sq;
        f++;
      }
    }
    p.side = parts[1] === "b" ? -1 : 1;
    var cs = parts[2] || "-";
    p.castle = (cs.indexOf("K") >= 0 ? 1 : 0) | (cs.indexOf("Q") >= 0 ? 2 : 0) | (cs.indexOf("k") >= 0 ? 4 : 0) | (cs.indexOf("q") >= 0 ? 8 : 0);
    p.ep = parts[3] && parts[3] !== "-" ? nameSq(parts[3]) : -1;
    p.half = parseInt(parts[4] || "0", 10) || 0;
    p.full = parseInt(parts[5] || "1", 10) || 1;
    return p;
  };
  Position.prototype.placement = function () {
    var out = "";
    for (var r = 7; r >= 0; r--) {
      var empty = 0;
      for (var f = 0; f < 8; f++) {
        var v = this.b[r * 16 + f];
        if (!v) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        var ch = LETTERS.charAt(Math.abs(v));
        out += v > 0 ? ch.toUpperCase() : ch;
      }
      if (empty) out += empty;
      if (r) out += "/";
    }
    return out;
  };
  Position.prototype.castleString = function () {
    var s = (this.castle & 1 ? "K" : "") + (this.castle & 2 ? "Q" : "") + (this.castle & 4 ? "k" : "") + (this.castle & 8 ? "q" : "");
    return s || "-";
  };
  Position.prototype.fen = function () {
    return this.placement() + " " + (this.side === 1 ? "w" : "b") + " " + this.castleString() + " " +
      (this.ep >= 0 ? sqName(this.ep) : "-") + " " + this.half + " " + this.full;
  };
  // Key for repetition detection (en passant only counts when a capture is possible).
  Position.prototype.key = function () {
    var ep = "-";
    if (this.ep >= 0) {
      var pawn = this.side, back = this.side === 1 ? -16 : 16;
      var a = this.ep + back - 1, c = this.ep + back + 1;
      if ((!(a & 0x88) && this.b[a] === pawn) || (!(c & 0x88) && this.b[c] === pawn)) ep = sqName(this.ep);
    }
    return this.placement() + " " + (this.side === 1 ? "w" : "b") + " " + this.castleString() + " " + ep;
  };
  Position.prototype.attacked = function (sq, by) {
    var b = this.b, s, o, p, j;
    if (by === 1) {
      s = sq - 15; if (!(s & 0x88) && b[s] === 1) return true;
      s = sq - 17; if (!(s & 0x88) && b[s] === 1) return true;
    } else {
      s = sq + 15; if (!(s & 0x88) && b[s] === -1) return true;
      s = sq + 17; if (!(s & 0x88) && b[s] === -1) return true;
    }
    for (j = 0; j < 8; j++) {
      s = sq + N_OFF[j]; if (!(s & 0x88) && b[s] === by * KNIGHT) return true;
      s = sq + K_OFF[j]; if (!(s & 0x88) && b[s] === by * KING) return true;
    }
    for (j = 0; j < 4; j++) {
      o = B_OFF[j]; s = sq + o;
      while (!(s & 0x88)) { p = b[s]; if (p) { if (p === by * BISHOP || p === by * QUEEN) return true; break; } s += o; }
      o = R_OFF[j]; s = sq + o;
      while (!(s & 0x88)) { p = b[s]; if (p) { if (p === by * ROOK || p === by * QUEEN) return true; break; } s += o; }
    }
    return false;
  };
  Position.prototype.inCheck = function (side) {
    side = side || this.side;
    return this.attacked(this.k[side === 1 ? 0 : 1], -side);
  };
  // Pseudo-legal move generation (capsOnly: captures and queen promotions).
  Position.prototype.gen = function (list, capsOnly) {
    var b = this.b, side = this.side, sq, p, t, to, j, o;
    for (sq = 0; sq < 120; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      p = b[sq];
      if (p * side <= 0) continue;
      t = p * side;
      if (t === PAWN) {
        var dir = side === 1 ? 16 : -16;
        var lastRank = side === 1 ? 7 : 0;
        var startRank = side === 1 ? 1 : 6;
        to = sq + dir;
        if (!(to & 0x88) && !b[to]) {
          if ((to >> 4) === lastRank) {
            list.push(encode(sq, to, QUEEN, 0));
            if (!capsOnly) { list.push(encode(sq, to, KNIGHT, 0)); list.push(encode(sq, to, ROOK, 0)); list.push(encode(sq, to, BISHOP, 0)); }
          } else if (!capsOnly) {
            list.push(encode(sq, to, 0, 0));
            if ((sq >> 4) === startRank && !b[to + dir]) list.push(encode(sq, to + dir, 0, FLAG_DOUBLE));
          }
        }
        for (j = -1; j <= 1; j += 2) {
          to = sq + dir + j;
          if (to & 0x88) continue;
          if (b[to] * side < 0) {
            if ((to >> 4) === lastRank) {
              list.push(encode(sq, to, QUEEN, 0));
              if (!capsOnly) { list.push(encode(sq, to, KNIGHT, 0)); list.push(encode(sq, to, ROOK, 0)); list.push(encode(sq, to, BISHOP, 0)); }
            } else list.push(encode(sq, to, 0, 0));
          } else if (to === this.ep) list.push(encode(sq, to, 0, FLAG_EP));
        }
      } else if (t === KNIGHT || t === KING) {
        var offs = t === KNIGHT ? N_OFF : K_OFF;
        for (j = 0; j < 8; j++) {
          to = sq + offs[j];
          if (to & 0x88) continue;
          if (b[to] * side < 0 || (!b[to] && !capsOnly)) list.push(encode(sq, to, 0, 0));
        }
        if (t === KING && !capsOnly) this.genCastles(list, sq);
      } else {
        var dirs = t === BISHOP ? B_OFF : t === ROOK ? R_OFF : K_OFF;
        for (j = 0; j < dirs.length; j++) {
          o = dirs[j]; to = sq + o;
          while (!(to & 0x88)) {
            if (b[to]) { if (b[to] * side < 0) list.push(encode(sq, to, 0, 0)); break; }
            if (!capsOnly) list.push(encode(sq, to, 0, 0));
            to += o;
          }
        }
      }
    }
    return list;
  };
  Position.prototype.genCastles = function (list, sq) {
    var b = this.b, side = this.side;
    if (side === 1 && sq === 4) {
      if ((this.castle & 1) && b[7] === ROOK && !b[5] && !b[6] && !this.attacked(4, -1) && !this.attacked(5, -1) && !this.attacked(6, -1)) list.push(encode(4, 6, 0, FLAG_CASTLE));
      if ((this.castle & 2) && b[0] === ROOK && !b[1] && !b[2] && !b[3] && !this.attacked(4, -1) && !this.attacked(3, -1) && !this.attacked(2, -1)) list.push(encode(4, 2, 0, FLAG_CASTLE));
    } else if (side === -1 && sq === 116) {
      if ((this.castle & 4) && b[119] === -ROOK && !b[117] && !b[118] && !this.attacked(116, 1) && !this.attacked(117, 1) && !this.attacked(118, 1)) list.push(encode(116, 118, 0, FLAG_CASTLE));
      if ((this.castle & 8) && b[112] === -ROOK && !b[113] && !b[114] && !b[115] && !this.attacked(116, 1) && !this.attacked(115, 1) && !this.attacked(114, 1)) list.push(encode(116, 114, 0, FLAG_CASTLE));
    }
  };
  Position.prototype.make = function (m) {
    var b = this.b, from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flag = m >> 17;
    var p = b[from], side = this.side;
    var st = { m: m, cap: b[to], castle: this.castle, ep: this.ep, half: this.half };
    if (flag & FLAG_EP) { var cs = to - (side === 1 ? 16 : -16); st.cap = b[cs]; b[cs] = 0; }
    b[to] = promo ? promo * side : p;
    b[from] = 0;
    if (flag & FLAG_CASTLE) {
      if (to === 6) { b[5] = b[7]; b[7] = 0; }
      else if (to === 2) { b[3] = b[0]; b[0] = 0; }
      else if (to === 118) { b[117] = b[119]; b[119] = 0; }
      else if (to === 114) { b[115] = b[112]; b[112] = 0; }
    }
    if (p * side === KING) this.k[side === 1 ? 0 : 1] = to;
    this.castle &= CR[from] & CR[to];
    this.ep = (flag & FLAG_DOUBLE) ? (from + to) >> 1 : -1;
    this.half = (p * side === PAWN || st.cap) ? 0 : this.half + 1;
    if (side === -1) this.full++;
    this.side = -side;
    this.stack.push(st);
  };
  Position.prototype.unmake = function () {
    var st = this.stack.pop(), m = st.m, b = this.b;
    var from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flag = m >> 17;
    var side = -this.side;
    this.side = side;
    var p = promo ? PAWN * side : b[to];
    b[from] = p;
    if (flag & FLAG_EP) { b[to] = 0; b[to - (side === 1 ? 16 : -16)] = st.cap; }
    else b[to] = st.cap;
    if (flag & FLAG_CASTLE) {
      if (to === 6) { b[7] = b[5]; b[5] = 0; }
      else if (to === 2) { b[0] = b[3]; b[3] = 0; }
      else if (to === 118) { b[119] = b[117]; b[117] = 0; }
      else if (to === 114) { b[112] = b[115]; b[115] = 0; }
    }
    if (p * side === KING) this.k[side === 1 ? 0 : 1] = from;
    this.castle = st.castle; this.ep = st.ep; this.half = st.half;
    if (side === -1) this.full--;
  };
  Position.prototype.legalMoves = function () {
    var list = this.gen([], false), out = [], mover = this.side;
    for (var i = 0; i < list.length; i++) {
      this.make(list[i]);
      if (!this.attacked(this.k[mover === 1 ? 0 : 1], -mover)) out.push(list[i]);
      this.unmake();
    }
    return out;
  };
  Position.prototype.insufficientMaterial = function () {
    var minors = [], b = this.b;
    for (var sq = 0; sq < 120; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      var t = Math.abs(b[sq]);
      if (!t || t === KING) continue;
      if (t === PAWN || t === ROOK || t === QUEEN) return false;
      minors.push({ t: t, color: ((sq >> 4) + (sq & 7)) & 1, side: b[sq] > 0 });
    }
    if (minors.length <= 1) return true;
    if (minors.length === 2 && minors[0].t === BISHOP && minors[1].t === BISHOP && minors[0].side !== minors[1].side && minors[0].color === minors[1].color) return true;
    return false;
  };
  Position.prototype.san = function (m, legal) {
    legal = legal || this.legalMoves();
    var from = mFrom(m), to = mTo(m), promo = mPromo(m), flag = mFlag(m);
    var t = Math.abs(this.b[from]), s;
    if (flag & FLAG_CASTLE) s = (to & 7) === 6 ? "O-O" : "O-O-O";
    else {
      var capture = !!this.b[to] || (flag & FLAG_EP);
      if (t === PAWN) {
        s = capture ? "abcdefgh".charAt(from & 7) + "x" : "";
        s += sqName(to);
        if (promo) s += "=" + "  NBRQ".charAt(promo);
      } else {
        s = " PNBRQK".charAt(t);
        var sameFile = false, sameRank = false, amb = false;
        for (var i = 0; i < legal.length; i++) {
          var o = legal[i];
          if (o === m || mTo(o) !== to || mFrom(o) === from || Math.abs(this.b[mFrom(o)]) !== t) continue;
          amb = true;
          if ((mFrom(o) & 7) === (from & 7)) sameFile = true;
          if ((mFrom(o) >> 4) === (from >> 4)) sameRank = true;
        }
        if (amb) {
          if (!sameFile) s += "abcdefgh".charAt(from & 7);
          else if (!sameRank) s += (from >> 4) + 1;
          else s += sqName(from);
        }
        s += (capture ? "x" : "") + sqName(to);
      }
    }
    this.make(m);
    if (this.inCheck()) s += this.legalMoves().length ? "+" : "#";
    this.unmake();
    return s;
  };

  // ---------- Evaluation ----------
  function evaluate(pos) {
    var b = pos.b, score = 0, npm = 0, sq, v, t, w;
    var bishops = [0, 0], mat = [0, 0];
    for (sq = 0; sq < 120; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      v = b[sq];
      if (!v) continue;
      w = v > 0;
      t = w ? v : -v;
      if (t === KING) continue;
      var s = VAL[t] + PST[t][pstIndex(sq, w)];
      if (t !== PAWN) npm += VAL[t];
      if (t === BISHOP) bishops[w ? 0 : 1]++;
      mat[w ? 0 : 1] += VAL[t];
      score += w ? s : -s;
    }
    if (bishops[0] >= 2) score += 30;
    if (bishops[1] >= 2) score -= 30;
    var phase = Math.min(1, npm / 6200);
    var wk = pos.k[0], bk = pos.k[1];
    var wi = pstIndex(wk, true), bi = pstIndex(bk, false);
    score += Math.round(PST[KING][wi] * phase + KING_END[wi] * (1 - phase));
    score -= Math.round(PST[KING][bi] * phase + KING_END[bi] * (1 - phase));
    // Help the stronger side finish the game in simple endings.
    var diff = mat[0] - mat[1];
    if (phase < 0.35 && Math.abs(diff) >= 300) {
      var loser = diff > 0 ? bk : wk;
      var lr = loser >> 4, lf = loser & 7;
      var centerDist = Math.max(3 - lr, lr - 4) + Math.max(3 - lf, lf - 4);
      var kd = Math.max(Math.abs((wk >> 4) - (bk >> 4)), Math.abs((wk & 7) - (bk & 7)));
      var bonus = centerDist * 12 + (7 - kd) * 6;
      score += diff > 0 ? bonus : -bonus;
    }
    return score * pos.side;
  }

  // ---------- Search ----------
  var nodes = 0, deadline = 0, stopped = false, killers = [];
  function now() { return (typeof performance !== "undefined" ? performance : Date).now(); }

  function orderScore(pos, m, pv, ply) {
    if (m === pv) return 1000000;
    var cap = pos.b[mTo(m)], promo = mPromo(m);
    if (mFlag(m) & FLAG_EP) cap = 1;
    if (cap) return 100000 + VAL[Math.abs(cap)] * 10 - Math.abs(pos.b[mFrom(m)]);
    if (promo) return 90000 + promo;
    var k = killers[ply];
    if (k && (k[0] === m || k[1] === m)) return 80000;
    return 0;
  }
  function sortMoves(pos, list, pv, ply) {
    var scored = new Array(list.length);
    for (var i = 0; i < list.length; i++) scored[i] = [orderScore(pos, list[i], pv, ply), list[i]];
    scored.sort(function (a, c) { return c[0] - a[0]; });
    for (i = 0; i < list.length; i++) list[i] = scored[i][1];
    return list;
  }
  function quiesce(pos, alpha, beta, ply) {
    if ((++nodes & 1023) === 0 && now() > deadline) stopped = true;
    if (stopped) return 0;
    var stand = evaluate(pos);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (ply > 40) return stand;
    var list = sortMoves(pos, pos.gen([], true), 0, ply), mover = pos.side;
    for (var i = 0; i < list.length; i++) {
      pos.make(list[i]);
      if (pos.attacked(pos.k[mover === 1 ? 0 : 1], -mover)) { pos.unmake(); continue; }
      var score = -quiesce(pos, -beta, -alpha, ply + 1);
      pos.unmake();
      if (stopped) return 0;
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }
  function search(pos, depth, alpha, beta, ply) {
    if ((++nodes & 1023) === 0 && now() > deadline) stopped = true;
    if (stopped) return 0;
    if (pos.half >= 100) return 0;
    var check = pos.inCheck();
    if (check) depth++;
    if (depth <= 0) return quiesce(pos, alpha, beta, ply);
    var list = sortMoves(pos, pos.gen([], false), 0, ply), mover = pos.side, legal = 0, best = -INF;
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      pos.make(m);
      if (pos.attacked(pos.k[mover === 1 ? 0 : 1], -mover)) { pos.unmake(); continue; }
      legal++;
      var score = -search(pos, depth - 1, -beta, -alpha, ply + 1);
      pos.unmake();
      if (stopped) return 0;
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        if (!pos.b[mTo(m)] && !mPromo(m)) {
          var k = killers[ply] || (killers[ply] = [0, 0]);
          if (k[0] !== m) { k[1] = k[0]; k[0] = m; }
        }
        break;
      }
    }
    if (!legal) return check ? -MATE + ply : 0;
    return best;
  }

  var LEVELS = {
    easy: { maxDepth: 1, time: 250, noise: 90 },
    medium: { maxDepth: 4, time: 700, noise: 15 },
    hard: { maxDepth: 8, time: 1600, noise: 0 }
  };

  // Pick a move. opts: { fen, level, history: [keys of earlier positions] }
  function think(opts) {
    var pos = Position.fromFEN(opts.fen);
    var legal = pos.legalMoves();
    if (!legal.length) return { move: 0 };
    if (opts.level === "random" || legal.length === 1) {
      return { move: legal[Math.floor(Math.random() * legal.length)], depth: 0 };
    }
    var cfg = LEVELS[opts.level] || LEVELS.medium;
    var seen = {};
    (opts.history || []).forEach(function (k) { seen[k] = (seen[k] || 0) + 1; });
    var noise = {}, repeats = {};
    for (var i = 0; i < legal.length; i++) {
      noise[legal[i]] = cfg.noise ? Math.round((Math.random() * 2 - 1) * cfg.noise) : 0;
      pos.make(legal[i]);
      repeats[legal[i]] = !!seen[pos.key()];
      pos.unmake();
    }
    nodes = 0; stopped = false; killers = [];
    var start = now();
    var budget = opts.maxTime ? Math.min(cfg.time, opts.maxTime) : cfg.time;
    deadline = start + budget;
    var bestMove = legal[0], bestScore = -INF, completed = 0;
    var order = sortMoves(pos, legal.slice(), 0, 0);
    for (var depth = 1; depth <= cfg.maxDepth; depth++) {
      var alpha = -INF, iterBest = 0, iterScore = -INF;
      var scores = {};
      for (i = 0; i < order.length; i++) {
        var m = order[i];
        pos.make(m);
        var score = repeats[m] ? 0 : -search(pos, depth - 1, -INF, -alpha + cfg.noise, 1);
        pos.unmake();
        if (stopped) break;
        score += noise[m];
        scores[m] = score;
        if (score > iterScore) { iterScore = score; iterBest = m; }
        if (score > alpha) alpha = score;
      }
      if (stopped && depth > 1) break;
      if (iterBest) { bestMove = iterBest; bestScore = iterScore; completed = depth; }
      // Best move first for the next iteration.
      order.sort(function (a, c) { return (scores[c] === undefined ? -INF : scores[c]) - (scores[a] === undefined ? -INF : scores[a]); });
      if (stopped) break;
      if (Math.abs(bestScore) > MATE - 100) break;
      if (now() - start > budget * 0.55) break;
    }
    return { move: bestMove, score: bestScore, depth: completed, nodes: nodes };
  }

  var api = {
    Position: Position, think: think, sqName: sqName, nameSq: nameSq,
    mFrom: mFrom, mTo: mTo, mPromo: mPromo, mFlag: mFlag, encode: encode,
    FLAG_EP: FLAG_EP, FLAG_CASTLE: FLAG_CASTLE, FLAG_DOUBLE: FLAG_DOUBLE,
    PAWN: PAWN, KNIGHT: KNIGHT, BISHOP: BISHOP, ROOK: ROOK, QUEEN: QUEEN, KING: KING, VAL: VAL
  };
  if (typeof document === "undefined" && typeof self !== "undefined" && typeof postMessage === "function" && typeof module === "undefined") {
    self.onmessage = function (e) {
      var r = think(e.data);
      postMessage({ id: e.data.id, move: r.move, depth: r.depth });
    };
  }
  return api;
}
if (typeof module !== "undefined") module.exports = createChessEngine;
