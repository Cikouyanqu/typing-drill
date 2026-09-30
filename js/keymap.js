/* ==========================================================================
   keymap.js — US QWERTY physical key map

   Single responsibility: relate a physical key (event.code) to the character
   it produces, the finger that should press it, and which Shift to hold.

   Two indexes:
     BY_CODE — code → key definition (on-screen keyboard, per-key statistics)
     BY_CHAR — character → { code, finger, needsShift, shiftSide, name }
               (engine target resolution)

   Touch-typing convention: a shifted symbol is typed with the Shift key on the
   OPPOSITE side — left-hand keys take right Shift and vice versa. This is the
   single most important piece of guidance for programming symbols, because
   { } | \ all live under the right pinky and ! @ # under the left.

   i18n note: finger labels and character names are exposed as accessor
   properties that call TD.I18n at READ time. Baking them into constants at
   load time would freeze the language until a page reload.
   ========================================================================== */

window.TD = window.TD || {};
(function (TD) {
  'use strict';

  var I18n = TD.I18n;

  function tr(key, params) {
    return I18n ? I18n.t(key, params) : key;
  }

  /* Attach a translated string as a read-time accessor. Non-enumerable so
     JSON round-trips and Object.keys() enumeration stay predictable. */
  function defineText(obj, prop, key) {
    Object.defineProperty(obj, prop, {
      enumerable: false,
      configurable: true,
      get: function () { return tr(key); }
    });
  }

  /* ------------------------------------------------------------- fingers */

  var FINGERS = {
    L5: { id: 'L5', hand: 'L', order: 1 },
    L4: { id: 'L4', hand: 'L', order: 2 },
    L3: { id: 'L3', hand: 'L', order: 3 },
    L2: { id: 'L2', hand: 'L', order: 4 },
    T:  { id: 'T',  hand: '-', order: 5 },
    R2: { id: 'R2', hand: 'R', order: 6 },
    R3: { id: 'R3', hand: 'R', order: 7 },
    R4: { id: 'R4', hand: 'R', order: 8 },
    R5: { id: 'R5', hand: 'R', order: 9 }
  };

  var FINGER_ORDER = ['L5', 'L4', 'L3', 'L2', 'T', 'R2', 'R3', 'R4', 'R5'];

  /* `label` is translated on read, so a language switch needs no reload. */
  FINGER_ORDER.forEach(function (id) {
    defineText(FINGERS[id], 'label', 'finger.' + id);
  });

  function fingerLabel(id) {
    return (id && FINGERS[id]) ? FINGERS[id].label : null;
  }

  /* Shift is pressed by the pinky of the opposite hand. */
  function shiftFingerOf(finger) {
    if (finger === 'T') return null;
    return FINGERS[finger].hand === 'L' ? 'R5' : 'L5';
  }

  function shiftSideOf(finger) {
    if (finger === 'T') return null;
    return FINGERS[finger].hand === 'L' ? 'R' : 'L';
  }

  /* -------------------------------------------- symbol names (translated) */

  /* Character → dictionary key. Using a named key rather than the character
     itself keeps keys readable and avoids punctuation in attribute values. */
  var CHAR_KEY = {
    ' ': 'char.space',
    '!': 'char.exclam',
    '"': 'char.quotedbl',
    '#': 'char.hash',
    '$': 'char.dollar',
    '%': 'char.percent',
    '&': 'char.amp',
    "'": 'char.apos',
    '(': 'char.parenleft',
    ')': 'char.parenright',
    '*': 'char.asterisk',
    '+': 'char.plus',
    ',': 'char.comma',
    '-': 'char.minus',
    '.': 'char.period',
    '/': 'char.slash',
    ':': 'char.colon',
    ';': 'char.semicolon',
    '<': 'char.less',
    '=': 'char.equal',
    '>': 'char.greater',
    '?': 'char.question',
    '@': 'char.at',
    '[': 'char.bracketleft',
    '\\': 'char.backslash',
    ']': 'char.bracketright',
    '^': 'char.caret',
    '_': 'char.underscore',
    '`': 'char.grave',
    '{': 'char.braceleft',
    '|': 'char.pipe',
    '}': 'char.braceright',
    '~': 'char.tilde'
  };

  function charName(ch) {
    if (!ch) return tr('char.unknown');
    if (CHAR_KEY[ch]) return tr(CHAR_KEY[ch]);
    if (/[A-Z]/.test(ch)) return tr('char.upper', { ch: ch });
    if (/[a-z]/.test(ch)) return tr('char.lower', { ch: ch });
    if (/[0-9]/.test(ch)) return tr('char.digit', { ch: ch });
    return tr('char.unknown');
  }

  /* --------------------------------------------------------- key layout */

  /* Each entry: { code, base, shifted, finger } for character keys, or
     { code, name, w, finger } for modifier keys. `w` is the width in units of
     1u (a standard letter key); missing means 1u. `home` marks the F/J bumps.
     The five rows must each total 15u — the test suite asserts this. */

  var ROWS = [
    [ /* number row: 13 keys + Backspace(2u) = 15u */
      { code: 'Backquote',    base: '`', shifted: '~', finger: 'L5' },
      { code: 'Digit1',       base: '1', shifted: '!', finger: 'L5' },
      { code: 'Digit2',       base: '2', shifted: '@', finger: 'L4' },
      { code: 'Digit3',       base: '3', shifted: '#', finger: 'L3' },
      { code: 'Digit4',       base: '4', shifted: '$', finger: 'L2' },
      { code: 'Digit5',       base: '5', shifted: '%', finger: 'L2' },
      { code: 'Digit6',       base: '6', shifted: '^', finger: 'R2' },
      { code: 'Digit7',       base: '7', shifted: '&', finger: 'R2' },
      { code: 'Digit8',       base: '8', shifted: '*', finger: 'R3' },
      { code: 'Digit9',       base: '9', shifted: '(', finger: 'R4' },
      { code: 'Digit0',       base: '0', shifted: ')', finger: 'R5' },
      { code: 'Minus',        base: '-', shifted: '_', finger: 'R5' },
      { code: 'Equal',        base: '=', shifted: '+', finger: 'R5' },
      { code: 'Backspace',    name: 'Backspace', w: 2, finger: 'R5' }
    ],
    [ /* top row: Tab(1.5u) + 12 keys + backslash(1.5u) = 15u */
      { code: 'Tab',          name: 'Tab', w: 1.5, finger: 'L5' },
      { code: 'KeyQ',         base: 'q', shifted: 'Q', finger: 'L5' },
      { code: 'KeyW',         base: 'w', shifted: 'W', finger: 'L4' },
      { code: 'KeyE',         base: 'e', shifted: 'E', finger: 'L3' },
      { code: 'KeyR',         base: 'r', shifted: 'R', finger: 'L2' },
      { code: 'KeyT',         base: 't', shifted: 'T', finger: 'L2' },
      { code: 'KeyY',         base: 'y', shifted: 'Y', finger: 'R2' },
      { code: 'KeyU',         base: 'u', shifted: 'U', finger: 'R2' },
      { code: 'KeyI',         base: 'i', shifted: 'I', finger: 'R3' },
      { code: 'KeyO',         base: 'o', shifted: 'O', finger: 'R4' },
      { code: 'KeyP',         base: 'p', shifted: 'P', finger: 'R5' },
      { code: 'BracketLeft',  base: '[', shifted: '{', finger: 'R5' },
      { code: 'BracketRight', base: ']', shifted: '}', finger: 'R5' },
      { code: 'Backslash',    base: '\\', shifted: '|', finger: 'R5', w: 1.5 }
    ],
    [ /* home row: Caps(1.75u) + 11 keys + Enter(2.25u) = 15u */
      { code: 'CapsLock',     name: 'Caps', w: 1.75, finger: 'L5' },
      { code: 'KeyA',         base: 'a', shifted: 'A', finger: 'L5' },
      { code: 'KeyS',         base: 's', shifted: 'S', finger: 'L4' },
      { code: 'KeyD',         base: 'd', shifted: 'D', finger: 'L3' },
      { code: 'KeyF',         base: 'f', shifted: 'F', finger: 'L2', home: true },
      { code: 'KeyG',         base: 'g', shifted: 'G', finger: 'L2' },
      { code: 'KeyH',         base: 'h', shifted: 'H', finger: 'R2' },
      { code: 'KeyJ',         base: 'j', shifted: 'J', finger: 'R2', home: true },
      { code: 'KeyK',         base: 'k', shifted: 'K', finger: 'R3' },
      { code: 'KeyL',         base: 'l', shifted: 'L', finger: 'R4' },
      { code: 'Semicolon',    base: ';', shifted: ':', finger: 'R5' },
      { code: 'Quote',        base: "'", shifted: '"', finger: 'R5' },
      { code: 'Enter',        name: 'Enter', w: 2.25, finger: 'R5' }
    ],
    [ /* bottom row: Shift(2.25u) + 10 keys + Shift(2.75u) = 15u */
      { code: 'ShiftLeft',    name: 'Shift', w: 2.25, finger: 'L5' },
      { code: 'KeyZ',         base: 'z', shifted: 'Z', finger: 'L5' },
      { code: 'KeyX',         base: 'x', shifted: 'X', finger: 'L4' },
      { code: 'KeyC',         base: 'c', shifted: 'C', finger: 'L3' },
      { code: 'KeyV',         base: 'v', shifted: 'V', finger: 'L2' },
      { code: 'KeyB',         base: 'b', shifted: 'B', finger: 'L2' },
      { code: 'KeyN',         base: 'n', shifted: 'N', finger: 'R2' },
      { code: 'KeyM',         base: 'm', shifted: 'M', finger: 'R2' },
      { code: 'Comma',        base: ',', shifted: '<', finger: 'R3' },
      { code: 'Period',       base: '.', shifted: '>', finger: 'R4' },
      { code: 'Slash',        base: '/', shifted: '?', finger: 'R5' },
      { code: 'ShiftRight',   name: 'Shift', w: 2.75, finger: 'R5' }
    ],
    [ /* bottom: 7 modifier keys at 1.25u + Space(6.25u) = 15u */
      { code: 'ControlLeft',  name: 'Ctrl', w: 1.25, finger: 'L5' },
      { code: 'MetaLeft',     name: 'Win', w: 1.25, finger: 'L5' },
      { code: 'AltLeft',      name: 'Alt', w: 1.25, finger: 'T' },
      { code: 'Space',        base: ' ', shifted: null, finger: 'T', w: 6.25 },
      { code: 'AltRight',     name: 'Alt', w: 1.25, finger: 'T' },
      { code: 'MetaRight',    name: 'Win', w: 1.25, finger: 'R5' },
      { code: 'ContextMenu',  name: 'Menu', w: 1.25, finger: 'R5' },
      { code: 'ControlRight', name: 'Ctrl', w: 1.25, finger: 'R5' }
    ]
  ];

  /* Legacy legends that keep an English default and gain a translation. */
  var LEGEND_KEY = {
    'Backspace': null, 'Tab': null, 'Enter': null, 'Shift': null,
    'Ctrl': null, 'Win': null, 'Alt': null,
    'Caps': 'key.caps', 'Menu': 'key.menu'
  };

  /* --------------------------------------------------- build the indexes */

  var BY_CODE = Object.create(null);
  var BY_CHAR = Object.create(null);

  ROWS.forEach(function (row, rowIndex) {
    row.forEach(function (k) {
      var def = {
        code: k.code,
        base: k.base === undefined ? null : k.base,
        shifted: k.shifted === undefined ? null : k.shifted,
        name: k.name || null,
        /* Translated legend for the few keys whose English label is not
           obviously right; everything else keeps its literal legend. */
        legendKey: k.name && LEGEND_KEY[k.name] ? LEGEND_KEY[k.name] : null,
        finger: k.finger,
        shiftFinger: shiftFingerOf(k.finger),
        shiftSide: shiftSideOf(k.finger),
        w: k.w || 1,
        home: !!k.home,
        row: rowIndex
      };
      BY_CODE[k.code] = def;

      if (def.base !== null && def.base !== undefined) {
        BY_CHAR[def.base] = {
          code: def.code, base: def.base, shifted: def.shifted,
          finger: def.finger, needsShift: false,
          shiftFinger: def.shiftFinger, shiftSide: def.shiftSide,
          row: rowIndex
        };
        defineText(BY_CHAR[def.base], 'name', CHAR_KEY[def.base] || 'char.unknown');
      }
      if (def.shifted) {
        /* Same physical key, shifted layer: a distinct target with its own
           keyId in the statistics. */
        BY_CHAR[def.shifted] = {
          code: def.code, base: def.base, shifted: def.shifted,
          finger: def.finger, needsShift: true,
          shiftFinger: def.shiftFinger, shiftSide: def.shiftSide,
          row: rowIndex
        };
        defineText(BY_CHAR[def.shifted], 'name', CHAR_KEY[def.shifted] || 'char.unknown');
      }
    });
  });

  /* -------------------------------------------------- character classes */

  /* Printable ASCII — the full set this trainer can drill. */
  function isPrintable(ch) {
    if (!ch || ch.length !== 1) return false;
    var c = ch.charCodeAt(0);
    return c >= 0x20 && c <= 0x7e;
  }

  /* Symbol: printable ASCII that is neither alphanumeric nor whitespace.
     This is the target set for "symbols only" mode. */
  function isSymbol(ch) {
    return isPrintable(ch) && !/[A-Za-z0-9\s]/.test(ch);
  }

  function isAlnum(ch) { return /[A-Za-z0-9]/.test(ch); }
  function isSpace(ch) { return ch === ' ' || ch === '\t'; }

  /* ------------------------------------------------------------ queries */

  function lookup(ch) {
    return BY_CHAR[ch] || null;
  }

  function keyByCode(code) { return BY_CODE[code] || null; }

  /* Infer the Shift side from a key event.
     Caveat: for a character key event, location is always 0 — location
     describes the key that produced the event, and a held Shift is not that
     key. The engine therefore tracks Shift keydowns separately (see
     Engine.prototype.press) and this helper only backs up tests and synthetic
     events. */
  function shiftSideFromEvent(ev) {
    if (!ev) return null;
    if (ev.location === 1 || ev.code === 'ShiftLeft') return 'L';
    if (ev.location === 2 || ev.code === 'ShiftRight') return 'R';
    return null;
  }

  /**
   * Classify one keystroke against the expected character. This is what
   * separates the drill from a plain typing test:
   *   wrong key / missing Shift / extra Shift / wrong Shift side / Caps Lock
   *
   * expected       the character the drill wants
   * ev             the key event (duck-typed: key, code, shiftKey, location)
   * target         the key definition for `expected`
   * heldShiftSide  side currently held, tracked by the engine ('L' | 'R' | null)
   */
  function classify(expected, ev, target, heldShiftSide) {
    var key = ev.key;
    var code = ev.code;
    var shift = !!ev.shiftKey;

    if (key === expected) {
      if (target && target.needsShift && target.shiftSide) {
        var pressed = heldShiftSide || shiftSideFromEvent(ev);
        if (pressed && pressed !== target.shiftSide) {
          return { ok: true, kind: 'wrong-shift-side', detail: 'wrong Shift side' };
        }
      }
      return { ok: true, kind: 'correct' };
    }

    /* Caps Lock mistaken for a typing error: report it plainly so the user
       does not conclude their fingers are at fault. */
    if (target && /[A-Za-z]/.test(expected) && !shift &&
        expected.toLowerCase() === key.toLowerCase() &&
        ev.getModifierState && ev.getModifierState('CapsLock')) {
      return { ok: false, kind: 'capslock', detail: 'Caps Lock is on' };
    }

    var hit = BY_CODE[code];
    if (hit && target && hit.code === target.code) {
      /* Right physical key, wrong Shift layer. */
      if (target.needsShift && !shift) {
        return { ok: false, kind: 'missing-shift', detail: 'right key, Shift not held' };
      }
      if (!target.needsShift && shift) {
        return { ok: false, kind: 'extra-shift', detail: 'right key, Shift held by mistake' };
      }
      return { ok: false, kind: 'same-key', detail: 'same key, wrong layer' };
    }

    if (hit) {
      return { ok: false, kind: 'wrong-key', detail: 'wrong physical key' };
    }

    return { ok: false, kind: 'other', detail: 'unrecognised key' };
  }

  TD.Keymap = {
    FINGERS: FINGERS,
    FINGER_ORDER: FINGER_ORDER,
    ROWS: ROWS,
    BY_CODE: BY_CODE,
    BY_CHAR: BY_CHAR,
    shiftFingerOf: shiftFingerOf,
    shiftSideOf: shiftSideOf,
    fingerLabel: fingerLabel,
    charName: charName,
    isPrintable: isPrintable,
    isSymbol: isSymbol,
    isAlnum: isAlnum,
    isSpace: isSpace,
    lookup: lookup,
    keyByCode: keyByCode,
    shiftSideFromEvent: shiftSideFromEvent,
    classify: classify,
    /* Finger responsible for a character, or null when unmapped. */
    fingerOf: function (ch) {
      var i = BY_CHAR[ch];
      return i ? i.finger : null;
    }
  };
})(window.TD);
