/* ==========================================================================
   adaptive.js — weak-key drill generation

   Approach: rather than picking content at random, rank the user's per-key
   records to find the weakest keys, then
     1. build back-and-forth rows out of those symbols — including the OTHER
        layer of the same physical key, because missing-Shift mistakes can only
        be trained by contrasting the two layers;
     2. pull real code lines from the snippet library that actually contain
        those characters, so the pattern is rehearsed in real context.

   The score must be monotonic: all else equal, more errors means a higher
   score. The test suite asserts this.
   ========================================================================== */

window.TD = window.TD || {};
(function (TD) {
  'use strict';

  var util = TD.util;
  var Keymap = TD.Keymap;
  var Stats = TD.Stats;
  var Snippets = TD.Snippets;
  var SymbolDrills = TD.SymbolDrills;

  function tr(key, params) {
    return TD.I18n ? TD.I18n.t(key, params) : key;
  }

  function joinList(items) {
    return TD.I18n ? TD.I18n.joinList(items) : items.join(', ');
  }

  var TARGET_MS = 260;         /* "comfortable" ceiling: about 230 CPM between presses */
  var MIN_ATTEMPTS = 3;        /* below this a key is not ranked: one slip is not a weakness */
  var CONFIDENCE_FULL = 40;    /* attempt count at which confidence saturates */
  var CONFIDENCE_FLOOR = 0.1;  /* keeps "1 attempt, 1 error" noise out of the top of the list */
  var ENOUGH_SAMPLES = 8;      /* attempt count from which a conclusion is considered reliable */
  var SLOW_FACTOR = 1.3;       /* median above this multiple of the target counts as a weakness too */

  /* Cold start uses these: establish a baseline before talking about weakness. */
  var COLD_START_GROUPS = ['paren-basic', 'operators', 'arrows-scope', 'nesting'];

  /**
   * Weakness score for one key.
   * Error rate dominates, slowness contributes, both scaled by confidence, and
   * a small bonus for keys that have not been practised for a while.
   */
  function scoreOf(rec, now, minAttempts) {
    var attempts = rec.attempts || 0;
    var floor = minAttempts === undefined ? MIN_ATTEMPTS : minAttempts;
    if (attempts < floor) return 0;

    var errorRate = (rec.errors || 0) / attempts;
    var med = (rec.lat && rec.lat.length) ? util.median(rec.lat) : 0;
    var speedFactor = med > 0 ? util.clamp(med / TARGET_MS, 0, 2.5) / 2.5 : 0.5;
    var confidence = util.clamp(attempts / CONFIDENCE_FULL, CONFIDENCE_FLOOR, 1);

    var days = rec.lastSeen ? ((now || Date.now()) - rec.lastSeen) / 86400000 : 0;
    var recency = util.clamp(days / 7, 0, 1) * 0.15;

    return (0.7 * errorRate + 0.3 * speedFactor) * confidence + recency;
  }

  /**
   * Rank weak keys.
   * opts: { minAttempts, limit, now }
   */
  function rankWeakKeys(agg, opts) {
    opts = opts || {};
    var now = opts.now || Date.now();
    var min = opts.minAttempts === undefined ? MIN_ATTEMPTS : opts.minAttempts;
    Stats.normalize(agg);

    var rows = Object.keys(agg.keys).map(function (k) {
      var rec = agg.keys[k];
      var med = (rec.lat && rec.lat.length) ? util.median(rec.lat) : null;
      var attempts = rec.attempts || 0;
      var errors = rec.errors || 0;
      return {
        keyId: rec.keyId,
        code: rec.code,
        char: rec.char,
        label: Stats.charLabel(rec.char),
        needsShift: !!rec.needsShift,
        finger: rec.finger,
        fingerLabel: Keymap.fingerLabel(rec.finger) || tr('common.dash'),
        keyHint: Stats.keyHint(rec),
        attempts: attempts,
        errors: errors,
        errorRate: attempts ? errors / attempts : 0,
        medianMs: med,
        /* Accurate but slow is still a weakness, just a different kind — the
           interface has to distinguish the two. */
        slow: !!(med !== null && med > TARGET_MS * SLOW_FACTOR),
        enoughSamples: attempts >= ENOUGH_SAMPLES,
        score: scoreOf(rec, now, min)
      };
    }).filter(function (r) {
      if (r.score <= 0) return false;
      /* Keep only keys with a real weakness signal: either they were typed
         wrong, or they are noticeably slow. A key that is neither has simply
         been practised — listing it as a weakness misleads the user. */
      return r.errors > 0 || r.slow;
    });

    rows.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return b.errorRate - a.errorRate;
    });
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return rows;
  }

  /* Weak characters → practice tokens. The other layer of the same physical
     key comes along, which is what trains the Shift rhythm. */
  function buildTokens(focus, max) {
    var out = [];
    focus.forEach(function (f) {
      var info = Keymap.lookup(f.char);
      var pair = [f.char];
      if (info) {
        var partner = info.needsShift ? info.base : info.shifted;
        if (partner) pair.push(partner);
      }
      pair.forEach(function (ch) {
        if (ch && out.indexOf(ch) === -1) out.push(ch);
      });
    });
    return out.slice(0, max || 12);
  }

  /**
   * Build one weak-key drill.
   * opts: { seed, lines, packIds, now }
   */
  function buildDrill(agg, opts) {
    opts = opts || {};
    var seed = opts.seed === undefined || opts.seed === null ? util.newSeed() : (opts.seed >>> 0);
    var totalLines = opts.lines || 4;

    /* Rank with the normal threshold; then relax it; only then give up. */
    var ranked = rankWeakKeys(agg, { minAttempts: MIN_ATTEMPTS, now: opts.now });
    if (!ranked.length) ranked = rankWeakKeys(agg, { minAttempts: 1, now: opts.now });

    if (!ranked.length) {
      /* Two different situations: no data at all (cold start) versus data that
         shows no weakness. Calling the second one a cold start would make the
         user think the statistics are not working. */
      var hasData = Object.keys(agg.keys || {}).length > 0;
      var cold = SymbolDrills.generate({
        groupIds: COLD_START_GROUPS,
        lines: Math.max(2, totalLines - 1),
        tokensPerLine: 10,
        seed: seed
      });
      cold.mode = 'adaptive';
      cold.coldStart = !hasData;
      cold.focus = [];
      if (hasData) {
        cold.title = tr('drill.adaptiveReview');
        cold.note = tr('note.adaptiveReview');
      } else {
        cold.title = tr('drill.adaptiveCold');
        cold.note = tr('note.adaptiveCold');
      }
      return cold;
    }

    var focus = ranked.slice(0, 6);
    var preferChars = focus.map(function (f) { return f.char; });

    /* First half: weak symbols back and forth to warm up the finger pattern.
       Second half: real code lines containing them. */
    var symLines = Math.max(1, Math.ceil(totalLines / 2));
    var codeLines = Math.max(0, totalLines - symLines);

    var symPart = SymbolDrills.generateFromTokens(buildTokens(focus, 12), {
      lines: symLines, tokensPerLine: 12, seed: seed, style: 'mixed'
    });

    var codePart = codeLines > 0
      ? Snippets.generate({
          packIds: opts.packIds, lines: codeLines, seed: (seed + 1) >>> 0,
          density: 'high', preferChars: preferChars
        })
      : { lines: [], meta: [] };

    var lines = symPart.lines.concat(codePart.lines || []);

    return {
      mode: 'adaptive',
      seed: seed,
      coldStart: false,
      lines: lines,
      text: lines.join('\n'),
      focus: focus,
      packIds: codePart.packIds || [],
      title: tr('drill.adaptiveWeak', {
        list: joinList(focus.slice(0, 4).map(function (f) { return f.label; }))
      }),
      note: tr('note.adaptiveWeak')
    };
  }

  TD.Adaptive = {
    TARGET_MS: TARGET_MS,
    MIN_ATTEMPTS: MIN_ATTEMPTS,
    ENOUGH_SAMPLES: ENOUGH_SAMPLES,
    SLOW_FACTOR: SLOW_FACTOR,
    COLD_START_GROUPS: COLD_START_GROUPS,
    scoreOf: scoreOf,
    rankWeakKeys: rankWeakKeys,
    buildTokens: buildTokens,
    buildDrill: buildDrill
  };
})(window.TD);
