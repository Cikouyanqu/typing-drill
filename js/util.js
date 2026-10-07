/* ==========================================================================
   util.js — small dependency-free helpers

   The random number generator is seedable (mulberry32): the same seed produces
   the same drill, which is what lets the test suite reproduce a case exactly
   and what "repeat this set" relies on.
   ========================================================================== */

window.TD = window.TD || {};
(function (TD) {
  'use strict';

  /* ------------------------------------------------- seedable randomness */

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* String → 32-bit seed. Stable for a given string. */
  function hashString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function newSeed() {
    return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  }

  /* ---------------------------------------------------------------- arrays */

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function pick(arr, rng) {
    return arr[Math.floor(rng() * arr.length)];
  }

  /* Draw one index by weight. Weights must be non-negative with at least one
     positive value. */
  function weightedIndex(weights, rng) {
    var total = 0, i;
    for (i = 0; i < weights.length; i++) total += Math.max(0, weights[i]);
    if (total <= 0) return Math.floor(rng() * weights.length);
    var r = rng() * total;
    for (i = 0; i < weights.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r <= 0) return i;
    }
    return weights.length - 1;
  }

  /* --------------------------------------------------------------- numbers */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function sum(arr) {
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return s;
  }

  function mean(arr) { return arr.length ? sum(arr) / arr.length : 0; }

  /* Response times use the median rather than the mean: a single distraction
     would otherwise drag the average far off. */
  function median(arr) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var mid = a.length >> 1;
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }

  function fmt(n, digits) {
    if (!isFinite(n)) return '—';
    var d = digits === undefined ? 0 : digits;
    return n.toFixed(d);
  }

  function pct(n, digits) {
    if (!isFinite(n)) return '—';
    return (n * 100).toFixed(digits === undefined ? 1 : digits) + '%';
  }

  /* milliseconds → m:ss */
  function formatDuration(ms) {
    var total = Math.max(0, Math.round(ms / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function formatDate(ts) {
    var d = new Date(ts);
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ----------------------------------------------------------------- text */

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* Build elements with the real DOM API rather than assembling HTML strings,
     which removes the escaping risks that string concatenation brings. */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') {
          Object.keys(v).forEach(function (p) { node.style.setProperty(p, v[p]); });
        } else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v === true) {
          node.setAttribute(k, '');
        } else {
          node.setAttribute(k, String(v));
        }
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  /* -------------------------------------------------- files and export */

  function downloadText(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    /* Give the browser time to queue the download before revoking. */
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function readTextFile(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result)); };
      fr.onerror = function () { reject(new Error('could not read the file')); };
      fr.readAsText(file, 'utf-8');
    });
  }

  /* --------------------------------------------------------------- events */

  function debounce(fn, wait) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, wait);
    };
  }

  /* ---------------------------------------------------------- light audio */

  var audioCtx = null;

  function beep(kind) {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      var t0 = audioCtx.currentTime;
      osc.type = 'square';
      /* Errors are two short descending blips, completion one rising tone;
         neither should be harsh. */
      if (kind === 'error') {
        osc.frequency.setValueAtTime(220, t0);
        osc.frequency.exponentialRampToValueAtTime(150, t0 + 0.08);
        gain.gain.setValueAtTime(0.05, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(t0); osc.stop(t0 + 0.1);
      } else if (kind === 'done') {
        osc.frequency.setValueAtTime(523, t0);
        osc.frequency.setValueAtTime(784, t0 + 0.09);
        gain.gain.setValueAtTime(0.05, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(t0); osc.stop(t0 + 0.24);
      }
    } catch (e) { /* audio is a nicety; a failure here must not affect typing */ }
  }

  /* Short mechanical-key click for the keyboard tester. Same synthesis
     approach as beep(): no audio files, nothing to fetch. */
  function click(volume) {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      var t0 = audioCtx.currentTime;
      osc.type = 'square';
      osc.frequency.setValueAtTime(1100, t0);
      osc.frequency.exponentialRampToValueAtTime(520, t0 + 0.018);
      gain.gain.setValueAtTime(volume === undefined ? 0.03 : volume, t0);
      gain.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.028);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(t0); osc.stop(t0 + 0.03);
    } catch (e) { /* audio is a nicety; a failure here must not affect testing */ }
  }

  TD.util = {
    mulberry32: mulberry32,
    hashString: hashString,
    newSeed: newSeed,
    shuffle: shuffle,
    pick: pick,
    weightedIndex: weightedIndex,
    clamp: clamp,
    sum: sum,
    mean: mean,
    median: median,
    fmt: fmt,
    pct: pct,
    formatDuration: formatDuration,
    formatDate: formatDate,
    escapeHtml: escapeHtml,
    el: el,
    clear: clear,
    downloadText: downloadText,
    readTextFile: readTextFile,
    debounce: debounce,
    beep: beep,
    click: click
  };
})(window.TD);
