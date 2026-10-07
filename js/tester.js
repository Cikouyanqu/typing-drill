/* ==========================================================================
   tester.js — keyboard tester

   A diagnostic view, separate from the drill: press any key and see whether it
   registers, how many times, whether it double-fires, and whether it produces
   the character its position implies.

   Three parts, deliberately separable:

     1. `State` — a pure state machine. It never touches the DOM and takes an
        injectable clock, so key handling, chatter detection, APM and mismatch
        detection are all covered by the Node test run.
     2. Layout data — the full 104-key board decomposed into four blocks
        (fn / main / nav / numpad) so the layout variants compose by block.
        The main block REUSES Keymap.ROWS, so the tester and the drill can
        never disagree about where a key is.
     3. `mount()` — DOM rendering and window listeners, returning a destroy
        handle so leaving the view removes the listeners.

   Two things that are easy to get wrong and are handled explicitly:
   · the operating system's key repeat (`ev.repeat`) must never count as
     chatter, or holding any key would be flagged;
   · the "held" set must be cleared when the window loses focus, or a key held
     while alt-tabbing away stays lit forever.
   ========================================================================== */

window.TD = window.TD || {};
(function (TD) {
  'use strict';

  var util = TD.util;
  var Keymap = TD.Keymap;

  function tr(key, params) {
    return TD.I18n ? TD.I18n.t(key, params) : key;
  }

  var DEFAULT_CHATTER_MS = 30;   /* re-triggering sooner than this after release is chatter */
  var APM_WINDOW_MS = 60000;
  var APM_MIN_WINDOW_MS = 1000;  /* floor on the divisor, so a burst in the first
                                    milliseconds cannot extrapolate to absurd figures */
  var MAX_LOG = 40;
  var MAX_DOWN_TIMES = 800;
  var LOCKS = ['CapsLock', 'NumLock', 'ScrollLock'];

  /* ============================================================ layout */

  /* 1u = 4 grid columns, the same unit the drill keyboard uses. */

  /* Function row: 18u wide, which is wider than the 15u main block — that is
     how a real board looks, so the row is given its own grid. Each entry is
     1u and the gaps are what create the familiar F1-F4 / F5-F8 grouping. */
  var FN_KEYS = [
    { code: 'Escape', label: 'ESC', c: 1 },
    { code: 'F1', label: 'F1', c: 7 },
    { code: 'F2', label: 'F2', c: 11 },
    { code: 'F3', label: 'F3', c: 15 },
    { code: 'F4', label: 'F4', c: 19 },
    { code: 'F5', label: 'F5', c: 25 },
    { code: 'F6', label: 'F6', c: 29 },
    { code: 'F7', label: 'F7', c: 33 },
    { code: 'F8', label: 'F8', c: 37 },
    { code: 'F9', label: 'F9', c: 43 },
    { code: 'F10', label: 'F10', c: 47 },
    { code: 'F11', label: 'F11', c: 51 },
    { code: 'F12', label: 'F12', c: 55 },
    { code: 'PrintScreen', label: 'PRTSC', c: 61 },
    { code: 'ScrollLock', label: 'SCR', c: 65 },
    { code: 'Pause', label: 'PAUSE', c: 69 }
  ];
  var FN_COLUMNS = 72;   /* 18u */

  /* Navigation cluster: 3 columns x 4 rows, with the up arrow alone in the
     middle of its row — explicit placement is far more readable than relying
     on grid auto-flow with holes. */
  var NAV_KEYS = [
    { code: 'Insert', label: 'INS', r: 1, c: 1 },
    { code: 'Home', label: 'HOME', r: 1, c: 2 },
    { code: 'PageUp', label: 'PGUP', r: 1, c: 3 },
    { code: 'Delete', label: 'DEL', r: 2, c: 1 },
    { code: 'End', label: 'END', r: 2, c: 2 },
    { code: 'PageDown', label: 'PGDN', r: 2, c: 3 },
    { code: 'ArrowUp', label: '↑', r: 3, c: 2 },
    { code: 'ArrowLeft', label: '←', r: 4, c: 1 },
    { code: 'ArrowDown', label: '↓', r: 4, c: 2 },
    { code: 'ArrowRight', label: '→', r: 4, c: 3 }
  ];
  var NAV_COLUMNS = 12;  /* 3u */

  /* Numpad: 4 columns x 5 rows, with + and Enter spanning two rows and 0 two
     columns. */
  var NUMPAD_KEYS = [
    { code: 'NumLock', label: 'NUM', r: 1, c: 1 },
    { code: 'NumpadDivide', label: '/', r: 1, c: 2 },
    { code: 'NumpadMultiply', label: '*', r: 1, c: 3 },
    { code: 'NumpadSubtract', label: '−', r: 1, c: 4 },
    { code: 'Numpad7', label: '7', r: 2, c: 1 },
    { code: 'Numpad8', label: '8', r: 2, c: 2 },
    { code: 'Numpad9', label: '9', r: 2, c: 3 },
    { code: 'NumpadAdd', label: '+', r: 2, c: 4, rh: 2 },
    { code: 'Numpad4', label: '4', r: 3, c: 1 },
    { code: 'Numpad5', label: '5', r: 3, c: 2 },
    { code: 'Numpad6', label: '6', r: 3, c: 3 },
    { code: 'Numpad1', label: '1', r: 4, c: 1 },
    { code: 'Numpad2', label: '2', r: 4, c: 2 },
    { code: 'Numpad3', label: '3', r: 4, c: 3 },
    { code: 'NumpadEnter', label: 'ENTER', r: 4, c: 4, rh: 2 },
    { code: 'Numpad0', label: '0', r: 5, c: 1, cw: 2 },
    { code: 'NumpadDecimal', label: '.', r: 5, c: 3 }
  ];
  var NUMPAD_COLUMNS = 16;  /* 4u */

  /* Blocks per layout variant. The counts come out exactly right:
     16 + 61 + 10 + 17 = 104, minus the numpad = 87, main alone = 61. */
  var VARIANTS = [
    { id: 'full', blocks: ['fn', 'main', 'nav', 'numpad'], keys: 104 },
    { id: 'tkl', blocks: ['fn', 'main', 'nav'], keys: 87 },
    { id: 'compact', blocks: ['main'], keys: 61 }
  ];

  var BY_VARIANT = Object.create(null);
  VARIANTS.forEach(function (v) { BY_VARIANT[v.id] = v; });

  /* All physical codes the main block covers, taken from the drill's own key
     map so the two views cannot drift apart. */
  function mainCodes() {
    var out = [];
    Keymap.ROWS.forEach(function (row) {
      row.forEach(function (k) { out.push(k.code); });
    });
    return out;
  }

  /* Every code a variant shows, for coverage arithmetic. */
  function codesOf(variantId) {
    var v = BY_VARIANT[variantId] || VARIANTS[0];
    var out = [];
    v.blocks.forEach(function (block) {
      if (block === 'fn') FN_KEYS.forEach(function (k) { out.push(k.code); });
      else if (block === 'main') out = out.concat(mainCodes());
      else if (block === 'nav') NAV_KEYS.forEach(function (k) { out.push(k.code); });
      else if (block === 'numpad') NUMPAD_KEYS.forEach(function (k) { out.push(k.code); });
    });
    return out;
  }

  /* ======================================================== state machine */

  /**
   * opts: { now: () => ms, chatterMs: number }
   * The clock is injectable so APM and chatter timing are testable exactly.
   */
  function State(opts) {
    opts = opts || {};
    this.now = opts.now || function () { return Date.now(); };
    this.chatterMs = opts.chatterMs === undefined ? DEFAULT_CHATTER_MS : opts.chatterMs;
    this.reset();
  }

  State.prototype.reset = function () {
    this.held = Object.create(null);       /* code -> true, currently down */
    this.count = Object.create(null);      /* code -> keydowns counted (repeats excluded) */
    this.lastDown = Object.create(null);   /* code -> last keydown timestamp */
    this.lastUp = Object.create(null);     /* code -> last keyup timestamp */
    this.chatter = Object.create(null);    /* code -> chatter event count */
    this.mismatch = Object.create(null);   /* code -> { expected, actual, count } */
    this.locks = { CapsLock: false, NumLock: false, ScrollLock: false };
    this.maxHeld = 0;
    this.totalDown = 0;
    this.repeats = 0;
    this.last = null;
    this.log = [];                          /* flagged events, newest first */
    this.downTimes = [];                    /* timestamps inside the APM window */
    this.startedAt = this.now();
    return this;
  };

  State.prototype._log = function (kind, code, detail) {
    this.log.unshift({ kind: kind, code: code, detail: detail, at: this.now() });
    if (this.log.length > MAX_LOG) this.log.length = MAX_LOG;
  };

  State.prototype._readLocks = function (ev) {
    if (!ev || typeof ev.getModifierState !== 'function') return;
    for (var i = 0; i < LOCKS.length; i++) {
      try { this.locks[LOCKS[i]] = !!ev.getModifierState(LOCKS[i]); } catch (e) { /* leave as is */ }
    }
  };

  State.prototype._lastInfo = function (ev, isUp) {
    var def = Keymap.keyByCode(ev.code);
    return {
      code: ev.code,
      key: ev.key,
      up: !!isUp,
      repeat: !!ev.repeat,
      shift: !!ev.shiftKey,
      ctrl: !!ev.ctrlKey,
      alt: !!ev.altKey,
      meta: !!ev.metaKey,
      known: !!def,
      expected: def && def.base
        ? (ev.shiftKey && def.shifted ? def.shifted : def.base)
        : null,
      location: ev.location === 1 ? 'left' : (ev.location === 2 ? 'right' : 'standard')
    };
  };

  /**
   * Compare what this physical key should produce with what it did produce.
   * Only meaningful for the main block, whose codes are in the key map, and
   * only when no shortcut modifier is held. The baseline is the US layout.
   */
  State.prototype._checkMismatch = function (ev) {
    if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.isComposing) return null;
    if (typeof ev.key !== 'string' || ev.key.length !== 1) return null;
    var def = Keymap.keyByCode(ev.code);
    if (!def || !def.base) return null;
    var expected = ev.shiftKey && def.shifted ? def.shifted : def.base;
    if (!expected) return null;
    if (ev.key === expected) return null;
    /* Caps Lock legitimately changes the case of a letter. */
    if (/[A-Za-z]/.test(expected) && expected.toLowerCase() === ev.key.toLowerCase()) return null;
    return { expected: expected, actual: ev.key };
  };

  State.prototype.keyDown = function (ev) {
    var now = this.now();
    this._readLocks(ev);
    var code = ev.code;

    if (ev.repeat) {
      /* The OS key repeat. Holding a key fires a stream of these; counting
         them as chatter would flag every held key, so they are only tallied. */
      this.repeats++;
      this.last = this._lastInfo(ev, false);
      return { code: code, repeat: true, chatter: null, mismatch: null };
    }

    var chatter = null;
    if (this.held[code]) {
      /* Still held and firing again: the switch never released. */
      chatter = { rule: 'no-release', gap: now - (this.lastDown[code] || now) };
    } else if (this.lastUp[code] !== undefined && (now - this.lastUp[code]) < this.chatterMs) {
      /* Released, then re-triggered almost immediately: debounce failed. */
      chatter = { rule: 'too-fast', gap: now - this.lastUp[code] };
    }

    this.held[code] = true;
    this.count[code] = (this.count[code] || 0) + 1;
    this.lastDown[code] = now;
    this.totalDown++;
    this.downTimes.push(now);
    if (this.downTimes.length > MAX_DOWN_TIMES) {
      this.downTimes.splice(0, this.downTimes.length - MAX_DOWN_TIMES);
    }

    var heldCount = 0;
    for (var k in this.held) { if (this.held[k]) heldCount++; }
    if (heldCount > this.maxHeld) this.maxHeld = heldCount;

    if (chatter) {
      this.chatter[code] = (this.chatter[code] || 0) + 1;
      this._log('chatter', code, chatter);
    }

    var mismatch = this._checkMismatch(ev);
    if (mismatch) {
      var m = this.mismatch[code];
      if (!m) m = this.mismatch[code] = { expected: mismatch.expected, actual: mismatch.actual, count: 0 };
      m.actual = mismatch.actual;
      m.count++;
      this._log('mismatch', code, mismatch);
    }

    this.last = this._lastInfo(ev, false);
    return { code: code, repeat: false, chatter: chatter, mismatch: mismatch };
  };

  State.prototype.keyUp = function (ev) {
    this._readLocks(ev);
    if (ev.repeat) return { code: ev.code, repeat: true };
    delete this.held[ev.code];
    this.lastUp[ev.code] = this.now();
    this.last = this._lastInfo(ev, true);
    return { code: ev.code, repeat: false };
  };

  /* Called when the window loses focus: keys released outside the page would
     otherwise stay lit forever. Deliberately does NOT set lastUp, so the next
     press is not judged against a timestamp we never observed. */
  State.prototype.clearHeld = function () {
    var cleared = Object.keys(this.held);
    this.held = Object.create(null);
    return cleared;
  };

  /* The Win and Menu keys are captured by the operating system and cannot be
     measured reliably, so they can be marked by hand. */
  State.prototype.markTested = function (codes) {
    var marked = [];
    codes.forEach(function (code) {
      if (!this.count[code]) { this.count[code] = 1; marked.push(code); }
    }, this);
    if (marked.length) this._log('manual', marked.join(', '), { rule: 'manual' });
    return marked;
  };

  State.prototype.heldCount = function () {
    var n = 0;
    for (var k in this.held) { if (this.held[k]) n++; }
    return n;
  };

  /**
   * Real-time trigger rate: a rolling window over the last minute, and while
   * the session is younger than that the rate is extrapolated — otherwise a
   * fresh session would always read a misleading near-zero.
   *
   * The divisor has a one-second floor. Without it, a burst of presses in the
   * opening milliseconds divides by an almost-zero window and reports figures
   * in the hundreds of thousands, which says nothing useful.
   */
  State.prototype.apm = function () {
    var now = this.now();
    var cutoff = now - APM_WINDOW_MS;
    var recent = 0;
    for (var i = this.downTimes.length - 1; i >= 0; i--) {
      if (this.downTimes[i] >= cutoff) recent++;
      else break;   /* downTimes is appended in ascending order */
    }
    var elapsed = Math.max(now - this.startedAt, APM_MIN_WINDOW_MS);
    var window = Math.min(APM_WINDOW_MS, elapsed);
    return Math.round((recent / window) * APM_WINDOW_MS);
  };

  State.prototype.coverage = function (codes) {
    var pressed = 0;
    for (var i = 0; i < codes.length; i++) {
      if (this.count[codes[i]]) pressed++;
    }
    return {
      pressed: pressed,
      total: codes.length,
      rate: codes.length ? pressed / codes.length : 0
    };
  };

  State.prototype.chatterList = function () {
    return Object.keys(this.chatter).map(function (code) {
      return { code: code, count: this.chatter[code] };
    }, this).sort(function (a, b) { return b.count - a.count; });
  };

  State.prototype.mismatchList = function () {
    return Object.keys(this.mismatch).map(function (code) {
      var m = this.mismatch[code];
      return { code: code, expected: m.expected, actual: m.actual, count: m.count };
    }, this).sort(function (a, b) { return b.count - a.count; });
  };

  State.prototype.stats = function (codes) {
    var chatter = this.chatterList();
    var mismatch = this.mismatchList();
    var chatterTotal = 0;
    chatter.forEach(function (c) { chatterTotal += c.count; });
    return {
      totalDown: this.totalDown,
      repeats: this.repeats,
      heldCount: this.heldCount(),
      maxHeld: this.maxHeld,
      apm: this.apm(),
      elapsedMs: this.now() - this.startedAt,
      locks: { CapsLock: this.locks.CapsLock, NumLock: this.locks.NumLock, ScrollLock: this.locks.ScrollLock },
      last: this.last,
      log: this.log,
      coverage: codes ? this.coverage(codes) : null,
      chatter: chatter,
      chatterTotal: chatterTotal,
      mismatch: mismatch
    };
  };

  /* =============================================================== view */

  /* Keys whose default browser behaviour must be prevented while testing.
     Function keys are included so a stray F5 does not reload and wipe the
     results; Ctrl+R still works as the escape hatch. */
  function shouldPrevent(ev) {
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return false;   /* leave shortcuts alone */
    var k = ev.key;
    if (k === ' ' || k === 'Tab' || k === 'Enter' || k === 'Backspace' ||
        k === '/' || k === "'" || k === 'F1' || k === 'F2' || k === 'F3' ||
        k === 'F4' || k === 'F5' || k === 'F6' || k === 'F7' || k === 'F8' ||
        k === 'F9' || k === 'F10') {
      return true;
    }
    return false;
  }

  /* The state object outlives the view. Leaving to check something else and
     coming back must not throw away a half-finished test; "Reset" is the
     explicit way to clear it. Listeners, by contrast, are always detached on
     leave so other views are not monitored. */
  var lastState = null;

  /* The listeners this view attaches live on window, so a mount that happens
     without the previous one being destroyed would double-count every
     keypress. Views are supposed to be torn down before re-rendering, and the
     language switch used not to — hence this guard: whichever mount came
     before, it is destroyed before the new one attaches anything. */
  var activeMount = null;

  function mount(container, ctx) {
    ctx = ctx || {};
    if (activeMount) {
      activeMount.destroy();
      activeMount = null;
    }
    var store = ctx.store;
    var settings = store ? store.settings : {};
    var variantId = BY_VARIANT[settings.testerLayout] ? settings.testerLayout : 'full';
    var sound = !!settings.testerSound;

    var state = (!ctx.fresh && lastState) ? lastState : new State();
    lastState = state;
    var els = Object.create(null);     /* code -> key element */
    var refs = Object.create(null);
    var destroyed = false;

    /* ------------------------------------------------------- structure */

    var wrap = util.el('div', { class: 'tk-wrap' });

    function keyEl(spec) {
      var node = util.el('div', { class: 'tk-key', 'data-code': spec.code });
      if (spec.width) node.style.gridColumn = 'span ' + spec.width;
      if (spec.area) node.style.gridArea = spec.area;
      if (spec.home) node.setAttribute('data-home', 'true');
      node.appendChild(util.el('span', { class: 'tk-count' }));
      node.appendChild(util.el('span', { class: 'tk-flags' }));
      return node;
    }

    /* A multi-character legend is a NAME (ESC, PGUP, ENTER) and takes the
       smaller named-label style; a single character is a legend proper and
       keeps the larger one. Getting this wrong makes long legends overflow
       their 1u key. */
    function labelSpan(text) {
      return util.el('span', { class: text.length > 1 ? 'k-name' : 'k-base', text: text });
    }

    function buildFnRow() {
      var grid = util.el('div', { class: 'tk-grid-row tk-top' });
      FN_KEYS.forEach(function (k) {
        var node = keyEl({ code: k.code, width: 4, area: '1 / ' + k.c + ' / 2 / span 4' });
        node.appendChild(labelSpan(k.label));
        grid.appendChild(node);
        els[k.code] = node;
      });
      return grid;
    }

    function buildMainBlock() {
      var grid = util.el('div', { class: 'tk-grid-row tk-main' });
      Keymap.ROWS.forEach(function (row) {
        row.forEach(function (k) {
          var def = Keymap.keyByCode(k.code);
          var node = keyEl({ code: k.code, width: Math.round((k.w || 1) * 4), home: k.home });
          if (def.name) {
            node.appendChild(util.el('span', { class: 'k-name', text: def.legendKey ? tr(def.legendKey) : def.name }));
          } else {
            if (def.shifted) node.appendChild(util.el('span', { class: 'k-shift', text: def.shifted }));
            node.appendChild(util.el('span', { class: 'k-base', text: def.base === ' ' ? '␣' : def.base }));
          }
          grid.appendChild(node);
          els[k.code] = node;
        });
      });
      return grid;
    }

    /* NAV_KEYS and NUMPAD_KEYS give positions in KEY units (column 1, 2, 3 …),
       but the grid is drawn in quarter-unit columns. Both have to be scaled by
       4, or every key would occupy a single 7px column instead of a 1u key. */
    var COLS_PER_U = 4;

    function buildPlacedBlock(cls, columns, keys) {
      var grid = util.el('div', { class: 'tk-grid-row ' + cls });
      grid.style.gridTemplateColumns = 'repeat(' + columns + ', minmax(0, 1fr))';
      keys.forEach(function (k) {
        var startCol = (k.c - 1) * COLS_PER_U + 1;
        var area = k.r + ' / ' + startCol + ' / span ' + (k.rh || 1) +
          ' / span ' + ((k.cw || 1) * COLS_PER_U);
        var node = keyEl({ code: k.code, area: area });
        node.appendChild(labelSpan(k.label));
        grid.appendChild(node);
        els[k.code] = node;
      });
      return grid;
    }

    function buildBoard() {
      util.clear(wrap);
      els = Object.create(null);
      var variant = BY_VARIANT[variantId];
      var board = util.el('div', { class: 'tk-board' });

      if (variant.blocks.indexOf('fn') !== -1) board.appendChild(buildFnRow());

      var bottom = util.el('div', { class: 'tk-bottom' });
      variant.blocks.forEach(function (block) {
        if (block === 'main') bottom.appendChild(buildMainBlock());
        else if (block === 'nav') bottom.appendChild(buildPlacedBlock('tk-nav', NAV_COLUMNS, NAV_KEYS));
        else if (block === 'numpad') bottom.appendChild(buildPlacedBlock('tk-pad', NUMPAD_COLUMNS, NUMPAD_KEYS));
      });
      board.appendChild(bottom);
      wrap.appendChild(board);
      return board;
    }

    /* ----------------------------------------------------------- readouts */

    var root = util.el('div', { class: 'stack-lg' });

    var bar = util.el('div', { class: 'card' });
    var layoutSeg, soundLabel, resetBtn;
    bar.appendChild(util.el('div', { class: 'row row-wrap' }, [
      util.el('span', { class: 't-caption mute nowrap', text: tr('keytest.layout.label') }),
      layoutSeg = TD.UI.seg(
        VARIANTS.map(function (v) { return { value: v.id, label: tr('keytest.layout.' + v.id) }; }),
        variantId,
        function (v) {
          variantId = v;
          if (store) store.setSetting('testerLayout', v);
          buildBoard();
          paintAll();
          paintReadouts();
        }
      ),
      util.el('span', { class: 'spacer' }),
      soundLabel = (function () {
        var input = util.el('input', { type: 'checkbox' });
        input.checked = sound;
        input.addEventListener('change', function () {
          sound = input.checked;
          if (store) store.setSetting('testerSound', sound);
        });
        return util.el('label', { class: 'check', title: tr('keytest.soundTitle') }, [
          input, util.el('span', { class: 'check-box' }), util.el('span', { class: 'text', text: tr('keytest.sound') })
        ]);
      })(),
      resetBtn = util.el('button', {
        class: 'btn btn-secondary', type: 'button', text: tr('keytest.btn.reset'),
        onclick: function () {
          state.reset();
          paintAll();
          paintReadouts();
        }
      })
    ]));
    root.appendChild(bar);

    /* Stat strip */
    refs.stat = {};
    var strip = util.el('div', { class: 'tk-stats' });
    [
      ['coverage', tr('keytest.stat.coverage'), null],
      ['apm', tr('keytest.stat.apm'), tr('keytest.stat.apmTitle')],
      ['total', tr('keytest.stat.total'), null],
      ['nkro', tr('keytest.stat.nkro'), tr('keytest.stat.nkroTitle')],
      ['locks', tr('keytest.stat.locks'), null]
    ].forEach(function (pair) {
      var value = util.el('span', { class: 'hud-value', text: tr('common.dash') });
      refs.stat[pair[0]] = value;
      var cell = util.el('div', { class: 'hud-cell' }, [
        util.el('span', { class: 'hud-label', text: pair[1] }),
        value
      ]);
      if (pair[2]) cell.setAttribute('title', pair[2]);
      strip.appendChild(cell);
    });
    root.appendChild(strip);

    root.appendChild(wrap);
    root.appendChild(util.el('div', { class: 'kb-legend tk-legend' }));

    /* Last key + flags */
    var detail = util.el('div', { class: 'card' });
    refs.detail = util.el('div', { class: 'tk-detail' });
    detail.appendChild(refs.detail);
    root.appendChild(detail);

    /* Chatter / mismatch lists */
    var flags = util.el('div', { class: 'grid-2' });
    refs.chatter = util.el('div', { class: 'card' });
    refs.mismatch = util.el('div', { class: 'card' });
    flags.appendChild(refs.chatter);
    flags.appendChild(refs.mismatch);
    root.appendChild(flags);

    /* Browser limits, stated plainly like the reference does. */
    root.appendChild(TD.UI.banner({
      kind: 'info',
      title: tr('keytest.limit.title'),
      detail: tr('keytest.limit.body'),
      actions: [
        { text: tr('keytest.btn.markWin'), onClick: function () { markAndPaint(['MetaLeft', 'MetaRight']); } },
        { text: tr('keytest.btn.markMenu'), onClick: function () { markAndPaint(['ContextMenu']); } }
      ]
    }));

    container.appendChild(root);
    buildBoard();

    /* ---------------------------------------------------------- painting */

    var STATE_ATTRS = ['data-pressed', 'data-active', 'data-chatter', 'data-mismatch'];

    function paintKey(code) {
      var node = els[code];
      if (!node) return;
      STATE_ATTRS.forEach(function (a) { node.removeAttribute(a); });
      var count = state.count[code] || 0;
      if (state.held[code]) node.setAttribute('data-active', 'true');
      else if (count) node.setAttribute('data-pressed', 'true');
      if (state.chatter[code]) node.setAttribute('data-chatter', 'true');
      if (state.mismatch[code]) node.setAttribute('data-mismatch', 'true');
      node.querySelector('.tk-count').textContent = count > 0 ? String(count) : '';
      var m = state.mismatch[code];
      var flags = node.querySelector('.tk-flags');
      util.clear(flags);
      if (state.chatter[code]) {
        flags.appendChild(util.el('span', {
          class: 'tk-flag tk-flag-chatter',
          title: tr('keytest.flag.chatter', { n: state.chatter[code] })
        }));
      }
      if (m) {
        flags.appendChild(util.el('span', {
          class: 'tk-flag tk-flag-mismatch',
          title: tr('keytest.flag.mismatch', { expected: m.expected, actual: m.actual })
        }));
      }
    }

    function paintAll() {
      Object.keys(els).forEach(paintKey);
    }

    function markAndPaint(codes) {
      state.markTested(codes);
      codes.forEach(paintKey);
      paintReadouts();
    }

    function paintReadouts() {
      var codes = codesOf(variantId);
      var s = state.stats(codes);

      refs.stat.coverage.textContent = tr('keytest.coverage.value', {
        pressed: s.coverage.pressed, total: s.coverage.total
      });
      refs.stat.coverage.parentNode.setAttribute('data-tone',
        s.coverage.rate >= 1 ? 'ok' : '');
      refs.stat.apm.textContent = String(s.apm);
      refs.stat.total.textContent = String(s.totalDown);
      refs.stat.nkro.textContent = tr('keytest.nkro.value', { held: s.heldCount, max: s.maxHeld });
      refs.stat.locks.textContent = LOCKS.map(function (k) {
        return tr('keytest.lock.' + k) + (s.locks[k] ? ' ●' : ' ○');
      }).join('  ');

      /* last key */
      util.clear(refs.detail);
      var last = s.last;
      refs.detail.appendChild(util.el('div', { class: 'card-head' }, [
        util.el('span', { class: 't-title-sm', text: tr('keytest.last.title') })
      ]));
      if (!last) {
        refs.detail.appendChild(util.el('div', { class: 't-body-sm mute', text: tr('keytest.last.none') }));
      } else {
        refs.detail.appendChild(util.el('div', { class: 'row row-wrap' }, [
          util.el('span', { class: 'badge badge-primary mono', text: last.code }),
          util.el('span', { class: 'badge badge-neutral mono', text: last.key === ' ' ? '␣' : last.key }),
          util.el('span', { class: 'badge badge-neutral', text: tr('keytest.loc.' + last.location) }),
          last.repeat ? util.el('span', { class: 'badge badge-warning', text: tr('keytest.last.repeat') }) : null,
          last.expected && last.expected !== last.key && !last.ctrl && !last.alt && !last.meta
            ? util.el('span', {
                class: 'badge badge-warning',
                text: tr('keytest.last.expected', { expected: last.expected })
              })
            : null,
          util.el('span', { class: 'spacer' }),
          util.el('span', { class: 't-body-sm mute', text: tr('keytest.last.hint') })
        ]));
      }

      /* chatter card */
      util.clear(refs.chatter);
      refs.chatter.appendChild(util.el('div', { class: 'card-head' }, [
        util.el('span', { class: 't-title-sm', text: tr('keytest.chatter.title') }),
        util.el('span', {
          class: 'badge ' + (s.chatter.length ? 'badge-error' : 'badge-success'),
          text: tr('common.times', { n: s.chatterTotal })
        }),
        util.el('span', { class: 'spacer' }),
        util.el('span', { class: 't-body-sm mute', text: tr('keytest.chatter.rule', { ms: state.chatterMs }) })
      ]));
      if (!s.chatter.length) {
        refs.chatter.appendChild(util.el('div', { class: 't-body-sm mute', text: tr('keytest.chatter.none') }));
      } else {
        var cl = util.el('div', { class: 'list' });
        s.chatter.forEach(function (c) {
          cl.appendChild(util.el('div', { class: 'list-row' }, [
            util.el('span', { class: 'badge badge-error mono', text: c.code }),
            util.el('span', { class: 'spacer' }),
            util.el('span', { class: 't-body-sm', text: tr('common.times', { n: c.count }) })
          ]));
        });
        refs.chatter.appendChild(cl);
      }

      /* mismatch card */
      util.clear(refs.mismatch);
      refs.mismatch.appendChild(util.el('div', { class: 'card-head' }, [
        util.el('span', { class: 't-title-sm', text: tr('keytest.mismatch.title') }),
        util.el('span', {
          class: 'badge ' + (s.mismatch.length ? 'badge-warning' : 'badge-success'),
          text: tr('common.times', { n: s.mismatch.length })
        })
      ]));
      refs.mismatch.appendChild(util.el('div', { class: 't-body-sm mute', style: { 'margin-bottom': '8px' },
        text: tr('keytest.mismatch.baseline') }));
      if (!s.mismatch.length) {
        refs.mismatch.appendChild(util.el('div', { class: 't-body-sm mute', text: tr('keytest.mismatch.none') }));
      } else {
        var ml = util.el('div', { class: 'list' });
        s.mismatch.forEach(function (m) {
          ml.appendChild(util.el('div', { class: 'list-row' }, [
            util.el('span', { class: 'badge badge-neutral mono', text: m.code }),
            util.el('span', { class: 'mono', text: m.expected === ' ' ? '␣' : m.expected }),
            util.el('span', { class: 'mute', text: '→' }),
            util.el('span', { class: 'mono', style: { color: 'var(--color-error)' }, text: m.actual === ' ' ? '␣' : m.actual }),
            util.el('span', { class: 'spacer' }),
            util.el('span', { class: 't-body-sm mute', text: tr('common.times', { n: m.count }) })
          ]));
        });
        refs.mismatch.appendChild(ml);
      }

      /* legend */
      var legend = wrap.parentNode.querySelector('.tk-legend');
      if (legend) {
        util.clear(legend);
        [
          ['tk-swatch-active', tr('keytest.legend.active')],
          ['tk-swatch-pressed', tr('keytest.legend.pressed')],
          ['tk-swatch-never', tr('keytest.legend.never')],
          ['tk-swatch-chatter', tr('keytest.legend.chatter')],
          ['tk-swatch-mismatch', tr('keytest.legend.mismatch')]
        ].forEach(function (pair) {
          legend.appendChild(util.el('span', { class: 'kb-legend-item' }, [
            util.el('span', { class: 'kb-swatch ' + pair[0] }),
            util.el('span', { text: pair[1] })
          ]));
        });
      }
    }

    /* ------------------------------------------------------------ events */

    var apmTimer = setInterval(function () {
      if (destroyed) return;
      refs.stat.apm.textContent = String(state.apm());
      refs.stat.nkro.textContent = tr('keytest.nkro.value', {
        held: state.heldCount(), max: state.maxHeld
      });
    }, 1000);

    function onKeyDown(ev) {
      if (shouldPrevent(ev)) ev.preventDefault();
      var res = state.keyDown(ev);
      if (!res.repeat && sound) util.click();
      paintKey(ev.code);
      paintReadouts();
    }

    function onKeyUp(ev) {
      if (shouldPrevent(ev)) ev.preventDefault();
      state.keyUp(ev);
      paintKey(ev.code);
      paintReadouts();
    }

    function onBlur() {
      var cleared = state.clearHeld();
      if (!cleared.length) return;
      cleared.forEach(paintKey);
      paintReadouts();
    }

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onBlur);

    paintAll();
    paintReadouts();

    var handle = {
      state: state,
      /* Leaving the view must detach everything: otherwise arrow keys on the
         statistics page would keep feeding this tester's counters. */
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        clearInterval(apmTimer);
        window.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('keyup', onKeyUp, true);
        window.removeEventListener('blur', onBlur);
        document.removeEventListener('visibilitychange', onBlur);
        if (activeMount === handle) activeMount = null;
      }
    };
    activeMount = handle;
    return handle;
  }

  TD.Tester = {
    State: State,
    VARIANTS: VARIANTS,
    FN_KEYS: FN_KEYS,
    NAV_KEYS: NAV_KEYS,
    NUMPAD_KEYS: NUMPAD_KEYS,
    DEFAULT_CHATTER_MS: DEFAULT_CHATTER_MS,
    APM_WINDOW_MS: APM_WINDOW_MS,
    byVariant: function (id) { return BY_VARIANT[id] || null; },
    codesOf: codesOf,
    mainCodes: mainCodes,
    mount: mount,
    shouldPrevent: shouldPrevent
  };
})(window.TD);
