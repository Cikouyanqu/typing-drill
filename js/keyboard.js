/* ==========================================================================
   keyboard.js — on-screen keyboard

   Two mutually exclusive uses, each with its own instance so their state
   cannot fight each other:
     finger guidance — highlight the target key, its whole finger region, and
                       the Shift key that should be held
     heatmap         — tint keys by per-key error rate

   Performance: the keyboard is built once and only attributes change
   afterwards, so one keystroke costs 61 attribute writes at most.

   Colour discipline: only shades of the single accent colour (target /
   same-finger / everything else) plus semantic error-success colours. No
   multi-colour finger palette — the design language forbids decorative colour.
   ========================================================================== */

window.TD = window.TD || {};
(function (TD) {
  'use strict';

  var util = TD.util;
  var Keymap = TD.Keymap;
  var el = util.el;

  function tr(key, params) {
    return TD.I18n ? TD.I18n.t(key, params) : key;
  }

  function Keyboard() {
    this.keys = [];          /* { el, def } for fast updates */
    this.byCode = Object.create(null);
    this.root = this._build();
    this.legendEl = el('div', { class: 'kb-legend' });
    this.wrap = el('div', { class: 'kb-wrap' }, [this.root, this.legendEl]);
    this._marked = [];
    this._flashTimer = null;
    this._flashNode = null;
    this.useHintLegend();
  }

  /* Width in units of 0.25u per grid column; 1u = 4 columns. */
  function spanOf(w) { return Math.round((w || 1) * 4); }

  /* Legend text for a key: an English literal for most modifiers, a dictionary
     lookup for the few that need translating. */
  function legendOf(def) {
    if (def.legendKey) return tr(def.legendKey);
    return def.name;
  }

  function buildTitle(def) {
    var sep = tr('kb.title.sep');
    var parts = [];
    if (def.name) {
      parts.push(legendOf(def));
    } else {
      var bits = [tr('kb.title.base', { base: def.base })];
      if (def.shifted) bits.push(tr('kb.title.shifted', { shifted: def.shifted }));
      parts.push(bits.join(sep));
    }
    var finger = Keymap.fingerLabel(def.finger);
    if (finger) parts.push(finger);
    return parts.join(sep);
  }

  Keyboard.prototype._build = function () {
    var self = this;
    var kb = el('div', { class: 'kb', 'data-hint': 'off', 'data-heat': 'off' });

    Keymap.ROWS.forEach(function (row, rowIndex) {
      row.forEach(function (k) {
        var def = Keymap.keyByCode(k.code);
        var children = [];

        if (def.name) {
          /* Modifier key: show the legend only. Longer legends get a smaller
             size, measured on the rendered text because translations vary. */
          var label = legendOf(def);
          children.push(el('span', {
            class: 'k-name',
            text: label,
            style: { 'font-size': label.length > 5 ? '9px' : '10px' }
          }));
        } else {
          /* Character key: shifted symbol above, base below, like a real
             keycap. */
          if (def.shifted) {
            children.push(el('span', { class: 'k-shift', text: def.shifted }));
          }
          children.push(el('span', { class: 'k-base', text: def.base === ' ' ? '' : def.base }));
        }

        var node = el('div', {
          class: 'kb-key',
          'data-code': k.code,
          'data-finger': def.finger,
          'data-row': rowIndex,
          title: buildTitle(def)
        }, children);

        node.style.gridColumn = 'span ' + spanOf(k.w);
        if (k.home) node.setAttribute('data-home', 'true');
        if (def.name === 'Space') node.setAttribute('data-space', 'true');

        kb.appendChild(node);
        self.keys.push({ el: node, def: def });
        self.byCode[k.code] = node;
      });
    });

    return kb;
  };

  /* ----------------------------------------------------------- legends */

  Keyboard.prototype._paintLegend = function (items) {
    util.clear(this.legendEl);
    items.forEach(function (it) {
      this.legendEl.appendChild(el('span', { class: 'kb-legend-item' }, [
        it.heat
          ? el('span', { class: 'kb-swatch heat-' + it.heat })
          : el('span', { class: 'kb-swatch', style: { background: it.color } }),
        el('span', { text: it.text })
      ]));
    }, this);
  };

  Keyboard.prototype.useHintLegend = function () {
    this._paintLegend([
      { color: 'var(--color-primary)', text: tr('kb.legend.target') },
      { color: 'var(--color-primary-soft)', text: tr('kb.legend.sameFinger') }
    ]);
  };

  Keyboard.prototype.useHeatLegend = function () {
    this._paintLegend([
      { heat: 1, text: tr('kb.legend.heat1') },
      { heat: 2, text: tr('kb.legend.heat2') },
      { heat: 3, text: tr('kb.legend.heat3') },
      { heat: 4, text: tr('kb.legend.heat4') }
    ]);
    this.legendEl.appendChild(el('span', { class: 'kb-legend-item mute', text: tr('kb.legend.noData') }));
  };

  /* ---------------------------------------------------- finger guidance */

  Keyboard.prototype.clearMarks = function () {
    for (var i = 0; i < this._marked.length; i++) {
      this._marked[i].removeAttribute('data-target');
      this._marked[i].removeAttribute('data-same-finger');
      this._marked[i].removeAttribute('data-shift-target');
    }
    this._marked.length = 0;
  };

  /**
   * Highlight the key for a character; null clears. Also lights up the Shift
   * key that should be held, which is the single most valuable cue for
   * programming symbols.
   */
  Keyboard.prototype.hint = function (ch) {
    this.clearMarks();
    this.root.setAttribute('data-hint', ch ? 'on' : 'off');
    if (!ch) return;

    var info = Keymap.lookup(ch);
    if (!info) return;

    /* The whole region owned by this finger. */
    for (var i = 0; i < this.keys.length; i++) {
      var k = this.keys[i];
      if (k.def.finger === info.finger) {
        k.el.setAttribute('data-same-finger', 'true');
        this._marked.push(k.el);
      }
    }

    var target = this.byCode[info.code];
    if (target) {
      target.setAttribute('data-target', 'true');
      this._marked.push(target);
    }

    /* Light up the correct Shift side. */
    if (info.needsShift && info.shiftSide) {
      var shiftCode = info.shiftSide === 'L' ? 'ShiftLeft' : 'ShiftRight';
      var shiftEl = this.byCode[shiftCode];
      if (shiftEl) {
        shiftEl.setAttribute('data-shift-target', 'true');
        this._marked.push(shiftEl);
      }
    }
  };

  /* A brief confirmation flash on a correct press.
     Keeping a single timer would be wrong: during fast typing a later flash
     clears the earlier timer, so the earlier key's data-flash stays forever.
     Only one key may flash at a time, and a new flash clears the previous one
     immediately. */
  Keyboard.prototype.clearFlash = function () {
    if (this._flashTimer) { clearTimeout(this._flashTimer); this._flashTimer = null; }
    if (this._flashNode) {
      this._flashNode.removeAttribute('data-flash');
      this._flashNode = null;
    }
  };

  Keyboard.prototype.flash = function (code) {
    var node = this.byCode[code];
    if (!node) return;
    this.clearFlash();
    node.setAttribute('data-flash', 'true');
    this._flashNode = node;
    var self = this;
    this._flashTimer = setTimeout(function () { self.clearFlash(); }, 110);
  };

  /* Finger guidance as text, for the status row. */
  Keyboard.prototype.cue = function (ch) {
    var info = Keymap.lookup(ch);
    if (!info) return null;
    var fingerLabel = Keymap.fingerLabel(info.finger) || '';
    var shiftLabel = Keymap.fingerLabel(info.shiftFinger) || '';
    return {
      char: ch,
      charName: Keymap.charName(ch),
      finger: info.finger,
      fingerLabel: fingerLabel,
      needsShift: !!info.needsShift,
      shiftSide: info.shiftSide,
      shiftFingerLabel: shiftLabel || null,
      text: info.needsShift
        ? tr('kb.cue.shift', { finger: fingerLabel, shiftFinger: shiftLabel })
        : tr('kb.cue.plain', { finger: fingerLabel })
    };
  };

  /* --------------------------------------------------------- heatmap */

  Keyboard.prototype.heat = function (levelByCode) {
    for (var i = 0; i < this.keys.length; i++) {
      var k = this.keys[i];
      var lvl = levelByCode ? levelByCode[k.def.code] : undefined;
      for (var n = 1; n <= 4; n++) k.el.classList.remove('heat-' + n);
      if (levelByCode && lvl && lvl > 0) k.el.classList.add('heat-' + lvl);
    }
    this.root.setAttribute('data-heat', levelByCode ? 'on' : 'off');
    this.root.setAttribute('data-hint', 'off');
  };

  /* Re-render legends and key tooltips after a language switch. The keys
     themselves keep their structure; only text changes. */
  Keyboard.prototype.relabel = function (mode) {
    for (var i = 0; i < this.keys.length; i++) {
      var k = this.keys[i];
      var def = k.def;
      var titleNode = k.el.querySelector('.k-name');
      k.el.setAttribute('title', buildTitle(def));
      if (titleNode) {
        var label = legendOf(def);
        titleNode.textContent = label;
        titleNode.style.fontSize = label.length > 5 ? '9px' : '10px';
      }
    }
    if (mode === 'heat') this.useHeatLegend();
    else this.useHintLegend();
  };

  TD.Keyboard = Keyboard;
  TD.Keyboard.create = function () { return new Keyboard(); };
})(window.TD);
