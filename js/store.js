/* ==========================================================================
   store.js — persistence

   Two real-world problems this has to handle:

   1. Under file://, Chromium's policy on localStorage varies by version, so it
      cannot be assumed writable. Startup runs a write-read-delete probe; if it
      fails the whole store degrades to memory and the interface says so.

   2. A save file can be corrupted by hand-editing or an incompatible version.
      On a parse failure the original text is copied to a `.corrupt` key before
      starting fresh — user data is never silently destroyed.
   ========================================================================== */

window.TD = window.TD || {};
(function (TD) {
  'use strict';

  var Stats = TD.Stats;

  var KEY = 'typing-drill/v1';
  var CORRUPT_KEY = 'typing-drill/v1.corrupt';
  var PROBE_KEY = 'typing-drill/__probe__';

  var DEFAULT_SETTINGS = {
    theme: 'auto',            /* auto | light | dark */
    lang: 'auto',             /* auto | zh-CN | en */
    symbolOnly: false,        /* symbols only: letters and digits are skipped */
    allowBackspace: true,     /* false = strict mode, Backspace does nothing */
    showKeyboard: true,
    showFingerHint: true,     /* highlight target key and its finger region */
    fontSize: 28,
    lines: 3,
    tokensPerLine: 10,
    density: 'any',           /* any | high */
    sound: false,
    mode: 'symbols',          /* symbols | code | adaptive | custom */
    groupIds: null,           /* null = all groups */
    packIds: null,
    customId: null,
    sidebarCollapsed: false,
    optionsExpanded: false,
    /* keyboard tester */
    testerLayout: 'full',     /* full | tkl | compact */
    testerSound: false
  };

  function deepDefaults(target, defaults) {
    var out = {};
    Object.keys(defaults).forEach(function (k) {
      out[k] = (target && target[k] !== undefined && target[k] !== null) ? target[k] : defaults[k];
    });
    /* Keep fields the user has but this version does not define, so hand-added
       settings survive a round trip. */
    if (target) {
      Object.keys(target).forEach(function (k) { if (!(k in out)) out[k] = target[k]; });
    }
    return out;
  }

  var Store = {
    KEY: KEY,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,

    /* probe result */
    available: false,
    probed: false,
    reason: '',
    backend: 'memory',

    settings: deepDefaults(null, DEFAULT_SETTINGS),
    agg: Stats.empty(),
    custom: [],
    corrupt: false,

    /* --------------------------------------------------- low-level access */

    _rawGet: function (k) {
      try {
        if (this.backend === 'local') return window.localStorage.getItem(k);
      } catch (e) { /* fall through to memory */ }
      return (this._mem && Object.prototype.hasOwnProperty.call(this._mem, k)) ? this._mem[k] : null;
    },

    _rawSet: function (k, v) {
      if (this.backend === 'local') {
        try {
          window.localStorage.setItem(k, v);
          return { ok: true };
        } catch (e) {
          /* Quota exceeded or policy changed: degrade to memory rather than
             letting the whole session fail. */
          this.backend = 'memory';
          this.available = false;
          this.reason = (e && e.name) || 'write-failed';
        }
      }
      this._mem = this._mem || Object.create(null);
      this._mem[k] = v;
      return { ok: true, memory: true };
    },

    /* Write, read back, delete. Any failure means storage is unusable. */
    probe: function () {
      this._mem = Object.create(null);
      this.probed = true;
      try {
        var ls = window.localStorage;
        if (!ls) throw new Error('no-localStorage');
        ls.setItem(PROBE_KEY, '1');
        var back = ls.getItem(PROBE_KEY);
        ls.removeItem(PROBE_KEY);
        if (back !== '1') throw new Error('readback-mismatch');
        this.backend = 'local';
        this.available = true;
        this.reason = '';
      } catch (e) {
        this.backend = 'memory';
        this.available = false;
        this.reason = (e && (e.name || e.message)) || 'unavailable';
      }
      return { available: this.available, backend: this.backend, reason: this.reason };
    },

    /* Test helper: return to the unprobed initial state. */
    _resetForTest: function () {
      this.probed = false;
      this.backend = 'memory';
      this.available = false;
      this.reason = '';
      this._mem = Object.create(null);
      this.settings = deepDefaults(null, DEFAULT_SETTINGS);
      this.agg = Stats.empty();
      this.custom = [];
      this.corrupt = false;
    },

    /* ------------------------------------------------------------- load */

    load: function () {
      if (!this.probed) this.probe();

      var raw = this._rawGet(KEY);
      this.corrupt = false;

      if (raw) {
        var data = null;
        try {
          data = JSON.parse(raw);
        } catch (e) {
          /* Unparseable: keep the original text, then start fresh. */
          this._rawSet(CORRUPT_KEY, raw);
          this.corrupt = true;
          data = null;
        }
        if (data && typeof data === 'object') {
          this.settings = deepDefaults(data.settings, DEFAULT_SETTINGS);
          this.agg = Stats.normalize(data.agg || Stats.empty());
          this.custom = Array.isArray(data.custom) ? data.custom.filter(function (c) {
            return c && typeof c.text === 'string';
          }) : [];
          return this;
        }
      }

      this.settings = deepDefaults(null, DEFAULT_SETTINGS);
      this.agg = Stats.empty();
      this.custom = [];
      return this;
    },

    /* ------------------------------------------------------------- save */

    serialize: function () {
      return JSON.stringify({
        app: 'typing-drill',
        version: 1,
        savedAt: Date.now(),
        settings: this.settings,
        agg: this.agg,
        custom: this.custom
      });
    },

    save: function () {
      return this._rawSet(KEY, this.serialize());
    },

    /* Settings are written through immediately so a choice cannot be lost. */
    setSetting: function (key, value) {
      this.settings[key] = value;
      this.save();
      return this.settings;
    },

    /* -------------------------------------------------- custom content */

    addCustom: function (name, text) {
      var item = {
        id: 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
        name: name || ('Custom ' + (this.custom.length + 1)),
        text: String(text || ''),
        addedAt: Date.now()
      };
      this.custom.push(item);
      this.save();
      return item;
    },

    removeCustom: function (id) {
      var before = this.custom.length;
      this.custom = this.custom.filter(function (c) { return c.id !== id; });
      if (this.custom.length !== before) {
        if (this.settings.customId === id) this.settings.customId = null;
        this.save();
        return true;
      }
      return false;
    },

    getCustom: function (id) {
      for (var i = 0; i < this.custom.length; i++) if (this.custom[i].id === id) return this.custom[i];
      return null;
    },

    /* ------------------------------------------------------ import/export */

    exportData: function () {
      return JSON.stringify({
        app: 'typing-drill',
        version: 1,
        exportedAt: Date.now(),
        settings: this.settings,
        agg: this.agg,
        custom: this.custom
      }, null, 2);
    },

    /* Parse and validate foreign data without touching current state; the
       interface decides whether to merge or replace. */
    parseImport: function (text) {
      var data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        return { ok: false, error: 'not valid JSON: ' + (e && e.message ? e.message : 'parse failed') };
      }
      if (!data || typeof data !== 'object') return { ok: false, error: 'content is not an object' };
      if (data.app && data.app !== 'typing-drill') {
        return { ok: false, error: 'this does not look like a file exported by this tool (app = ' + data.app + ')' };
      }
      if (!data.agg && !data.settings && !data.custom) {
        return { ok: false, error: 'none of agg / settings / custom is present, nothing to import' };
      }
      return {
        ok: true,
        data: {
          settings: data.settings || null,
          agg: data.agg ? Stats.normalize(data.agg) : null,
          custom: Array.isArray(data.custom) ? data.custom : null
        },
        summary: {
          sessions: data.agg && Array.isArray(data.agg.sessions) ? data.agg.sessions.length : 0,
          keys: data.agg && data.agg.keys ? Object.keys(data.agg.keys).length : 0,
          custom: Array.isArray(data.custom) ? data.custom.length : 0,
          hasSettings: !!data.settings
        }
      };
    },

    /**
     * merge=true accumulates statistics and merges set libraries; false
     * replaces outright.
     * Returns { ok, skipped, newSessions, partial } — `partial` means the
     * imported data overlapped with what was already here, so per-key
     * statistics were counted twice and the interface must say so.
     */
    applyImport: function (parsed, merge) {
      if (!parsed || !parsed.ok) return { ok: false, error: 'data failed validation' };
      var d = parsed.data;
      var result = { ok: true, skipped: null, newSessions: 0, partial: false };

      if (merge && d.agg) {
        var mine = this.agg;
        var ident = function (s) { return s.ts + '|' + (s.typedCount || 0); };

        var seen = Object.create(null);
        mine.sessions.forEach(function (s) { seen[ident(s)] = 1; });

        var importedCount = d.agg.sessions.length;
        var newSessions = d.agg.sessions.filter(function (s) {
          var k = ident(s);
          if (seen[k]) return false;
          seen[k] = 1;
          return true;
        });

        /* No new sessions at all means this exact file was already imported.
           Skip the whole merge: sessions are deduplicated but per-key
           statistics are not, so skipping only the sessions would leave the
           two parts of the aggregate disagreeing. */
        if (importedCount > 0 && newSessions.length === 0) {
          result.skipped = 'duplicate';
          result.partial = false;
          return result;
        }

        mine.sessions = mine.sessions.concat(newSessions);
        mine.sessions.sort(function (a, b) { return a.ts - b.ts; });
        if (mine.sessions.length > Stats.MAX_SESSIONS) {
          mine.sessions = mine.sessions.slice(-Stats.MAX_SESSIONS);
        }
        result.newSessions = newSessions.length;
        result.partial = newSessions.length < importedCount;

        Object.keys(d.agg.keys).forEach(function (k) {
          var src = d.agg.keys[k];
          var dst = mine.keys[k];
          if (!dst) { mine.keys[k] = src; return; }
          dst.attempts += src.attempts || 0;
          dst.errors += src.errors || 0;
          if (src.lat && src.lat.length) {
            dst.lat = dst.lat.concat(src.lat);
            if (dst.lat.length > Stats.MAX_LAT) dst.lat = dst.lat.slice(-Stats.MAX_LAT);
          }
          dst.lastSeen = Math.max(dst.lastSeen || 0, src.lastSeen || 0);
          dst.firstSeen = Math.min(dst.firstSeen || Infinity, src.firstSeen || Infinity);
        });

        Object.keys(d.agg.confusions || {}).forEach(function (k) {
          mine.confusions[k] = (mine.confusions[k] || 0) + d.agg.confusions[k];
        });

        var t = mine.totals, s = d.agg.totals;
        t.sessions += s.sessions || 0;
        t.chars += s.chars || 0;
        t.strokes += s.strokes || 0;
        t.errors += s.errors || 0;
        t.ms += s.ms || 0;
        t.bestCpm = Math.max(t.bestCpm || 0, s.bestCpm || 0);
      } else if (d.agg) {
        this.agg = Stats.normalize(d.agg);
      }

      if (d.settings) this.settings = deepDefaults(d.settings, DEFAULT_SETTINGS);

      if (d.custom) {
        var existing = Object.create(null);
        this.custom.forEach(function (c) { existing[c.id] = 1; });
        d.custom.forEach(function (c) {
          if (c && typeof c.text === 'string' && !existing[c.id]) {
            existing[c.id] = 1;
            this.custom.push(c);
          }
        }, this);
      }

      this.save();
      return result;
    },

    /* ------------------------------------------------------------ clear */

    clearStats: function () {
      this.agg = Stats.empty();
      this.save();
    },

    clearAll: function () {
      this.settings = deepDefaults(null, DEFAULT_SETTINGS);
      this.agg = Stats.empty();
      this.custom = [];
      this.save();
    }
  };

  TD.Store = Store;
})(window.TD);
