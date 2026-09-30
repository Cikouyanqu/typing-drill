/* ==========================================================================
   cases.js — assertion cases (shared by Node and the browser, so the two
   runners can never drift apart)

   Each case is fn(t, TD) where t provides ok / eq / notEq / near / skip.
   Cases depend on window.TD only and never touch a real DOM, except the one
   keyboard case, which skips itself when no document is present.
   ========================================================================== */

window.TD = window.TD || {};
(function (TD) {
  'use strict';

  var CASES = [];

  function test(name, fn) { CASES.push({ name: name, fn: fn }); }

  /* ------------------------------------------------------------- helpers */

  /* Build a duck-typed key event. Defaults describe the CORRECT keystroke:
     Shift is held when the character needs it. */
  function ev(key, opts) {
    opts = opts || {};
    var K = TD.Keymap;
    var info = K.lookup(key);
    var code = opts.code || (info ? info.code
      : (/^[A-Za-z]$/.test(key) ? 'Key' + key.toUpperCase() : 'KeyQ'));
    var shift = opts.shift !== undefined ? opts.shift : (info ? !!info.needsShift : false);
    return {
      key: key,
      code: code,
      shiftKey: shift,
      location: opts.location || 0,
      ctrlKey: !!opts.ctrl,
      altKey: !!opts.alt,
      metaKey: !!opts.meta,
      isComposing: !!opts.ime,
      keyCode: opts.keyCode || 0,
      getModifierState: function (n) { return n === 'CapsLock' ? !!opts.capsLock : false; }
    };
  }

  function shiftEv(side) {
    return {
      key: 'Shift',
      code: side === 'L' ? 'ShiftLeft' : 'ShiftRight',
      shiftKey: true,
      location: side === 'L' ? 1 : 2,
      getModifierState: function () { return false; }
    };
  }

  /* Press one character, holding the correct Shift side first if needed. */
  function typeChar(engine, ch, shiftSide) {
    var info = TD.Keymap.lookup(ch);
    if (info && info.needsShift) {
      engine.press(shiftEv(shiftSide || info.shiftSide || 'L'));
    }
    return engine.press(ev(ch));
  }

  /* Controllable clock: the engine times with Date.now(), and CPM assertions
     need exact arithmetic. */
  function fakeClock(start) {
    var t = start === undefined ? 1700000000000 : start;
    var orig = Date.now;
    Date.now = function () { return t; };
    return {
      tick: function (ms) { t += ms; },
      at: function () { return t; },
      restore: function () { Date.now = orig; }
    };
  }

  /* localStorage stand-in */
  function memoryLS() {
    var m = Object.create(null);
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; },
      _dump: m
    };
  }

  function throwingLS() {
    var boom = function () { var e = new Error('denied by policy'); e.name = 'SecurityError'; throw e; };
    return { getItem: boom, setItem: boom, removeItem: boom };
  }

  /* Can window.localStorage be replaced with a stand-in? Implementations
     differ: Chrome allows the override, Firefox exposes localStorage as a
     read-only property and the assignment silently does nothing. When it
     cannot be replaced the affected cases must report "skipped" rather than
     failing — otherwise the suite would be lying. */
  function canStubLocalStorage() {
    var orig = window.localStorage;
    try {
      var shim = memoryLS();
      window.localStorage = shim;
      var took = window.localStorage === shim;
      window.localStorage = orig;
      return took;
    } catch (e) {
      return false;
    }
  }

  function needStub(t) {
    if (canStubLocalStorage()) return true;
    t.skip('this browser does not allow replacing window.localStorage (Firefox and friends)');
    return false;
  }

  function fakeResult(over) {
    var base = {
      mode: 'symbols', title: 'test', finishedAt: 1000, elapsedMs: 60000,
      typedCount: 100, totalStrokes: 110, errorStrokes: 10,
      cpm: 100, wpm: 20, firstTryRate: 0.9, rawAccuracy: 10 / 11,
      keyDeltas: [], confusions: [], symbolOnly: false
    };
    if (over) Object.keys(over).forEach(function (k) { base[k] = over[k]; });
    return base;
  }

  /* ============================================================== key map */

  test('key map: every printable ASCII character maps to a key and a finger', function (t, TD) {
    var missing = [];
    for (var c = 0x20; c <= 0x7e; c++) {
      var ch = String.fromCharCode(c);
      var info = TD.Keymap.lookup(ch);
      if (!info) { missing.push(ch); continue; }
      if (!info.finger) missing.push(ch + '(no finger)');
    }
    t.eq(missing.length, 0, 'characters without a key: ' + JSON.stringify(missing));
  });

  test('key map: BY_CODE count matches the row definitions and codes are unique', function (t, TD) {
    var count = 0;
    var seen = Object.create(null);
    var dup = [];
    TD.Keymap.ROWS.forEach(function (row) {
      row.forEach(function (k) {
        count++;
        if (seen[k.code]) dup.push(k.code);
        seen[k.code] = 1;
      });
    });
    t.eq(Object.keys(TD.Keymap.BY_CODE).length, count, 'BY_CODE size');
    t.eq(dup.length, 0, 'duplicate codes: ' + dup.join(','));
  });

  test('key map: both layers of a key point at the same code', function (t, TD) {
    var bad = [];
    Object.keys(TD.Keymap.BY_CODE).forEach(function (code) {
      var def = TD.Keymap.BY_CODE[code];
      if (!def.shifted) return;
      var b = TD.Keymap.lookup(def.base);
      var s = TD.Keymap.lookup(def.shifted);
      if (!b || !s) { bad.push(code + ' layers unresolvable'); return; }
      if (b.code !== code || s.code !== code) bad.push(code);
      if (b.needsShift !== false) bad.push(code + ' base layer must not need Shift');
      if (s.needsShift !== true) bad.push(code + ' shifted layer must need Shift');
      if (b.finger !== s.finger) bad.push(code + ' layers disagree on finger');
    });
    t.eq(bad.length, 0, bad.join(' / '));
  });

  test('key map: every keyboard row totals 15u (60 grid columns)', function (t, TD) {
    var bad = [];
    TD.Keymap.ROWS.forEach(function (row, i) {
      var u = row.reduce(function (a, k) { return a + (k.w || 1); }, 0);
      if (Math.abs(u - 15) > 1e-9) bad.push('row ' + i + ' = ' + u + 'u');
    });
    t.eq(bad.length, 0, bad.join(' / '));
  });

  test('key map: Shift uses the opposite pinky', function (t, TD) {
    t.eq(TD.Keymap.lookup('{').shiftSide, 'L', '{ sits under the right pinky, so it needs left Shift');
    t.eq(TD.Keymap.lookup('!').shiftSide, 'R', '! sits under the left pinky, so it needs right Shift');
    t.eq(TD.Keymap.lookup('$').shiftSide, 'R', '$ needs right Shift');
    t.eq(TD.Keymap.lookup('_').shiftSide, 'L', '_ needs left Shift');
    t.eq(TD.Keymap.lookup(' ').shiftFinger, null, 'Space needs no Shift');
  });

  test('character classes: symbol / alphanumeric / whitespace', function (t, TD) {
    t.ok(TD.Keymap.isSymbol('{'), '{ is a symbol');
    t.ok(TD.Keymap.isSymbol('_'), '_ is a symbol');
    t.ok(TD.Keymap.isSymbol('.'), '. is a symbol');
    t.ok(!TD.Keymap.isSymbol('a'), 'a is not a symbol');
    t.ok(!TD.Keymap.isSymbol('7'), '7 is not a symbol');
    t.ok(!TD.Keymap.isSymbol(' '), 'space is not a symbol');
  });

  /* =============================================================== content */

  test('content: every snippet line uses only characters a US keyboard can type', function (t, TD) {
    var bad = [];
    TD.Snippets.PACKS.forEach(function (p) {
      p.lines.forEach(function (line, i) {
        for (var j = 0; j < line.length; j++) {
          var ch = line[j];
          if (ch === '\n') continue;
          if (!TD.Keymap.isPrintable(ch)) {
            bad.push(p.id + '#' + i + ' pos ' + j + ' has an untypeable character ' + JSON.stringify(ch));
            break;
          }
          if (!TD.Keymap.lookup(ch)) {
            bad.push(p.id + '#' + i + ' pos ' + j + ' has no key mapping ' + JSON.stringify(ch));
            break;
          }
        }
      });
    });
    t.eq(bad.length, 0, bad.slice(0, 6).join(' / ') + (bad.length > 6 ? ' …' + bad.length + ' total' : ''));
  });

  test('content: every symbol-group token is typeable too', function (t, TD) {
    var bad = [];
    TD.SymbolDrills.GROUPS.forEach(function (g) {
      g.tokens.forEach(function (tok) {
        for (var i = 0; i < tok.length; i++) {
          if (!TD.Keymap.lookup(tok[i])) bad.push(g.id + ':' + JSON.stringify(tok));
        }
      });
    });
    t.eq(bad.length, 0, bad.slice(0, 6).join(' / '));
  });

  test('content: each language pack has enough lines and enough symbol density', function (t, TD) {
    var problems = [];
    TD.Snippets.PACKS.forEach(function (p) {
      if (p.lines.length < 25) problems.push(p.id + ' has only ' + p.lines.length + ' lines');
      if (p.avgRatio < 0.18) problems.push(p.id + ' averages only ' + (p.avgRatio * 100).toFixed(1) + '% symbol density');
    });
    t.eq(problems.length, 0, problems.join(' / '));
  });

  test('content: escape spot-checks (backslashes and quotes survived)', function (t, TD) {
    var js = TD.Snippets.byId('js').lines;
    var sh = TD.Snippets.byId('shell').lines;

    function has(arr, needle) {
      return arr.some(function (l) { return l.indexOf(needle) !== -1; });
    }
    /* These two lines are the easiest to break while editing: the JS backslash
       replacement and the regex \s. */
    t.ok(has(js, "replaceAll('\\\\', '/')"), 'JS should contain the backslash replaceAll line');
    t.ok(has(js, 'split(/[,\\s]+/)'), 'JS should contain the regex \\s line');
    t.ok(has(sh, "sed -i 's/\\r$//'"), 'Shell should contain the sed CR-strip line');
    t.ok(has(sh, "PS1='\\u@\\h:\\w\\$ '"), 'Shell should contain the PS1 prompt line');
    /* Braces and the pipe must be single characters, not eaten by escaping. */
    t.ok(has(sh, '${VAR:?must be set}'), 'Shell should contain the ${VAR:?...} line');
    t.ok(has(js, 'o?.[k] ?? null'), 'JS should contain optional chaining and nullish coalescing');
  });

  test('generation: the same seed reproduces a set, a different seed does not', function (t, TD) {
    var a = TD.SymbolDrills.generate({ groupIds: ['paren-basic'], lines: 3, seed: 42 });
    var b = TD.SymbolDrills.generate({ groupIds: ['paren-basic'], lines: 3, seed: 42 });
    var c = TD.SymbolDrills.generate({ groupIds: ['paren-basic'], lines: 3, seed: 43 });
    t.eq(a.text, b.text, 'same seed must give the same text');
    t.ok(a.text !== c.text, 'different seeds should give different text');
  });

  test('generation: a symbol drill only uses characters from the chosen groups', function (t, TD) {
    var d = TD.SymbolDrills.generate({ groupIds: ['upper-layer'], lines: 4, tokensPerLine: 8, seed: 7 });
    var g = TD.SymbolDrills.byId('upper-layer');
    var bad = [];
    d.lines.forEach(function (line) {
      for (var i = 0; i < line.length; i++) {
        if (line[i] === ' ') continue;
        if (g.chars.indexOf(line[i]) === -1) bad.push(line[i]);
      }
    });
    t.eq(bad.length, 0, 'characters outside the group: ' + bad.join(','));
  });

  /* ==================================================== engine: advancing */

  test('engine: a correct press advances, a wrong one does not and is counted', function (t, TD) {
    var e = new TD.Engine();
    e.reset('ab', {});
    var r1 = e.press(ev('a'));
    t.ok(r1.ok, 'a should be judged correct');
    t.eq(e.pos, 1, 'the cursor should advance to 1');
    var r2 = e.press(ev('x'));
    t.ok(!r2.ok, 'x should be judged wrong');
    t.eq(e.pos, 1, 'a wrong press must not advance');
    t.eq(e.errorStrokes, 1, 'error count');
    t.eq(e.totalStrokes, 2, 'total strokes include the error');
    t.eq(e.correctStrokes, 1, 'correct stroke count');
  });

  test('engine: mistake kinds are distinguished — missing Shift / extra Shift / wrong key', function (t, TD) {
    /* Expecting { but the key was pressed without Shift, producing [ */
    var e1 = new TD.Engine(); e1.reset('{', {});
    var m = e1.press(ev('[', { code: 'BracketLeft', shift: false }));
    t.eq(m.kind, 'missing-shift', 'should be classified as a missing Shift');
    t.ok(!m.ok, 'a missing Shift is an error');

    /* Expecting [ but Shift was held */
    var e2 = new TD.Engine(); e2.reset('[', {});
    var x = e2.press(ev('{', { code: 'BracketLeft', shift: true }));
    t.eq(x.kind, 'extra-shift', 'should be classified as an extra Shift');

    /* Expecting { but the neighbouring ] was pressed */
    var e3 = new TD.Engine(); e3.reset('{', {});
    var w = e3.press(ev(']', { code: 'BracketRight' }));
    t.eq(w.kind, 'wrong-key', 'should be classified as the wrong key');
  });

  test('engine: Shift side tracking — the wrong side is a note, not an error, and still advances', function (t, TD) {
    var e = new TD.Engine();
    e.reset('{', {});
    /* { is under the right pinky, so the canonical technique is left Shift;
       here the right Shift is used deliberately. */
    e.press(shiftEv('R'));
    var r = e.press(ev('{'));
    t.ok(r.ok, 'the character is correct, so it counts as correct');
    t.eq(r.kind, 'wrong-shift-side', 'the wrong Shift side should be reported');
    t.eq(e.errorStrokes, 0, 'a technique note must not penalise accuracy');
    t.eq(e.wrongShiftCount, 1, 'it is recorded separately');
    t.eq(e.typedCount, 1, 'and the cursor advances normally');
    t.ok(e.finished, 'a single-character drill should be complete');
  });

  test('engine: Shift side tracking — the correct side raises nothing', function (t, TD) {
    var e = new TD.Engine();
    e.reset('{', {});
    e.press(shiftEv('L'));
    var r = e.press(ev('{'));
    t.eq(r.kind, 'correct', 'the correct Shift side should not be flagged');
    t.eq(e.wrongShiftCount, 0, 'no technique note expected');
  });

  test('engine: the Shift side cannot be read from the character event (regression guard)', function (t, TD) {
    /* location describes the key that fired the event, and for a character key
       it is always 0. Even when such an event carries location=0, it must not
       affect the Shift-side decision. */
    var e = new TD.Engine();
    e.reset('{', {});
    e.press(shiftEv('R'));
    var r = e.press(ev('{', { location: 0 }));
    t.eq(r.kind, 'wrong-shift-side', 'the Shift side may only come from the Shift keydown');
  });

  test('engine: modifier and function keys are not keystrokes', function (t, TD) {
    var e = new TD.Engine();
    e.reset('a', {});
    e.press({ key: 'Control', code: 'ControlLeft', shiftKey: false, location: 1 });
    e.press({ key: 'Alt', code: 'AltLeft', shiftKey: false, location: 1 });
    e.press({ key: 'F5', code: 'F5', shiftKey: false, location: 0 });
    e.press({ key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: false, location: 0 });
    t.eq(e.totalStrokes, 0, 'none of these should count as strokes');
    t.eq(e.pos, 0, 'the cursor must not move');
  });

  test('engine: Ctrl / Alt / Meta combinations are not character input', function (t, TD) {
    var e = new TD.Engine();
    e.reset('a', {});
    var r = e.press(ev('a', { ctrl: true }));
    t.eq(r.kind, 'non-char', 'Ctrl+A is not character input');
    t.eq(e.totalStrokes, 0, 'it must not count as a stroke');
    t.ok(!e.started, 'and must not start the clock');
  });

  test('engine: keys arriving during IME composition are ignored, not failed', function (t, TD) {
    var e = new TD.Engine();
    e.reset('a', {});
    var r = e.press(ev('a', { ime: true }));
    t.eq(r.kind, 'ime', 'composition should be ignored');
    t.eq(e.errorStrokes, 0, 'an input method must never cause an error');
    t.ok(!e.started, 'and must not interfere with the clock');
  });

  test('engine: Caps Lock is reported as its own case', function (t, TD) {
    var e = new TD.Engine();
    e.reset('a', {});
    /* With Caps Lock on the user presses the a key without Shift; only the
       produced character changes. */
    var r = e.press(ev('A', { capsLock: true, shift: false }));
    t.eq(r.kind, 'capslock', 'Caps Lock should be recognised');
  });

  test('engine: the list of keys that must swallow default behaviour is right', function (t, TD) {
    var e = new TD.Engine();
    e.reset('abc', {});
    t.ok(e.press({ key: 'Tab', code: 'Tab', shiftKey: false, location: 0 }).consumed, 'Tab should be swallowed');
    t.ok(e.press({ key: ' ', code: 'Space', shiftKey: false, location: 0 }).consumed, 'Space should be swallowed');
    t.ok(e.press({ key: 'Backspace', code: 'Backspace', shiftKey: false, location: 0 }).consumed, 'Backspace should be swallowed');
    t.ok(e.press({ key: '/', code: 'Slash', shiftKey: false, location: 0 }).consumed, '/ should be swallowed (Firefox quick-find)');
    t.ok(!e.press({ key: 'F5', code: 'F5', shiftKey: false, location: 0 }).consumed, 'F5 should pass through');
  });

  /* ===================================================== engine: Backspace */

  test('engine: in strict mode Backspace does nothing', function (t, TD) {
    var e = new TD.Engine();
    e.reset('ab', { allowBackspace: false });
    e.press(ev('a'));
    var r = e.press({ key: 'Backspace', code: 'Backspace', shiftKey: false, location: 0 });
    t.eq(r.kind, 'backspace-blocked', 'it should be blocked');
    t.eq(e.pos, 1, 'the cursor must not move back');
    t.eq(e.typedCount, 1, 'the completed count must not change');
    t.eq(e.backspaces, 0, 'it must not count as a Backspace');
  });

  test('engine: with Backspace allowed the cursor and counters step back together, and accuracy cannot exceed 1', function (t, TD) {
    var e = new TD.Engine();
    e.reset('aa', { allowBackspace: true });
    e.press(ev('a'));
    e.press({ key: 'Backspace', code: 'Backspace', shiftKey: false, location: 0 });
    t.eq(e.pos, 0, 'the cursor returns to 0');
    t.eq(e.typedCount, 0, 'the completed count returns to 0');
    t.eq(e.firstTryChars, 0, 'the first-try credit must be retracted or it would double count');
    e.press(ev('a'));
    var s = e.snapshot();
    t.eq(s.typedCount, 1, 'one character after retyping');
    t.ok(s.firstTryRate <= 1, 'first-try accuracy must not exceed 1, got ' + s.firstTryRate);
  });

  test('engine: an error, a Backspace and a retype still report the first-try accuracy honestly', function (t, TD) {
    var e = new TD.Engine();
    e.reset('a', { allowBackspace: true });
    e.press(ev('x'));                 /* wrong first */
    e.press(ev('a'));                 /* then right */
    e.press({ key: 'Backspace', code: 'Backspace', shiftKey: false, location: 0 });
    e.press(ev('a'));                 /* and retyped */
    var s = e.snapshot();
    t.eq(s.typedCount, 1, 'one character completed');
    t.eq(s.firstTryRate, 0, 'the first press was wrong, so the rate is 0');
    t.ok(s.rawAccuracy <= 1, 'raw accuracy must not exceed 1');
  });

  /* ======================================================= engine: timing */

  test('engine: CPM / WPM / elapsed are exactly computable', function (t, TD) {
    var clk = fakeClock(1700000000000);
    try {
      var e = new TD.Engine();
      e.reset('aaaaaaaaaa', {});
      for (var i = 0; i < 10; i++) {
        if (i > 0) clk.tick(1000);
        e.press(ev('a'));
      }
      var r = e.result();
      t.eq(r.elapsedMs, 9000, 'the clock starts at the first press, so 9 seconds total');
      t.eq(r.typedCount, 10, 'ten characters completed');
      t.near(r.cpm, 10 / 0.15, 0.01, 'CPM = 10 / (9s / 60s)');
      t.near(r.wpm, (10 / 0.15) / 5, 0.01, 'WPM = CPM / 5');
      t.eq(r.firstTryRate, 1, 'all correct');
      t.eq(r.rawAccuracy, 1, 'all correct');
    } finally { clk.restore(); }
  });

  test('engine: response-time samples discard distractions (gaps over 2s)', function (t, TD) {
    var clk = fakeClock(1700000000000);
    try {
      var e = new TD.Engine();
      e.reset('aaaa', {});
      e.press(ev('a'));           /* first press, no sample */
      clk.tick(500); e.press(ev('a'));   /* normal sample */
      clk.tick(9000); e.press(ev('a'));  /* distraction, must be dropped */
      clk.tick(600); e.press(ev('a'));   /* normal sample */
      var d = e.result().keyDeltas[0];
      t.eq(d.latency.length, 2, 'only 2 samples should remain, got ' + JSON.stringify(d.latency));
    } finally { clk.restore(); }
  });

  test('engine: idle time is excluded from the clock and from CPM', function (t, TD) {
    var clk = fakeClock(1700000000000);
    try {
      var e = new TD.Engine();
      e.reset('aaaaa', {});
      e.press(ev('a'));                      /* t=0, clock starts */
      clk.tick(1000); e.press(ev('a'));      /* t=1000 */
      clk.tick(1000); e.press(ev('a'));      /* t=2000 */
      clk.tick(30000); e.press(ev('a'));     /* t=32000, a 30s break in between */
      clk.tick(1000); e.press(ev('a'));      /* t=33000, done */
      /* Wall clock 33000ms, minus (30000 − 5000) = 25000ms of idle, leaves 8000ms */
      t.eq(e.elapsedMs(), 8000, 'idle time should be excluded, got ' + e.elapsedMs());
      t.ok(e.finished, 'all five characters should be done');
      t.near(e.result().cpm, 5 / (8000 / 60000), 0.01, 'CPM must be based on the reduced duration');
    } finally { clk.restore(); }
  });

  test('engine: the clock freezes while idle instead of climbing forever', function (t, TD) {
    var clk = fakeClock(1700000000000);
    try {
      var e = new TD.Engine();
      e.reset('aa', {});
      e.press(ev('a'));
      clk.tick(2000);
      t.eq(e.elapsedMs(), 2000, 'still inside the grace window, so 2 seconds');
      /* The first 5 seconds of a gap still count — natural hesitation deserves
         grace; only the excess is discarded. The clock therefore stops at
         "last press + threshold", not at the press itself. */
      clk.tick(20000);
      t.eq(e.elapsedMs(), 5000, 'the clock stops at the threshold, got ' + e.elapsedMs());
      clk.tick(60000);
      t.eq(e.elapsedMs(), 5000, 'and stays frozen however long the pause is');
      t.ok(e.elapsedMs() < 22000, 'the whole pause must never be counted');
    } finally { clk.restore(); }
  });

  test('engine: per-key accounting is split by physical key AND layer', function (t, TD) {
    var e = new TD.Engine();
    e.reset('[{', {});
    typeChar(e, '[');
    typeChar(e, '{');
    var d = e.result().keyDeltas;
    t.eq(d.length, 2, '[ and { should each be recorded');
    var ids = d.map(function (x) { return x.keyId; });
    t.ok(ids.indexOf('BracketLeft-') !== -1, 'the base layer keyId should end in -, got ' + JSON.stringify(ids));
    t.ok(ids.indexOf('BracketLeft+') !== -1, 'the shifted layer keyId should end in +, got ' + JSON.stringify(ids));
    t.eq(d[0].code, d[1].code, 'both entries should be the same physical key');
    var needs = d.map(function (x) { return x.needsShift; }).sort();
    t.eq(needs[0], false, 'one entry does not need Shift');
    t.eq(needs[1], true, 'the other does need Shift');
  });

  test('engine: confusion pairs record "expected ← typed" and reach the result', function (t, TD) {
    var e = new TD.Engine();
    e.reset('{', {});
    e.press(ev('[', { code: 'BracketLeft', shift: false }));
    e.press(ev('[', { code: 'BracketLeft', shift: false }));
    var r = e.result();
    t.eq(r.confusions.length, 1, 'only one kind of confusion');
    t.eq(r.confusions[0].expected, '{', 'expected character');
    t.eq(r.confusions[0].typed, '[', 'actually typed');
    t.eq(r.confusions[0].count, 2, 'seen twice');
  });

  test('engine: error-kind counters are complete', function (t, TD) {
    var e = new TD.Engine();
    e.reset('{[', {});
    e.press(ev('[', { code: 'BracketLeft', shift: false }));  /* missing-shift */
    typeChar(e, '{');
    e.press(ev('{', { code: 'BracketLeft', shift: true }));   /* extra-shift */
    typeChar(e, '[');
    var k = e.result().errorKinds;
    t.eq(k['missing-shift'], 1, 'one missing Shift');
    t.eq(k['extra-shift'], 1, 'one extra Shift');
  });

  /* ==================================================== engine: symbols-only */

  test('engine: symbols-only mode skips letters and digits, landing only on symbols', function (t, TD) {
    var e = new TD.Engine();
    e.reset('a{b}c', { symbolOnly: true });
    t.eq(e.pos, 1, 'the leading letter should be skipped');
    t.eq(e.focusTotal(), 2, 'only { and } are targets');
    typeChar(e, '{');
    t.eq(e.pos, 3, 'after { the b in between should be skipped');
    typeChar(e, '}');
    t.ok(e.finished, 'completing the targets finishes the drill');
    t.eq(e.typedCount, 2, 'only two symbols were counted');
  });

  test('engine: in symbols-only mode the CPM denominator counts only target characters', function (t, TD) {
    var clk = fakeClock(1700000000000);
    try {
      /* Of 8 characters only { and } are targets, so the denominator is 2 */
      var e = new TD.Engine();
      e.reset('aa{bb}cc', { symbolOnly: true });
      e.press(ev('{'));                          /* first press, clock starts */
      for (var i = 0; i < 5; i++) clk.tick(1000); /* one second each, inside the grace window */
      e.press(ev('}'));
      var s = e.snapshot();
      t.eq(s.focusTotal, 2, 'two target characters');
      t.eq(s.typedCount, 2, 'two target characters completed');
      t.near(s.elapsedMs, 5000, 1, 'elapsed should be 5 seconds');
      t.near(s.cpm, 2 / (5000 / 60000), 0.01, '2 targets in 5 seconds = 24 CPM; letters excluded');
      t.ok(s.finished, 'completing the targets finishes the drill');
    } finally { clk.restore(); }
  });

  test('engine: in symbols-only mode newlines are not typed and finish fires once', function (t, TD) {
    var e = new TD.Engine();
    var finishes = 0;
    e.on('finish', function () { finishes++; });
    e.reset('{\n}', { symbolOnly: true });
    typeChar(e, '{');
    typeChar(e, '}');
    e.press(ev('}'));
    t.eq(finishes, 1, 'finish should fire exactly once');
    t.eq(e.pos, 2, 'the newline does not occupy a position');
  });

  /* ================================================================ stats */

  test('stats: median calculation (odd count, even count, empty)', function (t, TD) {
    t.eq(TD.util.median([3, 1, 2]), 2, 'odd count takes the middle value');
    t.eq(TD.util.median([4, 1, 3, 2]), 2.5, 'even count averages the two middle values');
    t.eq(TD.util.median([]), 0, 'an empty array gives 0');
  });

  test('stats: heat buckets have the right boundaries and are monotonic', function (t, TD) {
    var H = TD.Stats.heatLevel;
    t.eq(H({ attempts: 0, errors: 0 }), -1, 'no data');
    t.eq(H({ attempts: 100, errors: 0 }), 1, '0% is good');
    t.eq(H({ attempts: 100, errors: 3 }), 1, '3% is still good');
    t.eq(H({ attempts: 100, errors: 4 }), 2, '4% drops one bucket');
    t.eq(H({ attempts: 100, errors: 8 }), 2, '8% is fair');
    t.eq(H({ attempts: 100, errors: 9 }), 3, '9% is high');
    t.eq(H({ attempts: 100, errors: 18 }), 3, '18% is high');
    t.eq(H({ attempts: 100, errors: 19 }), 4, '19% is poor');
    /* Monotonic: a rising error rate must never lower the bucket. */
    var prev = -1;
    for (var e = 0; e <= 40; e++) {
      var lv = H({ attempts: 100, errors: e });
      t.ok(lv >= prev, 'the bucket must not decrease as errors rise (' + e + '% gave ' + lv + ')');
      prev = lv;
    }
  });

  test('stats: merging sessions accumulates rather than overwrites', function (t, TD) {
    var agg = TD.Stats.empty();
    var d = [{ keyId: 'BracketLeft+', code: 'BracketLeft', char: '{', needsShift: true, finger: 'R5', attempts: 10, errors: 2, latency: [300, 400] }];
    TD.Stats.mergeSession(agg, fakeResult({ keyDeltas: d, confusions: [{ expected: '{', typed: '[', count: 2 }] }));
    TD.Stats.mergeSession(agg, fakeResult({ keyDeltas: d, confusions: [{ expected: '{', typed: '[', count: 1 }] }));
    t.eq(agg.keys['BracketLeft+'].attempts, 20, 'attempts should accumulate');
    t.eq(agg.keys['BracketLeft+'].errors, 4, 'errors should accumulate');
    t.eq(agg.keys['BracketLeft+'].lat.length, 4, 'response-time samples should accumulate');
    t.eq(agg.totals.sessions, 2, 'session count');
    t.eq(TD.Stats.confusionRows(agg)[0].count, 3, 'confusion counts should accumulate');
    t.eq(agg.sessions.length, 2, 'two entries in the session history');
  });

  test('stats: the response-time reservoir caps at 200 and the session history at 500', function (t, TD) {
    var agg = TD.Stats.empty();
    var lat = [];
    for (var i = 0; i < 300; i++) lat.push(200 + i);
    TD.Stats.mergeSession(agg, fakeResult({
      keyDeltas: [{ keyId: 'KeyA-', code: 'KeyA', char: 'a', needsShift: false, finger: 'L5', attempts: 300, errors: 0, latency: lat }]
    }));
    t.eq(agg.keys['KeyA-'].lat.length, TD.Stats.MAX_LAT, 'samples should be truncated to the cap');

    var agg2 = TD.Stats.empty();
    for (var j = 0; j < 501; j++) TD.Stats.mergeSession(agg2, fakeResult({ finishedAt: 1000 + j }));
    t.eq(agg2.sessions.length, TD.Stats.MAX_SESSIONS, 'the session history should be truncated to the cap');
    t.eq(agg2.sessions[agg2.sessions.length - 1].ts, 1500, 'the newest sessions should be kept');
  });

  test('stats: the per-finger summary merges keys of the same finger', function (t, TD) {
    var agg = TD.Stats.empty();
    TD.Stats.mergeSession(agg, fakeResult({
      keyDeltas: [
        { keyId: 'BracketLeft+', code: 'BracketLeft', char: '{', needsShift: true, finger: 'R5', attempts: 10, errors: 4, latency: [400] },
        { keyId: 'BracketRight+', code: 'BracketRight', char: '}', needsShift: true, finger: 'R5', attempts: 10, errors: 2, latency: [300] },
        { keyId: 'KeyA-', char: 'a', code: 'KeyA', needsShift: false, finger: 'L5', attempts: 10, errors: 0, latency: [150] }
      ]
    }));
    var rows = TD.Stats.fingerRows(agg);
    var r5 = rows.filter(function (r) { return r.finger === 'R5'; })[0];
    t.eq(r5.attempts, 20, 'the right pinky totals 20 attempts');
    t.eq(r5.errors, 6, 'and 6 errors');
    t.near(r5.errorRate, 0.3, 1e-9, 'a 30% error rate for the right pinky');
    t.eq(rows.length, TD.Keymap.FINGER_ORDER.length, 'all nine fingers (including the thumb) must appear');
  });

  test('stats: overview accuracy and average speed', function (t, TD) {
    var agg = TD.Stats.empty();
    TD.Stats.mergeSession(agg, fakeResult({ typedCount: 100, totalStrokes: 110, errorStrokes: 10, elapsedMs: 60000, cpm: 100 }));
    var s = TD.Stats.summary(agg);
    t.eq(s.chars, 100, 'characters accumulated');
    t.eq(s.strokes, 110, 'strokes accumulated');
    t.near(s.accuracy, 1 - 10 / 110, 1e-9, 'accuracy = 1 - errors / strokes');
    t.near(s.avgCpm, 100, 1e-6, '100 characters in 1 minute');
    t.eq(s.bestCpm, 100, 'best CPM recorded');
  });

  test('stats: the trend series keeps the last N points and reports extremes', function (t, TD) {
    var agg = TD.Stats.empty();
    for (var i = 1; i <= 20; i++) {
      TD.Stats.mergeSession(agg, fakeResult({ finishedAt: 1000 + i * 1000, cpm: i * 10, firstTryRate: 0.5 + i / 100 }));
    }
    var tr = TD.Stats.trend(agg, 5);
    t.eq(tr.points.length, 5, 'only the last 5 points');
    t.eq(tr.points[4].cpm, 200, 'the last point is session 20');
    t.eq(tr.total, 20, 'the total is still 20');
    t.eq(tr.minCpm, 160, 'lowest of those five');
    t.eq(tr.maxCpm, 200, 'highest of those five');
  });

  /* ================================================================ store */

  test('store: when localStorage is unavailable it degrades to memory without breaking', function (t, TD) {
    var S = TD.Store;
    var orig = window.localStorage;
    if (!needStub(t)) return;
    try {
      window.localStorage = throwingLS();
      S._resetForTest();
      var p = S.probe();
      t.eq(p.available, false, 'it should report unavailable');
      t.eq(p.backend, 'memory', 'it should degrade to memory');
      S.load();
      S.setSetting('fontSize', 30);
      t.eq(S.settings.fontSize, 30, 'settings still work in memory mode');
      t.ok(S.serialize().indexOf('fontSize') !== -1, 'serialisation still works in memory mode');
    } finally { window.localStorage = orig; }
  });

  test('store: removing the localStorage object entirely does not break it', function (t, TD) {
    var S = TD.Store;
    var orig = window.localStorage;
    if (!needStub(t)) return;
    try {
      window.localStorage = undefined;
      S._resetForTest();
      var p = S.probe();
      t.eq(p.available, false, 'it should report unavailable');
      S.load();
      t.eq(S.settings.fontSize, TD.Store.DEFAULT_SETTINGS.fontSize, 'it should fall back to defaults');
    } finally { window.localStorage = orig; }
  });

  test('store: a round trip through working storage is lossless', function (t, TD) {
    var S = TD.Store;
    var orig = window.localStorage;
    if (!needStub(t)) return;
    try {
      var ls = memoryLS();
      window.localStorage = ls;
      S._resetForTest();
      var p = S.probe();
      t.eq(p.available, true, 'the in-memory stand-in should probe successfully');
      t.eq(p.backend, 'local', 'it should use localStorage');

      S.load();
      S.setSetting('fontSize', 26);
      TD.Stats.mergeSession(S.agg, fakeResult({ keyDeltas: [{ keyId: 'KeyA-', code: 'KeyA', char: 'a', needsShift: false, finger: 'L5', attempts: 5, errors: 1, latency: [200] }] }));
      S.addCustom('My set', 'const a = 1;');
      S.save();

      /* Reset only the in-memory state; the stored data stays, so this proves
         it really persisted. */
      S._resetForTest();
      S.probe();
      S.load();
      t.eq(S.settings.fontSize, 26, 'settings should persist');
      t.eq(S.agg.keys['KeyA-'].attempts, 5, 'per-key data should persist');
      t.eq(S.agg.sessions.length, 1, 'sessions should persist');
      t.eq(S.custom.length, 1, 'the custom set should persist');
      t.eq(S.custom[0].name, 'My set', 'the set name should be preserved');
    } finally { window.localStorage = orig; }
  });

  test('store: a corrupt save is set aside and a fresh state starts', function (t, TD) {
    var S = TD.Store;
    var orig = window.localStorage;
    if (!needStub(t)) return;
    try {
      var ls = memoryLS();
      window.localStorage = ls;
      S._resetForTest();
      ls.setItem(S.KEY, '{ this is not valid JSON');
      S.load();
      t.eq(S.corrupt, true, 'it should be flagged as corrupt');
      t.eq(S.agg.sessions.length, 0, 'a fresh state should start');
      t.ok(ls.getItem('typing-drill/v1.corrupt') !== null, 'the original text must be kept, never silently destroyed');
    } finally { window.localStorage = orig; }
  });

  test('store: import validation rejects bad input', function (t, TD) {
    var S = TD.Store;
    t.eq(S.parseImport('not JSON at all').ok, false, 'non-JSON should be rejected');
    t.eq(S.parseImport('{"app":"other-app","agg":{}}').ok, false, 'another app\'s export should be rejected');
    t.eq(S.parseImport('{"foo":1}').ok, false, 'a payload without the expected fields should be rejected');
    var good = S.parseImport(JSON.stringify({ app: 'typing-drill', version: 1, agg: TD.Stats.empty(), settings: {}, custom: [] }));
    t.eq(good.ok, true, 'this tool\'s own export should be accepted');
  });

  test('store: merging import accumulates, and importing the same file twice does not double', function (t, TD) {
    var S = TD.Store;
    var orig = window.localStorage;
    if (!needStub(t)) return;
    try {
      window.localStorage = memoryLS();
      S._resetForTest(); S.probe(); S.load();

      var src = TD.Stats.empty();
      TD.Stats.mergeSession(src, fakeResult({ finishedAt: 5000, keyDeltas: [{ keyId: 'KeyA-', code: 'KeyA', char: 'a', needsShift: false, finger: 'L5', attempts: 4, errors: 0, latency: [100] }] }));
      var payload = JSON.stringify({ app: 'typing-drill', version: 1, agg: src, settings: null, custom: [] });

      var parsed = S.parseImport(payload);
      t.eq(parsed.ok, true, 'it should pass validation');

      var r1 = S.applyImport(parsed, true);
      t.eq(r1.skipped, null, 'the first import should not be skipped');
      t.eq(r1.newSessions, 1, 'the first import adds one session');
      t.eq(S.agg.sessions.length, 1, 'one session after the first merge');
      t.eq(S.agg.keys['KeyA-'].attempts, 4, 'four attempts after the first import');

      var r2 = S.applyImport(parsed, true);
      t.eq(r2.skipped, 'duplicate', 'importing the same file again should be skipped entirely');
      t.eq(S.agg.sessions.length, 1, 'sessions must not double');
      t.eq(S.agg.keys['KeyA-'].attempts, 4, 'per-key data must not double either — sessions are deduplicated, so per-key data has to be skipped in step');
      t.eq(S.agg.totals.chars, 100, 'accumulated characters must not double');
      t.eq(S.agg.totals.sessions, 1, 'accumulated sessions must not double');
    } finally { window.localStorage = orig; }
  });

  test('store: a partially overlapping import is flagged so the interface can warn', function (t, TD) {
    var S = TD.Store;
    var orig = window.localStorage;
    if (!needStub(t)) return;
    try {
      window.localStorage = memoryLS();
      S._resetForTest(); S.probe(); S.load();

      /* Existing data: one session at ts=5000 */
      TD.Stats.mergeSession(S.agg, fakeResult({ finishedAt: 5000, typedCount: 100 }));
      S.save();

      /* Incoming: two sessions, one of which duplicates ts=5000 */
      var src = TD.Stats.empty();
      TD.Stats.mergeSession(src, fakeResult({ finishedAt: 5000, typedCount: 100 }));
      TD.Stats.mergeSession(src, fakeResult({ finishedAt: 9000, typedCount: 200 }));
      var parsed = S.parseImport(JSON.stringify({ app: 'typing-drill', version: 1, agg: src, settings: null, custom: [] }));

      var r = S.applyImport(parsed, true);
      t.eq(r.ok, true, 'the import should succeed');
      t.eq(r.newSessions, 1, 'only the non-duplicate session should be added');
      t.eq(r.partial, true, 'partial overlap must be flagged; per-key statistics get counted twice');
      t.eq(S.agg.sessions.length, 2, 'two sessions in the end');
    } finally { window.localStorage = orig; }
  });

  test('store: custom sets can be added and removed', function (t, TD) {
    var S = TD.Store;
    var orig = window.localStorage;
    if (!needStub(t)) return;
    try {
      window.localStorage = memoryLS();
      S._resetForTest(); S.probe(); S.load();
      var a = S.addCustom('First', 'aaa');
      var b = S.addCustom('Second', 'bbb');
      t.eq(S.custom.length, 2, 'two entries');
      t.ok(S.getCustom(a.id) !== null, 'lookup by id should work');
      t.eq(S.removeCustom(a.id), true, 'removal should succeed');
      t.eq(S.custom.length, 1, 'one entry left');
      t.eq(S.removeCustom('does-not-exist'), false, 'removing a missing id returns false');
      t.ok(S.getCustom(b.id) !== null, 'the other entry must not be touched');
    } finally { window.localStorage = orig; }
  });

  /* ============================================================= adaptive */

  function rec(char, code, attempts, errors, latMs, finger) {
    var info = TD.Keymap.lookup(char);
    return {
      keyId: code + (info && info.needsShift ? '+' : '-'),
      code: code, char: char, needsShift: !!(info && info.needsShift),
      finger: finger || (info ? info.finger : null),
      attempts: attempts, errors: errors,
      lat: latMs ? [latMs, latMs, latMs] : [],
      firstSeen: 1000, lastSeen: 2000
    };
  }

  test('adaptive: a higher error rate scores higher (monotonicity)', function (t, TD) {
    var now = 10000;
    var low = TD.Adaptive.scoreOf(rec('a', 'KeyA', 50, 2, 200), now);
    var mid = TD.Adaptive.scoreOf(rec('a', 'KeyA', 50, 10, 200), now);
    var high = TD.Adaptive.scoreOf(rec('a', 'KeyA', 50, 25, 200), now);
    t.ok(mid > low, 'a rising error rate must raise the score');
    t.ok(high > mid, 'and keep raising it');
  });

  test('adaptive: a slower response scores higher', function (t, TD) {
    var now = 10000;
    var fast = TD.Adaptive.scoreOf(rec('a', 'KeyA', 50, 5, 150), now);
    var slow = TD.Adaptive.scoreOf(rec('a', 'KeyA', 50, 5, 800), now);
    t.ok(slow > fast, 'at equal error rates the slower key is the weaker one');
  });

  test('adaptive: keys with too few samples are not ranked', function (t, TD) {
    var agg = TD.Stats.empty();
    agg.keys['KeyA-'] = rec('a', 'KeyA', 2, 2, 900);   /* 2 attempts, all wrong, but not enough evidence */
    agg.keys['KeyB-'] = rec('b', 'KeyB', 40, 4, 200);
    var ranked = TD.Adaptive.rankWeakKeys(agg, { minAttempts: 3 });
    t.eq(ranked.length, 1, 'only the key with enough samples should survive');
    t.eq(ranked[0].code, 'KeyB', 'and it should be the one with enough samples');
  });

  test('adaptive: the ranking is sorted by score descending', function (t, TD) {
    var agg = TD.Stats.empty();
    agg.keys['KeyA-'] = rec('a', 'KeyA', 40, 1, 180);
    agg.keys['BracketLeft+'] = rec('{', 'BracketLeft', 40, 16, 600);
    agg.keys['Semicolon-'] = rec(';', 'Semicolon', 40, 7, 300);
    var ranked = TD.Adaptive.rankWeakKeys(agg, {});
    t.eq(ranked[0].code, 'BracketLeft', 'the weakest should be {');
    for (var i = 1; i < ranked.length; i++) {
      t.ok(ranked[i - 1].score >= ranked[i].score, 'the ranking must descend by score');
    }
  });

  test('adaptive: accurate and fast keys are not weaknesses; slow ones are, and are flagged', function (t, TD) {
    var agg = TD.Stats.empty();
    agg.keys['KeyA-'] = rec('a', 'KeyA', 50, 0, 160);   /* accurate and fast */
    agg.keys['KeyB-'] = rec('b', 'KeyB', 50, 0, 900);   /* never wrong, but clearly slow */
    agg.keys['KeyC-'] = rec('c', 'KeyC', 50, 10, 200);  /* often wrong */
    var ranked = TD.Adaptive.rankWeakKeys(agg, {});
    var codes = ranked.map(function (r) { return r.code; });
    t.eq(codes.indexOf('KeyA'), -1, 'accurate and fast is not a weakness — practised is not the same as weak');
    t.ok(codes.indexOf('KeyB') !== -1, 'never wrong but clearly slow is a weakness');
    t.ok(codes.indexOf('KeyC') !== -1, 'often wrong is a weakness');
    var b = ranked.filter(function (r) { return r.code === 'KeyB'; })[0];
    t.eq(b.slow, true, 'the slow key should be flagged');
    t.eq(b.errors, 0, 'its error count really is zero, so the interface must explain why it is listed');
  });

  test('adaptive: keys with small samples are marked as such', function (t, TD) {
    var agg = TD.Stats.empty();
    agg.keys['KeyA-'] = rec('a', 'KeyA', 4, 2, 200);
    agg.keys['KeyB-'] = rec('b', 'KeyB', 40, 4, 200);
    var ranked = TD.Adaptive.rankWeakKeys(agg, {});
    var a = ranked.filter(function (r) { return r.code === 'KeyA'; })[0];
    var b = ranked.filter(function (r) { return r.code === 'KeyB'; })[0];
    t.eq(a.enoughSamples, false, '4 attempts should be marked as too few');
    t.eq(b.enoughSamples, true, '40 attempts are enough');
  });

  test('adaptive: a well-evidenced weakness outranks a tiny sample with a huge error rate', function (t, TD) {
    var agg = TD.Stats.empty();
    agg.keys['KeyA-'] = rec('a', 'KeyA', 1, 1, 200);    /* 1 attempt, 1 error: a 100% rate with no statistical meaning */
    agg.keys['KeyB-'] = rec('b', 'KeyB', 40, 6, 200);   /* 40 attempts, 6 errors: 15%, solid evidence */
    var ranked = TD.Adaptive.rankWeakKeys(agg, { minAttempts: 1 });
    t.eq(ranked[0].code, 'KeyB', 'the solid evidence should come first, actual order: ' +
      JSON.stringify(ranked.map(function (r) { return r.code + ':' + r.score.toFixed(4); })));
  });

  test('adaptive: practising one character brings along the other layer of the same key', function (t, TD) {
    var toks = TD.Adaptive.buildTokens([{ char: '{' }]);
    t.ok(toks.indexOf('{') !== -1, 'the target character itself');
    t.ok(toks.indexOf('[') !== -1, 'the base layer of the same key, which is what trains Shift');
    var toks2 = TD.Adaptive.buildTokens([{ char: ';' }]);
    t.ok(toks2.indexOf(':') !== -1, '; should bring along :');
  });

  test('adaptive: with no data it cold-starts without error and still offers content', function (t, TD) {
    var d = TD.Adaptive.buildDrill(TD.Stats.empty(), { seed: 5, lines: 3 });
    t.eq(d.coldStart, true, 'it should be flagged as a cold start');
    t.ok(d.lines.length > 0, 'it must still offer something to practise');
    t.ok(d.text.length > 0, 'the text must not be empty');
    t.ok(!!d.note, 'it must explain itself');
  });

  test('adaptive: with data it focuses the weakest keys and includes real code lines', function (t, TD) {
    var agg = TD.Stats.empty();
    agg.keys['BracketLeft+'] = rec('{', 'BracketLeft', 40, 18, 700);
    agg.keys['BracketRight+'] = rec('}', 'BracketRight', 40, 15, 650);
    agg.keys['KeyA-'] = rec('a', 'KeyA', 60, 0, 150);
    var d = TD.Adaptive.buildDrill(agg, { seed: 11, lines: 4 });
    t.eq(d.coldStart, false, 'this is not a cold start');
    t.ok(d.focus.length >= 2, 'at least two weak keys');
    t.eq(d.focus[0].char, '{', 'the weakest should come first');
    t.eq(d.lines.length, 4, 'the line count should be honoured');
    var joined = d.lines.join('\n');
    t.ok(joined.indexOf('{') !== -1 || joined.indexOf('[') !== -1, 'the content should contain the weak symbols');
    t.ok(/[A-Za-z]/.test(joined), 'it should include real code lines, not just symbol piles');
  });

  test('adaptive: weak-key code lines really contain a weak character (a guarantee, not a probability)', function (t, TD) {
    var agg = TD.Stats.empty();
    agg.keys['Slash-'] = rec('/', 'Slash', 30, 12, 500);
    var allPacks = ['shell', 'js', 'python', 'go', 'sql'];
    var misses = 0;
    var sample = null;
    for (var s = 1; s <= 12; s++) {
      var d = TD.Adaptive.buildDrill(agg, { seed: s, lines: 4, packIds: allPacks });
      var codeLines = d.lines.filter(function (l) { return /[A-Za-z]/.test(l); });
      var hit = codeLines.some(function (l) { return l.indexOf('/') !== -1; });
      if (!hit) { misses++; sample = codeLines; }
    }
    t.eq(misses, 0, 'across 12 different seeds at least one code line must contain the weak character /; missed ' + misses + ' times: ' + JSON.stringify(sample));
  });

  test('adaptive: reserving those slots does not crowd out variety', function (t, TD) {
    var agg = TD.Stats.empty();
    agg.keys['Slash-'] = rec('/', 'Slash', 30, 12, 500);
    var d = TD.Adaptive.buildDrill(agg, { seed: 3, lines: 6, packIds: ['shell', 'js', 'python', 'go', 'sql'] });
    t.eq(d.lines.length, 6, 'the line count should be honoured');
    var codeLines = d.lines.filter(function (l) { return /[A-Za-z]/.test(l); });
    t.ok(codeLines.length >= 2, 'at least two real code lines, got ' + codeLines.length);
    var withSlash = codeLines.filter(function (l) { return l.indexOf('/') !== -1; }).length;
    t.ok(withSlash >= 1, 'at least one contains the weak character');
    t.ok(withSlash < codeLines.length || codeLines.length === 1,
      'not all of them should, or the real-world variety is lost');
  });

  test('adaptive: with data but no weakness it does not claim a cold start', function (t, TD) {
    var agg = TD.Stats.empty();
    agg.keys['KeyA-'] = rec('a', 'KeyA', 50, 0, 150);
    agg.keys['KeyB-'] = rec('b', 'KeyB', 50, 0, 140);
    t.eq(TD.Adaptive.rankWeakKeys(agg, {}).length, 0, 'precondition: this data contains no weakness');

    var d = TD.Adaptive.buildDrill(agg, { seed: 7, lines: 3 });
    t.eq(d.coldStart, false, 'having practised, it must not be called a cold start or the user will think the statistics are broken');
    t.ok(d.lines.length > 0, 'it must still offer content');
    t.eq(d.focus.length, 0, 'focus should be empty when there is no weakness');
    /* Compare against the dictionary rather than a literal: the note is
       translated, so asserting on Chinese text would break under `en`. */
    t.eq(d.note, TD.I18n.t('note.adaptiveReview'), 'the note should say there is no clear weakness yet');
  });

  /* ============================================================ keyboard */

  test('keyboard: fast consecutive presses do not leave stale flash highlights', function (t, TD) {
    if (typeof document === 'undefined' || !document.createElement) {
      t.skip('needs a DOM; this case only runs in the browser test page');
      return;
    }
    var kb = TD.Keyboard.create();
    /* Three flashes with no time in between — exactly what fast typing does. */
    kb.flash('KeyA');
    kb.flash('KeyS');
    kb.flash('KeyD');
    t.eq(kb.root.querySelectorAll('[data-flash="true"]').length, 1, 'at most one key may flash at a time');
    t.eq(kb.root.querySelector('[data-code="KeyA"]').getAttribute('data-flash'), null,
      'an earlier flash must be cleared, or fast typing leaves a trail of highlights');
    t.eq(kb.root.querySelector('[data-code="KeyS"]').getAttribute('data-flash'), null,
      'the second-to-last flash must be cleared too');
    kb.clearFlash();
    t.eq(kb.root.querySelectorAll('[data-flash="true"]').length, 0, 'clearFlash should clear everything');
  });

  /* ========================================================== i18n layer */

  test('i18n: the dictionaries carry the same keys and every value resolves', function (t, TD) {
    var I = TD.I18n;
    var langs = I.LANG_IDS.filter(function (l) { return I.hasDict(l); });
    t.ok(langs.length >= 2, 'at least two dictionaries should be registered, found ' + langs.length);
    var base = I.keysOf(langs[0]);
    t.ok(base.length > 100, 'the dictionary should be substantial, found ' + base.length + ' keys');
    langs.forEach(function (l, i) {
      var only = I.keysOf(l).filter(function (k) { return base.indexOf(k) === -1; });
      var missing = base.filter(function (k) { return I.keysOf(l).indexOf(k) === -1; });
      t.eq(only.length, 0, '[' + l + '] extra keys not in ' + langs[0] + ': ' + only.slice(0, 6).join(', '));
      t.eq(missing.length, 0, '[' + l + '] missing keys: ' + missing.slice(0, 6).join(', '));
    });
  });

  test('i18n: interpolation, plurals, language detection and missing-key handling', function (t, TD) {
    var I = TD.I18n;
    var before = I.lang();

    I.set('en');
    t.eq(I.t('nav.practice'), 'Practice', 'an English lookup should resolve');
    t.ok(/middle/.test(I.t('engine.explain.wrongKey', { charName: 'comma', layer: 'base', finger: 'right middle' })),
      'placeholders should be interpolated');
    t.eq(I.t('result.times', { n: 1 }), '1 time', 'the singular form should be chosen for n=1');
    t.eq(I.t('result.times', { n: 3 }), '3 times', 'the plural form should be chosen otherwise');

    I.set('zh-CN');
    /* The Chinese expectation below is the point of this assertion. */
    t.eq(I.t('nav.practice'), '练习', 'a Chinese lookup should resolve'); // i18n-check-allow
    t.ok(I.t('result.times', { n: 3 }).indexOf('3') !== -1, 'a dictionary without plural forms still interpolates');

    I.resetMissing();
    var missingKey = 'definitely.not.a.key';
    t.eq(I.t(missingKey), missingKey, 'a missing key should return the key itself, never undefined');
    t.ok(I.missingKeys().indexOf(missingKey) !== -1, 'and should be recorded for diagnostics');
    I.resetMissing();

    t.ok(I.detect() === 'zh-CN' || I.detect() === 'en', 'detection should resolve to a supported language');
    I.set(before);
  });

  test('i18n: every member of every dynamically composed key family exists, in both languages', function (t, TD) {
    var I = TD.I18n;
    var langs = I.LANG_IDS.filter(function (l) { return I.hasDict(l); });
    /* views.js and friends build these keys by concatenation, so the static
       reference scan cannot see them. Enumerating the members here is what
       catches a family member that was never added — asking for a missing key
       renders the raw key name straight into the interface. */
    var families = [
      ['result.metric.', ['cpm', 'wpm', 'firstTry', 'rawAcc', 'errors', 'time']],
      ['result.metric.', ['cpm', 'wpm', 'firstTry', 'rawAcc', 'errors', 'time'], 'Sub'],
      ['stats.overview.', ['sessions', 'chars', 'avgCpm', 'bestCpm', 'accuracy', 'duration', 'keys', 'errors']],
      ['stats.overview.', ['avgCpm', 'bestCpm', 'accuracy', 'keys'], 'Sub'],
      ['kind.', ['correct', 'wrong-key', 'missing-shift', 'extra-shift', 'same-key', 'wrong-shift-side', 'capslock', 'other']],
      ['engine.explain.', ['missingShift', 'extraShift', 'wrongShiftSide', 'capslock', 'wrongKey', 'sameKey', 'other']],
      ['practice.mode.', ['symbols', 'code', 'adaptive', 'custom']],
      ['practice.hud.', ['cpm', 'wpm', 'acc', 'errors', 'progress', 'time']],
      ['practice.summary.', ['symbols', 'symbolsAll', 'symbolsSome', 'code', 'codeAll', 'codeSome',
        'codeDensity', 'adaptiveWeak', 'adaptiveNoData', 'custom', 'customNone']],
      ['theme.', ['auto', 'light', 'dark']],
      ['finger.', ['L5', 'L4', 'L3', 'L2', 'T', 'R2', 'R3', 'R4', 'R5']],
      ['char.', ['space', 'exclam', 'quotedbl', 'hash', 'dollar', 'percent', 'amp', 'apos',
        'parenleft', 'parenright', 'asterisk', 'plus', 'comma', 'minus', 'period', 'slash',
        'colon', 'semicolon', 'less', 'equal', 'greater', 'question', 'at', 'bracketleft',
        'backslash', 'bracketright', 'caret', 'underscore', 'grave', 'braceleft', 'pipe',
        'braceright', 'tilde', 'upper', 'lower', 'digit', 'unknown']],
      ['key.', ['space', 'menu', 'shift', 'tab', 'enter', 'caps', 'win', 'alt', 'ctrl']],
      ['kb.legend.', ['target', 'sameFinger', 'heat1', 'heat2', 'heat3', 'heat4', 'noData']],
      ['notice.', ['corrupt.title', 'corrupt.body', 'noStorage.title', 'noStorage.body']],
      ['stats.table.', ['char', 'key', 'finger', 'attempts', 'errors', 'errorRate', 'median', 'samples']],
      ['stats.trend.', ['title', 'emptyTitle', 'emptyBody', 'cpmAxis', 'accAxis', 'total', 'aria']],
      ['practice.hud.', ['cpm', 'wpm', 'acc', 'errors', 'progress', 'time']],
      ['settings.data.', ['stored', 'memoryOnly', 'whereTitle', 'whereBody', 'whereBodyMemory']]
    ];
    var checked = 0;
    families.forEach(function (fam) {
      var prefix = fam[0];
      var members = fam[1];
      var suffix = fam[2] || '';
      members.forEach(function (m) {
        var key = prefix + m + suffix;
        langs.forEach(function (l) {
          checked++;
          t.ok(I.keysOf(l).indexOf(key) !== -1, '[' + l + '] missing family member ' + key);
        });
      });
    });
    t.ok(checked > 150, 'the family list should cover the dynamic call sites, checked ' + checked);
  });

  /* ======================================================== practice view */

  test('practice view: changing mode immediately loads a drill of the new mode', function (t, TD) {
    if (typeof document === 'undefined' || !document.createElement || !TD.Views || !TD.UI) {
      t.skip('needs a DOM and the views module; this case runs in the browser test page');
      return;
    }
    var host = document.createElement('div');
    document.body.appendChild(host);
    var P = TD.Views.Practice;

    try {
      /* Deliberately no probe()/load(): _resetForTest leaves the backend in
         memory mode, so this case cannot write into the real save. */
      TD.Store._resetForTest();
      TD.Store.setSetting('optionsExpanded', true);
      TD.Store.addCustom('case set', 'const a = { b: [1, 2] };\nif (a) { b(); }');

      /* init() swaps the view layer's context for the rest of the page; this
         case is placed last in the file so nothing else depends on it. */
      TD.Views.init({ store: TD.Store, nav: function () {}, setLang: function () {}, container: host });

      TD.Store.setSetting('mode', 'symbols');
      P.drill = null;
      P.mount(host);
      t.eq(P.engine.meta.mode, 'symbols', 'the initial drill should match the mode');
      t.ok(P.engine.text.length > 0, 'the initial drill should have text');

      /* Drive every switch through the same entry point the buttons use.
         Keeping the previous drill here is the bug this case exists for: the
         toolbar changed, the text did not, so the mode buttons looked dead. */
      ['code', 'adaptive', 'custom', 'symbols'].forEach(function (mode) {
        TD.Store.setSetting('mode', mode);
        P.applyOptions(host);
        t.eq(P.engine.meta.mode, mode,
          'switching to ' + mode + ' must load a ' + mode + ' drill at once, not keep the previous one');
        t.ok(P.engine.text.length > 0, 'the ' + mode + ' drill must have text');
        t.eq(P.engine.pos, 0, 'a freshly loaded drill starts at the beginning');
      });

      /* Changing the content filters must also take effect at once. */
      TD.Store.setSetting('mode', 'symbols');
      TD.Store.setSetting('groupIds', ['paren-basic']);
      P.applyOptions(host);
      var onlyParen = P.engine.text;
      t.ok(/[()[\]{}]/.test(onlyParen), 'the drill should contain bracket characters');
      t.ok(!/[<>]/.test(onlyParen),
        'restricting the groups should drop characters from the excluded groups, got: ' + onlyParen);

      /* A configuration-only change must NOT throw the current drill away. */
      var before = P.engine.text;
      TD.Store.setSetting('optionsExpanded', false);
      P.mount(host);
      t.eq(P.engine.text, before, 'collapsing the filters must keep the current drill');
    } finally {
      P.stopTimer();
      if (host.parentNode) host.parentNode.removeChild(host);
      TD.Store._resetForTest();
    }
  });

  /* =============================================================== summary */

  TD.TEST_CASES = CASES;
})(window.TD);
