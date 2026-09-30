/* ==========================================================================
   i18n.js — translation runtime

   Architecture constraint that shapes this file: dictionaries are inlined as
   classic scripts, never JSON fetched at runtime. Under file:// Chromium
   refuses to fetch local files (CORS), which is the same reason this project
   uses classic scripts instead of ES modules. A JSON dictionary would break
   double-click usage and leave a blank page.

   Hard rule for every other module: resolve strings at CALL time, never at
   load time. A module that bakes a label into a constant during load will not
   follow a language switch until the page is reloaded.

   Key naming: flat dot-notation namespaces, e.g. nav.practice,
   settings.theme.auto, practice.btn.newSet. The prefix must identify the
   owning area so a translator can find the context.
   ========================================================================== */

window.TD = window.TD || {};
(function (TD) {
  'use strict';

  /* Language used when the active language has no entry for a key. English is
     the repository's primary language, so it plays the fallback role. */
  var FALLBACK_LANG = 'en';

  /* Concrete languages, in the order they should appear in pickers. */
  var LANG_IDS = ['zh-CN', 'en'];

  var dicts = Object.create(null);   /* langId -> { key: value } */
  var listeners = [];
  var setting = 'auto';              /* 'auto' | 'zh-CN' | 'en' */
  var current = FALLBACK_LANG;       /* resolved concrete language */
  var missing = Object.create(null); /* key -> true, for diagnostics */

  /* ------------------------------------------------------- registration */

  /* Called by each locale file at load time. Merging is allowed so a project
     can split a large dictionary across several files. */
  function addDict(lang, dict) {
    if (!lang || !dict) return;
    if (!dicts[lang]) dicts[lang] = Object.create(null);
    Object.keys(dict).forEach(function (k) {
      dicts[lang][k] = dict[k];
    });
  }

  function hasDict(lang) { return !!dicts[lang]; }

  function keysOf(lang) {
    return dicts[lang] ? Object.keys(dicts[lang]).sort() : [];
  }

  /* --------------------------------------------------------- resolution */

  function detect() {
    var nav = (typeof navigator !== 'undefined' && navigator) || null;
    var raw = (nav && (nav.languages && nav.languages[0] || nav.language)) || '';
    return /^zh/i.test(String(raw)) ? 'zh-CN' : FALLBACK_LANG;
  }

  /* Turn a stored setting value into a concrete language id. */
  function resolve(value) {
    if (value === 'auto' || value === undefined || value === null || value === '') return detect();
    if (dicts[value]) return value;
    /* Unknown id (e.g. a removed language in an old save): fall back rather
       than rendering raw keys. */
    return detect();
  }

  function lang() { return current; }
  function settingValue() { return setting; }

  /* --------------------------------------------------------- lookup */

  function lookup(key) {
    var d = dicts[current];
    if (d && d[key] !== undefined) return d[key];
    var f = dicts[FALLBACK_LANG];
    if (f && f[key] !== undefined) return f[key];
    return undefined;
  }

  function interpolate(template, params) {
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, function (whole, name) {
      var v = params[name];
      return v === undefined || v === null ? whole : String(v);
    });
  }

  /**
   * Translate a key.
   *   t('nav.practice')
   *   t('stats.keyHint.shift', { base: '=' })
   *   t('stats.sessions', { n: 3 })   // picks one/other for plural languages
   *
   * A dictionary value is either a string or { one, other }. Languages without
   * grammatical number (Chinese) simply provide { other } or a plain string.
   */
  function t(key, params) {
    var entry = lookup(key);
    if (entry === undefined) {
      missing[key] = true;
      /* Returning the key keeps a missing translation visible and debuggable
         instead of rendering "undefined" or throwing. */
      return key;
    }
    if (entry && typeof entry === 'object') {
      var n = params ? params.n : undefined;
      if (n === 1 && entry.one !== undefined) entry = entry.one;
      else entry = entry.other !== undefined ? entry.other : entry.one;
    }
    if (typeof entry !== 'string') return key;
    return interpolate(entry, params);
  }

  /* Same as t() but returns null instead of the key when missing. Useful where
     a fallback rendering is better than showing a raw key. */
  function tryT(key, params) {
    var entry = lookup(key);
    return entry === undefined ? null : t(key, params);
  }

  /* Keys requested but absent from both dictionaries. Asserted empty by the
     test suite so typos cannot reach a release. */
  function missingKeys() { return Object.keys(missing).sort(); }
  function resetMissing() { missing = Object.create(null); }

  /* --------------------------------------------------------- switching */

  function applyDocument() {
    if (typeof document === 'undefined' || !document.documentElement) return;
    document.documentElement.setAttribute('lang', current);
    var title = tryT('app.title');
    if (title) document.title = title;
    var meta = document.querySelector('meta[name="description"]');
    if (meta) {
      var desc = tryT('app.description');
      if (desc) meta.setAttribute('content', desc);
    }
  }

  /**
   * Set the language. Accepts 'auto' | 'zh-CN' | 'en'.
   * Notifies listeners on every call — the resolved language may be unchanged
   * while the chosen setting changed, and the UI still needs to redraw the
   * selected state.
   */
  function set(value) {
    setting = value || 'auto';
    var next = resolve(setting);
    var changed = next !== current;
    current = next;
    applyDocument();
    if (persist) persist(setting);
    for (var i = 0; i < listeners.length; i++) listeners[i](current, changed);
    return current;
  }

  function onChange(cb) {
    listeners.push(cb);
    return function () {
      var i = listeners.indexOf(cb);
      if (i !== -1) listeners.splice(i, 1);
    };
  }

  var persist = null;

  /**
   * Wire the runtime up. Called once from boot with the stored setting and a
   * persistence callback, so this module stays free of any storage dependency
   * and remains testable in isolation.
   */
  function init(opts) {
    opts = opts || {};
    persist = opts.persist || null;
    setting = opts.setting || 'auto';
    current = resolve(setting);
    applyDocument();
    return current;
  }

  /* ------------------------------------------------- translate the DOM */

  var DOM_ATTRS = [
    ['data-i18n', 'text'],
    ['data-i18n-title', 'title'],
    ['data-i18n-placeholder', 'placeholder'],
    ['data-i18n-aria', 'aria-label']
  ];

  /**
   * Translate a static HTML subtree in place. Only needed for markup that is
   * not rendered by JS; anything the views build should call t() directly.
   */
  function applyDom(root) {
    if (typeof document === 'undefined') return 0;
    var scope = root || document;
    var count = 0;
    DOM_ATTRS.forEach(function (pair) {
      var attr = pair[0];
      var kind = pair[1];
      var nodes = scope.querySelectorAll('[' + attr + ']');
      for (var i = 0; i < nodes.length; i++) {
        var key = nodes[i].getAttribute(attr);
        var text = t(key);
        if (kind === 'text') nodes[i].textContent = text;
        else nodes[i].setAttribute(kind, text);
        count++;
      }
    });
    return count;
  }

  /* ------------------------------------------------- plural + list helpers */

  /* Join a list of already-translated labels with a locale-appropriate
     separator. Chinese uses the full-width comma, English a comma + space. */
  function joinList(items) {
    if (!items || !items.length) return '';
    var sep = current === 'zh-CN' ? '、' : ', ';
    return items.join(sep);
  }

  /* "1 attempt" / "3 attempts" / the Chinese equivalent */
  function count(key, n, extra) {
    var params = { n: n };
    if (extra) Object.keys(extra).forEach(function (k) { params[k] = extra[k]; });
    return t(key, params);
  }

  TD.I18n = {
    FALLBACK_LANG: FALLBACK_LANG,
    LANG_IDS: LANG_IDS,
    addDict: addDict,
    hasDict: hasDict,
    keysOf: keysOf,
    detect: detect,
    resolve: resolve,
    lang: lang,
    settingValue: settingValue,
    t: t,
    tryT: tryT,
    missingKeys: missingKeys,
    resetMissing: resetMissing,
    set: set,
    onChange: onChange,
    init: init,
    applyDom: applyDom,
    joinList: joinList,
    count: count
  };
})(window.TD);
