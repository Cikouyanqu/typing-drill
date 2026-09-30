/* ==========================================================================
   engine.js — typing engine

   Job: turn key events into "right / wrong" verdicts, and name the kind of
   mistake. It reads both event.key (the character produced) and event.code
   (the physical key), which is what makes it possible to tell apart:
     wrong physical key / missing Shift / extra Shift / wrong Shift side
   A plain typing test can only say "you typed the wrong thing".

   Design: press(ev) takes a duck-typed event (key, code, shiftKey, location,
   getModifierState) and never touches real DOM, so the test suite can feed it
   synthetic events directly.
   ========================================================================== */

window.TD = window.TD || {};
(function (TD) {
  'use strict';

  var Keymap = TD.Keymap;

  var IDLE_MS = 2000;          /* gaps beyond this are excluded from response-time samples */
  var IDLE_PAUSE_MS = 5000;    /* gaps beyond this are excluded from the clock, so a break cannot wreck CPM */
  var MODIFIER_KEYS = { Shift: 1, Control: 1, Alt: 1, Meta: 1, CapsLock: 1, NumLock: 1, ScrollLock: 1, AltGraph: 1 };

  function tr(key, params) {
    return TD.I18n ? TD.I18n.t(key, params) : key;
  }

  /* Mistake kinds, translated on read so a language switch needs no reload.
     Exposed as an object so existing call sites keep working unchanged. */
  var KIND_IDS = ['correct', 'wrong-key', 'missing-shift', 'extra-shift', 'same-key',
    'wrong-shift-side', 'capslock', 'other'];

  var KIND_LABEL = {};
  KIND_IDS.forEach(function (id) {
    Object.defineProperty(KIND_LABEL, id, {
      enumerable: true,
      configurable: true,
      get: function () { return tr('kind.' + id); }
    });
  });

  function kindLabel(kind) {
    return tr('kind.' + kind);
  }

  function Engine() {
    /* Event subscriptions are initialised once, in the constructor. reset()
       swaps the drill text and must NOT drop subscribers — otherwise nothing
       receives finish/update after a new set is loaded. */
    this.handlers = { keystroke: [], update: [], finish: [] };
    this.reset('', {});
  }

  /**
   * Reset the engine.
   * text — practice text, '\n' separates lines
   * opts — { symbolOnly: skip letters/digits, allowBackspace: false = strict mode }
   */
  Engine.prototype.reset = function (text, opts) {
    opts = opts || {};
    this.text = String(text || '');
    this.symbolOnly = !!opts.symbolOnly;
    this.allowBackspace = opts.allowBackspace !== false;
    this.meta = opts.meta || {};

    /* Flatten to a character sequence. Newlines are line breaks for rendering
       only; they are never typed. */
    var lines = this.text.split('\n');
    var items = [];
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      for (var ci = 0; ci < line.length; ci++) {
        var ch = line[ci];
        var info = Keymap.lookup(ch);
        items.push({
          ch: ch, li: li, ci: ci, index: items.length,
          isFocus: this.symbolOnly ? Keymap.isSymbol(ch) : true,
          expected: info,
          done: false, skipped: false, everWrong: false,
          counted: false,   /* already counted as first-try; retracted on Backspace */
          lastTyped: null, lastKind: null, wrongCount: 0
        });
      }
    }
    this.items = items;
    this.lines = lines;
    this.lineStarts = [];
    var acc = 0;
    for (var k = 0; k < lines.length; k++) { this.lineStarts.push(acc); acc += lines[k].length; }

    this.pos = 0;
    this.started = false;
    this.finished = false;
    this.paused = false;
    this.startedAt = 0;
    this.endedAt = 0;
    this.lastKeyAt = 0;
    this.idleMs = 0;            /* accumulated time excluded from the clock */
    this.shiftSide = null;      /* which Shift is held, tracked from Shift keydowns */

    this.typedCount = 0;        /* characters advanced by a real keystroke (skips excluded) */
    this.totalStrokes = 0;
    this.correctStrokes = 0;
    this.errorStrokes = 0;
    this.backspaces = 0;
    this.wrongShiftCount = 0;
    this.firstTryChars = 0;     /* completed characters never typed wrong */
    this.errorKinds = Object.create(null);
    this.keyDeltas = Object.create(null);
    this.confusions = Object.create(null);

    /* Skip leading non-target characters (text may start with letters in
       symbols-only mode). */
    this._skipNonFocus();
    return this;
  };

  /* -------------------------------------------------------- subscription */

  Engine.prototype.on = function (name, fn) {
    if (this.handlers[name]) this.handlers[name].push(fn);
    return this;
  };

  Engine.prototype._emit = function (name, payload) {
    var hs = this.handlers[name] || [];
    for (var i = 0; i < hs.length; i++) hs[i](payload, this);
  };

  /* ------------------------------------------------------------ progress */

  Engine.prototype._skipNonFocus = function () {
    while (this.pos < this.items.length && !this.items[this.pos].isFocus) {
      this.items[this.pos].skipped = true;
      this.pos++;
    }
  };

  Engine.prototype.total = function () { return this.items.length; };

  /* Number of target characters, which is smaller than the total in
     symbols-only mode. */
  Engine.prototype.focusTotal = function () {
    var n = 0;
    for (var i = 0; i < this.items.length; i++) if (this.items[i].isFocus) n++;
    return n;
  };

  Engine.prototype.currentItem = function () {
    return this.pos < this.items.length ? this.items[this.pos] : null;
  };

  /* Accumulated idle time. While a drill is running the current open gap is
     included as well, so stopping mid-drill freezes the timer and the CPM
     instead of letting them rot. */
  Engine.prototype._idleMs = function (now) {
    var idle = this.idleMs;
    if (!this.finished && this.started && this.lastKeyAt) {
      var gap = now - this.lastKeyAt;
      if (gap > IDLE_PAUSE_MS) idle += gap - IDLE_PAUSE_MS;
    }
    return idle;
  };

  Engine.prototype.elapsedMs = function () {
    if (!this.started) return 0;
    var now = this.finished ? this.endedAt : Date.now();
    return Math.max(0, (now - this.startedAt) - this._idleMs(now));
  };

  /* Which rendered line the caret is on, for scrolling. */
  Engine.prototype.currentLineIndex = function () {
    var it = this.currentItem();
    return it ? it.li : (this.lines.length - 1);
  };

  /* --------------------------------------------------------------- input */

  /* Keys whose default browser behaviour must be swallowed: Space scrolls,
     Tab moves focus, / and ' trigger Firefox quick-find, Enter submits.
     Function keys are deliberately NOT swallowed — blocking F5 would be
     surprising, and losing a session is the user's call. */
  var CONSUMABLE = { ' ': 1, 'Tab': 1, 'Backspace': 1, '/': 1, "'": 1, 'Enter': 1 };

  function isConsumableKey(key) {
    return !!CONSUMABLE[key];
  }

  /**
   * Handle one key event.
   * Returns { consumed, ok, kind, expected, typed, advanced, finished }
   */
  Engine.prototype.press = function (ev) {
    var key = ev.key;

    if (this.finished) {
      return { consumed: isConsumableKey(key), ok: false, kind: 'finished' };
    }

    /* An IME is composing: the character is swallowed by the input method and
       must not be counted as a mistake. */
    if (ev.isComposing || ev.keyCode === 229) {
      return { consumed: false, ok: false, kind: 'ime' };
    }

    /* Shift is not a keystroke itself, but which side is held has to be
       recorded — a character event cannot tell you (its location is always 0
       because location describes the key that fired the event, not the held
       modifier). */
    if (key === 'Shift') {
      var side = (ev.location === 1 || ev.code === 'ShiftLeft') ? 'L'
        : ((ev.location === 2 || ev.code === 'ShiftRight') ? 'R' : null);
      if (side) this.shiftSide = side;
      return { consumed: false, ok: false, kind: 'modifier' };
    }

    if (MODIFIER_KEYS[key]) {
      return { consumed: false, ok: false, kind: 'modifier' };
    }

    if (key === 'Escape') {
      return { consumed: false, ok: false, kind: 'escape' };
    }

    if (key === 'Backspace') {
      if (!this.allowBackspace) {
        return { consumed: true, ok: false, kind: 'backspace-blocked' };
      }
      if (!this.started) return { consumed: true, ok: false, kind: 'backspace-idle' };
      var back = this._stepBack();
      if (back) {
        this.backspaces++;
        this._emit('update', this.snapshot());
        return { consumed: true, ok: false, kind: 'backspace', advanced: false };
      }
      return { consumed: true, ok: false, kind: 'backspace-idle' };
    }

    /* Tab only counts as a character when the drill actually wants a tab. */
    if (key === 'Tab') {
      var cur = this.currentItem();
      if (!cur || cur.ch !== '\t') return { consumed: true, ok: false, kind: 'tab-ignored' };
    }

    /* Function keys, arrows, and modifier combinations are never characters. */
    if (key.length !== 1 || ev.ctrlKey || ev.altKey || ev.metaKey) {
      return { consumed: isConsumableKey(key), ok: false, kind: 'non-char' };
    }

    return this._typeChar(key, ev);
  };

  Engine.prototype._stepBack = function () {
    if (this.pos <= 0) return false;
    var p = this.pos - 1;
    while (p >= 0 && !this.items[p].isFocus) p--;
    if (p < 0) return false;
    var it = this.items[p];
    if (!it.done) return false;
    it.done = false;
    /* Retract the first-try credit so firstTryChars and typedCount stay in
       step and the ratio can never exceed 1. Errors already recorded are
       deliberately NOT retracted: Backspace lets you retype, not rewrite
       history. */
    if (it.counted) { it.counted = false; this.firstTryChars--; }
    this.typedCount = Math.max(0, this.typedCount - 1);
    this.pos = p;
    return true;
  };

  Engine.prototype._typeChar = function (key, ev) {
    var item = this.currentItem();
    if (!item) return { consumed: false, ok: false, kind: 'finished' };

    var expected = item.ch;
    var target = item.expected;
    var verdict = Keymap.classify(expected, ev, target, this.shiftSide);

    var now = Date.now();
    var wasStarted = this.started;
    if (!this.started) {
      this.started = true;
      this.startedAt = now;
      this.lastKeyAt = now;
    }
    var latency = now - this.lastKeyAt;

    /* A long gap means the user left. Exclude the part beyond the threshold
       from the clock; the timer freezes rather than being dragged down by an
       idle page. */
    if (wasStarted && latency > IDLE_PAUSE_MS) {
      this.idleMs += latency - IDLE_PAUSE_MS;
    }

    /* Per-key accounting is attributed to the EXPECTED physical key and layer,
       so "your { is weak while your [ is fine" is visible in the statistics. */
    var keyId = target ? (target.code + (target.needsShift ? '+' : '-')) : ('KEY:' + ev.code);
    var delta = this.keyDeltas[keyId];
    if (!delta) {
      delta = this.keyDeltas[keyId] = {
        keyId: keyId,
        code: target ? target.code : ev.code,
        char: expected,
        needsShift: target ? !!target.needsShift : !!ev.shiftKey,
        finger: target ? target.finger : null,
        attempts: 0, errors: 0, latency: []
      };
    }
    delta.attempts++;

    this.totalStrokes++;
    this.lastKeyAt = now;

    var consumed = true;
    var advanced = false;

    if (verdict.ok) {
      /* Wrong Shift side: the character is right but the technique is not.
         Report it, do not penalise accuracy. */
      if (verdict.kind === 'wrong-shift-side') {
        this.wrongShiftCount++;
        this.errorKinds['wrong-shift-side'] = (this.errorKinds['wrong-shift-side'] || 0) + 1;
        this._emit('keystroke', {
          keyId: keyId, code: ev.code, char: expected, expected: expected, typed: key,
          needsShift: target ? !!target.needsShift : false, finger: target ? target.finger : null,
          ok: true, kind: 'wrong-shift-side', detail: verdict.detail,
          latencyMs: null, techniqueOnly: true
        });
      } else {
        this.correctStrokes++;
        /* Response-time sample: the first press of a drill has no predecessor,
           and gaps beyond IDLE_MS are discarded as distractions. */
        var usable = this.typedCount > 0 && latency > 0 && latency <= IDLE_MS;
        if (usable) {
          delta.latency.push(latency);
          if (delta.latency.length > 400) delta.latency.shift();
        }
        this._emit('keystroke', {
          keyId: keyId, code: ev.code, char: expected, expected: expected, typed: key,
          needsShift: target ? !!target.needsShift : false, finger: target ? target.finger : null,
          ok: true, kind: 'correct', detail: null,
          latencyMs: usable ? latency : null,
          firstTry: !item.everWrong
        });
      }

      item.done = true;
      item.lastTyped = key;
      if (!item.everWrong && !item.counted) { item.counted = true; this.firstTryChars++; }
      this.typedCount++;
      this.pos++;
      this._skipNonFocus();
      advanced = true;

      if (this.pos >= this.items.length) {
        this.finished = true;
        this.endedAt = now;
        this._emit('update', this.snapshot());
        var res = this.result();
        this._emit('finish', res);
        return { consumed: true, ok: true, kind: verdict.kind, expected: expected, typed: key, advanced: true, finished: true };
      }
    } else {
      this.errorStrokes++;
      item.everWrong = true;
      item.wrongCount++;
      item.lastTyped = key;
      item.lastKind = verdict.kind;
      this.errorKinds[verdict.kind] = (this.errorKinds[verdict.kind] || 0) + 1;
      delta.errors++;
      /* Confusion pair: expected character ← what was actually typed. Drives
         the "most confused" list and its actionable conclusions. */
      var conf = expected + '\u0000' + key;
      this.confusions[conf] = (this.confusions[conf] || 0) + 1;

      this._emit('keystroke', {
        keyId: keyId, code: ev.code, char: expected, expected: expected, typed: key,
        needsShift: target ? !!target.needsShift : false, finger: target ? target.finger : null,
        ok: false, kind: verdict.kind, detail: verdict.detail,
        latencyMs: null, target: target, pressed: Keymap.keyByCode(ev.code)
      });
    }

    this._emit('update', this.snapshot());
    return {
      consumed: consumed, ok: verdict.ok, kind: verdict.kind, detail: verdict.detail,
      expected: expected, typed: key, target: target,
      advanced: advanced, finished: this.finished, item: item
    };
  };

  /* ------------------------------------------------------------ snapshot */

  Engine.prototype.snapshot = function () {
    var elapsed = this.elapsedMs();
    var minutes = elapsed / 60000;
    var cpm = minutes > 0 ? (this.typedCount / minutes) : 0;
    var focusTotal = this.focusTotal();
    return {
      pos: this.pos,
      total: this.items.length,
      focusTotal: focusTotal,
      typedCount: this.typedCount,
      doneChars: this.typedCount,
      elapsedMs: elapsed,
      cpm: cpm,
      wpm: cpm / 5,
      firstTryRate: this.typedCount ? this.firstTryChars / this.typedCount : 1,
      rawAccuracy: this.totalStrokes ? this.correctStrokes / this.totalStrokes : 1,
      errorStrokes: this.errorStrokes,
      totalStrokes: this.totalStrokes,
      backspaces: this.backspaces,
      wrongShiftCount: this.wrongShiftCount,
      progress: focusTotal ? this.typedCount / focusTotal : 0,
      started: this.started,
      finished: this.finished,
      current: this.currentItem()
    };
  };

  /* -------------------------------------------------------------- result */

  Engine.prototype.result = function () {
    var snap = this.snapshot();
    var keyDeltas = [];
    Object.keys(this.keyDeltas).forEach(function (k) { keyDeltas.push(this.keyDeltas[k]); }, this);

    var confusions = [];
    Object.keys(this.confusions).forEach(function (k) {
      var p = k.split('\u0000');
      confusions.push({ expected: p[0], typed: p[1], count: this.confusions[k] });
    }, this);
    confusions.sort(function (a, b) { return b.count - a.count; });

    return {
      mode: this.meta.mode || 'symbols',
      title: this.meta.title || '',
      seed: this.meta.seed === undefined ? null : this.meta.seed,
      groupIds: this.meta.groupIds || null,
      langs: this.meta.langs || null,
      symbolOnly: this.symbolOnly,
      allowBackspace: this.allowBackspace,
      finishedAt: this.endedAt || Date.now(),
      startedAt: this.startedAt,
      elapsedMs: snap.elapsedMs,
      cpm: snap.cpm,
      wpm: snap.wpm,
      firstTryRate: snap.firstTryRate,
      rawAccuracy: snap.rawAccuracy,
      typedCount: snap.typedCount,
      focusTotal: snap.focusTotal,
      totalStrokes: snap.totalStrokes,
      errorStrokes: snap.errorStrokes,
      backspaces: snap.backspaces,
      wrongShiftCount: snap.wrongShiftCount,
      errorKinds: this.errorKinds,
      keyDeltas: keyDeltas,
      confusions: confusions.slice(0, 12)
    };
  };

  /* -------------------------------------------------- human explanation */

  /**
   * Turn a wrong keystroke into one actionable sentence, including which
   * finger should have been used.
   */
  function explain(res, keymap) {
    var K = keymap || Keymap;
    var t = res.target;
    var out = {
      expected: res.expected,
      typed: res.typed,
      kind: res.kind,
      label: kindLabel(res.kind)
    };

    if (t) {
      out.shouldFinger = K.fingerLabel(t.finger);
      out.shouldKey = tr(t.needsShift && res.expected === t.shifted ? 'layer.upper' : 'layer.lower');
      out.shiftFinger = K.fingerLabel(t.shiftFinger);
    }

    switch (res.kind) {
      case 'missing-shift':
        out.message = tr('engine.explain.missingShift', { ch: res.expected, shiftFinger: out.shiftFinger });
        break;
      case 'extra-shift':
        out.message = tr('engine.explain.extraShift', { ch: res.expected });
        break;
      case 'wrong-shift-side':
        out.message = tr('engine.explain.wrongShiftSide', { shiftFinger: out.shiftFinger });
        break;
      case 'capslock':
        out.message = tr('engine.explain.capslock');
        break;
      case 'wrong-key':
        out.message = tr('engine.explain.wrongKey', {
          charName: K.charName(res.expected),
          layer: out.shouldKey || '',
          finger: out.shouldFinger || ''
        });
        break;
      case 'same-key':
        out.message = tr('engine.explain.sameKey');
        break;
      default:
        out.message = tr('engine.explain.other');
    }
    return out;
  }

  TD.Engine = Engine;
  TD.Engine.KIND_LABEL = KIND_LABEL;
  TD.Engine.KIND_IDS = KIND_IDS;
  TD.Engine.kindLabel = kindLabel;
  TD.Engine.explain = explain;
  TD.Engine.IDLE_MS = IDLE_MS;
  TD.Engine.IDLE_PAUSE_MS = IDLE_PAUSE_MS;
})(window.TD);
