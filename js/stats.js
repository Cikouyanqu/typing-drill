/* ==========================================================================
   stats.js — statistics aggregation (pure functions: no DOM, no storage)

   Aggregate shape:
     agg = {
       version, keys: { keyId → per-key record },
       confusions: { "expected\u0000typed" → count },
       sessions: [ session summaries ],
       totals: { cumulative counters }
     }

   Each per-key record keeps the most recent MAX_LAT response-time samples
   (a sliding reservoir). The median only needs an approximation, and "the
   last 200 presses" reflects current ability better than "all of history".
   ========================================================================== */

window.TD = window.TD || {};
(function (TD) {
  'use strict';

  var util = TD.util;
  var Keymap = TD.Keymap;

  var MAX_LAT = 200;
  var MAX_SESSIONS = 500;
  var SEP = '\u0000';

  function tr(key, params) {
    return TD.I18n ? TD.I18n.t(key, params) : key;
  }

  function empty() {
    return {
      version: 1,
      keys: Object.create(null),
      confusions: Object.create(null),
      sessions: [],
      totals: { sessions: 0, chars: 0, strokes: 0, errors: 0, ms: 0, bestCpm: 0 }
    };
  }

  /* Fill in missing fields so downstream code never has to guard. */
  function normalize(agg) {
    if (!agg || typeof agg !== 'object') return empty();
    if (!agg.keys || typeof agg.keys !== 'object') agg.keys = Object.create(null);
    if (!agg.confusions || typeof agg.confusions !== 'object') agg.confusions = Object.create(null);
    if (!Array.isArray(agg.sessions)) agg.sessions = [];
    if (!agg.totals || typeof agg.totals !== 'object') {
      agg.totals = { sessions: 0, chars: 0, strokes: 0, errors: 0, ms: 0, bestCpm: 0 };
    }
    var t = agg.totals;
    ['sessions', 'chars', 'strokes', 'errors', 'ms', 'bestCpm'].forEach(function (k) {
      if (typeof t[k] !== 'number' || !isFinite(t[k])) t[k] = 0;
    });
    agg.version = 1;
    return agg;
  }

  /* ------------------------------------------------- merge one session */

  function mergeSession(agg, result) {
    normalize(agg);
    var ts = result.finishedAt || Date.now();

    agg.totals.sessions++;
    agg.totals.chars += result.typedCount || 0;
    agg.totals.strokes += result.totalStrokes || 0;
    agg.totals.errors += result.errorStrokes || 0;
    agg.totals.ms += result.elapsedMs || 0;
    if ((result.cpm || 0) > agg.totals.bestCpm) agg.totals.bestCpm = result.cpm || 0;

    (result.keyDeltas || []).forEach(function (d) {
      var rec = agg.keys[d.keyId];
      if (!rec) {
        rec = agg.keys[d.keyId] = {
          keyId: d.keyId, code: d.code, char: d.char,
          needsShift: !!d.needsShift, finger: d.finger || null,
          attempts: 0, errors: 0, lat: [],
          firstSeen: ts, lastSeen: ts
        };
      }
      rec.attempts += d.attempts || 0;
      rec.errors += d.errors || 0;
      rec.char = d.char || rec.char;
      rec.needsShift = !!d.needsShift;
      if (d.finger) rec.finger = d.finger;
      if (d.latency && d.latency.length) {
        for (var i = 0; i < d.latency.length; i++) rec.lat.push(d.latency[i]);
        if (rec.lat.length > MAX_LAT) rec.lat = rec.lat.slice(-MAX_LAT);
      }
      rec.lastSeen = ts;
    });

    (result.confusions || []).forEach(function (c) {
      var k = c.expected + SEP + c.typed;
      agg.confusions[k] = (agg.confusions[k] || 0) + (c.count || 0);
    });

    agg.sessions.push({
      ts: ts,
      mode: result.mode || 'symbols',
      title: result.title || '',
      symbolOnly: !!result.symbolOnly,
      cpm: result.cpm || 0,
      wpm: result.wpm || 0,
      firstTryRate: result.firstTryRate || 0,
      rawAccuracy: result.rawAccuracy || 0,
      typedCount: result.typedCount || 0,
      errorStrokes: result.errorStrokes || 0,
      elapsedMs: result.elapsedMs || 0,
      coldStart: !!result.coldStart,
      packIds: result.packIds || null,
      groupIds: result.groupIds || null
    });

    if (agg.sessions.length > MAX_SESSIONS) {
      agg.sessions = agg.sessions.slice(-MAX_SESSIONS);
    }
    return agg;
  }

  /* ------------------------------------------------------ per-key report */

  function medianMs(rec) {
    if (!rec.lat || !rec.lat.length) return null;
    return util.median(rec.lat);
  }

  /* Display name for a key's character; whitespace gets a readable label. */
  function charLabel(ch) {
    if (ch === ' ') return tr('key.space');
    if (ch === '\t') return tr('key.tab');
    return ch;
  }

  /* Where the character sits and which layer it uses. */
  function keyHint(rec) {
    var info = Keymap.lookup(rec.char);
    if (!info) return '—';
    var base = Keymap.charName(info.base);
    return info.needsShift ? tr('stats.keyHint.shift', { base: base }) : base;
  }

  function keyRows(agg) {
    normalize(agg);
    var rows = Object.keys(agg.keys).map(function (k) {
      var rec = agg.keys[k];
      var med = medianMs(rec);
      return {
        keyId: rec.keyId,
        code: rec.code,
        char: rec.char,
        label: charLabel(rec.char),
        needsShift: !!rec.needsShift,
        finger: rec.finger,
        fingerLabel: Keymap.fingerLabel(rec.finger) || tr('common.dash'),
        keyHint: keyHint(rec),
        attempts: rec.attempts,
        errors: rec.errors,
        errorRate: rec.attempts ? rec.errors / rec.attempts : 0,
        medianMs: med,
        samples: rec.lat ? rec.lat.length : 0,
        heat: heatLevel(rec)
      };
    });
    rows.sort(function (a, b) { return b.attempts - a.attempts; });
    return rows;
  }

  /* Heat bucket for one key: -1 = no data, 1 = good, 4 = poor. */
  function heatLevel(rec) {
    if (!rec || !rec.attempts) return -1;
    var rate = rec.errors / rec.attempts;
    if (rate <= 0.03) return 1;
    if (rate <= 0.08) return 2;
    if (rate <= 0.18) return 3;
    return 4;
  }

  /* code → heat bucket, for colouring the on-screen keyboard. Both layers of
     one physical key are merged, since that is what the drawing shows. */
  function heatByCode(agg) {
    normalize(agg);
    var acc = Object.create(null);
    Object.keys(agg.keys).forEach(function (k) {
      var rec = agg.keys[k];
      var e = acc[rec.code];
      if (!e) e = acc[rec.code] = { attempts: 0, errors: 0 };
      e.attempts += rec.attempts;
      e.errors += rec.errors;
    });
    var out = Object.create(null);
    Object.keys(acc).forEach(function (code) {
      var e = acc[code];
      out[code] = e.attempts ? heatLevel({ attempts: e.attempts, errors: e.errors }) : -1;
    });
    return out;
  }

  /* --------------------------------------------------- per-finger summary */

  function fingerRows(agg) {
    normalize(agg);
    var acc = Object.create(null);
    Object.keys(agg.keys).forEach(function (k) {
      var rec = agg.keys[k];
      if (!rec.finger) return;
      var e = acc[rec.finger];
      if (!e) e = acc[rec.finger] = { finger: rec.finger, attempts: 0, errors: 0, lat: [] };
      e.attempts += rec.attempts;
      e.errors += rec.errors;
      if (rec.lat && rec.lat.length) {
        /* A finger-level median needs far fewer samples; thin them out. */
        var step = Math.max(1, Math.ceil(rec.lat.length / 40));
        for (var i = 0; i < rec.lat.length; i += step) e.lat.push(rec.lat[i]);
      }
    });
    return Keymap.FINGER_ORDER.map(function (fid) {
      var e = acc[fid];
      var meta = Keymap.FINGERS[fid];
      if (!e) {
        return {
          finger: fid, label: meta.label, hand: meta.hand,
          attempts: 0, errors: 0, errorRate: 0, medianMs: null
        };
      }
      return {
        finger: fid,
        label: meta.label,
        hand: meta.hand,
        attempts: e.attempts,
        errors: e.errors,
        errorRate: e.attempts ? e.errors / e.attempts : 0,
        medianMs: e.lat.length ? util.median(e.lat) : null
      };
    });
  }

  /* ------------------------------------------------ most common mix-ups */

  function confusionRows(agg, limit) {
    normalize(agg);
    var rows = Object.keys(agg.confusions).map(function (k) {
      var p = k.split(SEP);
      return { expected: p[0], typed: p[1], count: agg.confusions[k] };
    });
    rows.sort(function (a, b) { return b.count - a.count; });
    return rows.slice(0, limit || 10);
  }

  /* ------------------------------------------------------------- trend */

  function trend(agg, limit) {
    normalize(agg);
    var s = agg.sessions;
    var n = limit || 60;
    var slice = s.length > n ? s.slice(-n) : s;
    var points = slice.map(function (x, i) {
      return { i: i, ts: x.ts, cpm: x.cpm || 0, acc: x.firstTryRate || 0, mode: x.mode, title: x.title };
    });
    var cpms = points.map(function (p) { return p.cpm; });
    return {
      points: points,
      minCpm: cpms.length ? Math.min.apply(null, cpms) : 0,
      maxCpm: cpms.length ? Math.max.apply(null, cpms) : 0,
      total: s.length
    };
  }

  /* ---------------------------------------------------------- overview */

  function summary(agg) {
    normalize(agg);
    var t = agg.totals;
    return {
      sessions: t.sessions,
      chars: t.chars,
      strokes: t.strokes,
      errors: t.errors,
      ms: t.ms,
      bestCpm: t.bestCpm,
      avgCpm: t.ms > 0 ? (t.chars / (t.ms / 60000)) : 0,
      accuracy: t.strokes ? 1 - (t.errors / t.strokes) : 1,
      keyCount: Object.keys(agg.keys).length
    };
  }

  TD.Stats = {
    MAX_LAT: MAX_LAT,
    MAX_SESSIONS: MAX_SESSIONS,
    SEP: SEP,
    empty: empty,
    normalize: normalize,
    mergeSession: mergeSession,
    keyRows: keyRows,
    heatLevel: heatLevel,
    heatByCode: heatByCode,
    fingerRows: fingerRows,
    confusionRows: confusionRows,
    trend: trend,
    summary: summary,
    charLabel: charLabel,
    keyHint: keyHint,
    medianMs: medianMs
  };
})(window.TD);
