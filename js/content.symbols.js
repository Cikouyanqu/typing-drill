/* ==========================================================================
   content.symbols.js — symbol drill groups and generation

   Groups are organised by "which finger has to move", not by character table.
   The pain of programming symbols concentrates in the two pinkies: { } | \ ; :
   ' " / ? all sit under the right pinky, ! @ # ` ~ under the left, and the
   hardest skill is switching between the two layers of the SAME key.

   Labels and descriptions are read from the dictionary at access time, so a
   language switch needs no reload.
   ========================================================================== */

window.TD = window.TD || {};
(function (TD) {
  'use strict';

  var util = TD.util;
  var Keymap = TD.Keymap;

  function tr(key, params) {
    return TD.I18n ? TD.I18n.t(key, params) : key;
  }

  function joinList(items) {
    return TD.I18n ? TD.I18n.joinList(items) : items.join(', ');
  }

  function defineText(obj, prop, key) {
    Object.defineProperty(obj, prop, {
      enumerable: false,
      configurable: true,
      get: function () { return tr(key); }
    });
  }

  /* --------------------------------------------------------------- groups */

  var GROUPS = [
    {
      id: 'paren-basic',
      tokens: ['(', ')', '[', ']', '{', '}', '()', '[]', '{}']
    },
    {
      id: 'digit-pairs',
      tokens: ['1!', '2@', '3#', '4$', '5%', '6^', '7&', '8*', '9(', '0)']
    },
    {
      id: 'angle-quote',
      tokens: ['<', '>', '"', "'", '`', '<>', '""', "''", '``']
    },
    {
      id: 'operators',
      tokens: ['=', '==', '===', '!=', '!==', '<=', '>=', '&&', '||', '??', '?.', '!']
    },
    {
      id: 'assign-op',
      tokens: ['+=', '-=', '*=', '/=', '%=', '++', '--', '>>=', '<<=']
    },
    {
      id: 'arrows-scope',
      tokens: ['=>', '->', '::', ':', '.', ',', ';', '...', '?.', '#']
    },
    {
      id: 'rare-keys',
      tokens: ['~', '^', '%', '$', '#', '@', '!', '\\', '|', '&', '*', '+', '?', '/']
    },
    {
      id: 'lower-layer',
      tokens: ['-', '=', '[', ']', '\\', ';', "'", ',', '.', '/', '`']
    },
    {
      id: 'upper-layer',
      tokens: ['_', '+', '{', '}', '|', ':', '"', '<', '>', '?', '~']
    },
    {
      id: 'layer-pairs',
      tokens: ['-_', '=+', '[{', ']}', '\\|', ';:', '\'"', ',<', '.>', '/?', '`~']
    },
    {
      id: 'nesting',
      tokens: ['({})', '[{}]', '{[]}', '({[]})', '([])', '{{}}', '((()))', 'f({})', 'a[0]', '{},']
    },
    {
      id: 'left-pinky',
      tokens: ['`', '~', '!', '@', '#', '1', '2', '3', 'q', 'a', 'z']
    },
    {
      id: 'right-pinky',
      tokens: ['-', '_', '=', '+', '0', ')', '[', '{', ']', '}', '\\', '|', ';', ':', "'", '"', '/', '?']
    }
  ];

  var BY_ID = Object.create(null);
  GROUPS.forEach(function (g) { BY_ID[g.id] = g; });

  /* All distinct characters appearing in a group, used by the adaptive drill
     to score snippet lines. */
  function charsOf(group) {
    var seen = Object.create(null);
    var out = [];
    group.tokens.forEach(function (t) {
      for (var i = 0; i < t.length; i++) {
        var ch = t[i];
        if (!seen[ch]) { seen[ch] = 1; out.push(ch); }
      }
    });
    return out;
  }

  /* Derive the rest of each group once: character set, fingers involved, and
     how much of it needs Shift. */
  GROUPS.forEach(function (g) {
    defineText(g, 'label', 'group.' + g.id + '.label');
    defineText(g, 'desc', 'group.' + g.id + '.desc');

    g.chars = charsOf(g);
    var fingers = [];
    g.chars.forEach(function (ch) {
      var f = Keymap.fingerOf(ch);
      if (f && fingers.indexOf(f) === -1) fingers.push(f);
    });
    fingers.sort(function (a, b) { return Keymap.FINGERS[a].order - Keymap.FINGERS[b].order; });
    g.fingers = fingers;

    var need = g.chars.filter(function (ch) {
      var i = Keymap.lookup(ch);
      return i && i.needsShift;
    }).length;
    g.shiftRatio = g.chars.length ? need / g.chars.length : 0;
  });

  /* ---------------------------------------------------------- generation */

  function tokensToLine(tokens, rng, count, style) {
    var parts = [];
    var i, t, prev = null;

    if (style === 'alternate' && tokens.length >= 2) {
      /* Two tokens alternating: trains the rise and fall of the Shift key on
         one physical key. */
      var a = util.pick(tokens, rng);
      var b = util.pick(tokens, rng);
      for (i = 0; i < count; i++) parts.push(i % 2 ? b : a);
      return parts.join(' ');
    }

    for (i = 0; i < count; i++) {
      t = util.pick(tokens, rng);
      /* Avoid the same token three times running: after that the fingers go on
         autopilot and stop reading the character. */
      if (t === prev) {
        var guard = 0;
        while (t === prev && guard < 10) { t = util.pick(tokens, rng); guard++; }
      }
      parts.push(t);
      prev = t;
    }
    return parts.join(' ');
  }

  /**
   * Generate a symbol drill.
   * opts: {
   *   groupIds: string[]    groups to include; empty means all
   *   lines: number
   *   tokensPerLine: number
   *   seed: number          omit for random; same seed reproduces the same set
   *   style: 'flat' | 'alternate' | 'mixed'
   * }
   */
  function generate(opts) {
    opts = opts || {};
    var ids = (opts.groupIds && opts.groupIds.length) ? opts.groupIds : GROUPS.map(function (g) { return g.id; });
    var picked = ids.map(function (id) { return BY_ID[id]; }).filter(Boolean);
    if (!picked.length) picked = GROUPS.slice();

    var seed = opts.seed === undefined || opts.seed === null ? util.newSeed() : (opts.seed >>> 0);
    var rng = util.mulberry32(seed);
    var lines = opts.lines || 3;
    var perLine = opts.tokensPerLine || 10;
    var style = opts.style || 'mixed';

    /* Rotate through the groups so one session covers several of them instead
       of repeating the same group line after line. */
    var order = util.shuffle(picked, rng);
    var out = [];
    var usedGroups = [];
    var usedTokens = [];

    for (var li = 0; li < lines; li++) {
      var g = order[li % order.length];
      if (usedGroups.indexOf(g.id) === -1) usedGroups.push(g.id);

      var lineStyle = style;
      if (style === 'mixed') lineStyle = rng() < 0.35 ? 'alternate' : 'flat';
      /* Alternating needs at least two distinct tokens. */
      if (lineStyle === 'alternate' && g.tokens.length < 2) lineStyle = 'flat';

      var text = tokensToLine(g.tokens, rng, perLine, lineStyle);
      if (text.length) {
        out.push(text);
        g.tokens.forEach(function (t) { if (usedTokens.indexOf(t) === -1) usedTokens.push(t); });
      }
    }

    return {
      mode: 'symbols',
      seed: seed,
      groupIds: usedGroups,
      lines: out,
      text: out.join('\n'),
      title: tr('drill.symbols', {
        groups: joinList(usedGroups.map(function (id) { return BY_ID[id].label; }))
      })
    };
  }

  /**
   * Generate from an arbitrary token list. Used by the adaptive drill to build
   * back-and-forth rows out of the weakest symbols.
   */
  function generateFromTokens(tokens, opts) {
    opts = opts || {};
    if (!tokens || !tokens.length) {
      return { mode: 'symbols', seed: 0, groupIds: [], lines: [], text: '', title: tr('drill.symbols', { groups: '' }) };
    }
    var seed = opts.seed === undefined || opts.seed === null ? util.newSeed() : (opts.seed >>> 0);
    var rng = util.mulberry32(seed);
    var lines = opts.lines || 2;
    var perLine = opts.tokensPerLine || 12;
    var style = opts.style || 'mixed';
    var out = [];
    for (var i = 0; i < lines; i++) {
      var s = style;
      if (style === 'mixed') s = rng() < 0.4 ? 'alternate' : 'flat';
      if (s === 'alternate' && tokens.length < 2) s = 'flat';
      out.push(tokensToLine(tokens, rng, perLine, s));
    }
    return {
      mode: 'symbols',
      seed: seed,
      groupIds: [],
      lines: out,
      text: out.join('\n'),
      title: opts.title || tr('drill.focusWeak')
    };
  }

  TD.SymbolDrills = {
    GROUPS: GROUPS,
    byId: function (id) { return BY_ID[id] || null; },
    charsOf: charsOf,
    generate: generate,
    generateFromTokens: generateFromTokens
  };
})(window.TD);
