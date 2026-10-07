/* ==========================================================================
   views.js — the five views: practice / weak keys / library / stats / settings

   Design notes:
   · All typing state lives in Engine; the DOM is a projection of it. Switching
     to another view and back therefore loses nothing — the skeleton is rebuilt
     and repainted from engine state.
   · The practice view does not use engine event subscriptions. Its keydown
     handler calls afterKey() directly, so rebuilding the DOM repeatedly cannot
     accumulate duplicate subscribers.
   · Every user-visible string goes through tr(). Nothing in this file may hold
     a translated string in a load-time constant — see docs/I18N.md.
   ========================================================================== */

window.TD = window.TD || {};
(function (TD) {
  'use strict';

  var util = TD.util;
  var UI = TD.UI;
  var I18n = TD.I18n;
  var el = util.el;
  var Keymap = TD.Keymap;
  var Stats = TD.Stats;

  var app = null;   /* injected by init(): { store, nav, setLang, container } */

  function tr(key, params) {
    return I18n ? I18n.t(key, params) : key;
  }

  function joinList(items) {
    return I18n ? I18n.joinList(items) : items.join(', ');
  }

  /* ============================================================= practice */

  var Practice = {
    engine: null,
    drill: null,
    kb: null,
    refs: null,
    timer: null,
    spans: null,
    lineEls: null,
    lastPaintedPos: 0,

    init: function () {
      if (!this.engine) {
        this.engine = new TD.Engine();
        this.engine.reset('', {});
      }
      if (!this.kb) this.kb = TD.Keyboard.create();
    },

    /* Build one set of practice text from the current settings. */
    build: function (seedOverride) {
      var s = app.store.settings;
      var seed = seedOverride === undefined ? util.newSeed() : seedOverride;
      var drill;

      if (s.mode === 'code') {
        drill = TD.Snippets.generate({
          packIds: s.packIds, lines: s.lines, seed: seed, density: s.density
        });
      } else if (s.mode === 'adaptive') {
        drill = TD.Adaptive.buildDrill(app.store.agg, {
          lines: s.lines + 1, seed: seed, packIds: s.packIds
        });
        drill.mode = 'adaptive';
      } else if (s.mode === 'custom') {
        var item = s.customId ? app.store.getCustom(s.customId) : app.store.custom[0];
        if (!item) {
          return { mode: 'custom', seed: seed, lines: [], text: '', title: tr('drill.customMissing'), empty: true };
        }
        var lines = item.text.split('\n').filter(function (l) { return l.trim().length; });
        if (!lines.length) {
          return { mode: 'custom', seed: seed, lines: [], text: '', title: tr('drill.customEmpty'), empty: true };
        }
        /* Take a window of lines so every round shows something, even when the
           saved set is longer than the configured line count. */
        var want = Math.min(s.lines, lines.length);
        var start = Math.floor(util.mulberry32(seed)() * Math.max(1, lines.length - want + 1));
        drill = {
          mode: 'custom',
          seed: seed,
          lines: lines.slice(start, start + want),
          title: tr('drill.custom', { name: item.name })
        };
        drill.text = drill.lines.join('\n');
      } else {
        drill = TD.SymbolDrills.generate({
          groupIds: s.groupIds, lines: s.lines, tokensPerLine: s.tokensPerLine, seed: seed
        });
      }
      return drill;
    },

    startDrill: function (drill) {
      this.drill = drill;
      this.engine.reset(drill.text || '', {
        symbolOnly: !!app.store.settings.symbolOnly,
        allowBackspace: !!app.store.settings.allowBackspace,
        meta: {
          mode: drill.mode,
          title: drill.title,
          seed: drill.seed,
          groupIds: drill.groupIds || null,
          packIds: drill.packIds || null,
          coldStart: !!drill.coldStart
        }
      });
      this.engine.meta.coldStart = !!drill.coldStart;
      this.stopTimer();
      if (this.refs) {
        this.renderText();
        util.clear(this.refs.resultSlot);
      }
      this.refresh();
      this.focusInput();
    },

    stopTimer: function () {
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
    },

    /* The live clock only needs to tick while a drill is running. */
    startTimer: function () {
      var self = this;
      if (this.timer) return;
      this.timer = setInterval(function () {
        if (self.refs) self.paintHud();
      }, 250);
    },

    /* ------------------------------------------------------------ skeleton */

    mount: function (container) {
      var self = this;
      this.init();
      this.stopTimer();

      /* The container must be cleared before mounting. Changing a filter, the
         mode or the line count all re-mount within this view; without the clear
         a second complete interface would stack on top of the first. */
      util.clear(container);

      /* Only one spacing system: .practice defines its own flex gap, so no
         .stack class here — a flex gap and a child margin add up rather than
         collapsing. */
      var root = el('div', { class: 'practice' });
      var refs = {};

      /* --- toolbar --- */
      var modeItems = ['symbols', 'code', 'adaptive', 'custom'].map(function (m) {
        return { value: m, label: tr('practice.mode.' + m) };
      });
      var bar = el('div', { class: 'card' });
      var expanded = !!app.store.settings.optionsExpanded;

      bar.appendChild(el('div', { class: 'row row-wrap' }, [
        UI.seg(modeItems, app.store.settings.mode, function (v) {
          app.store.setSetting('mode', v);
          self.applyOptions(container);
        }),
        el('span', { class: 'spacer' }),
        el('label', { class: 'check', title: tr('practice.symbolOnlyTitle') }, [
          (function () {
            var i = el('input', { type: 'checkbox' });
            i.checked = !!app.store.settings.symbolOnly;
            i.addEventListener('change', function () {
              app.store.setSetting('symbolOnly', i.checked);
              self.startDrill(self.drill || self.build());
            });
            return i;
          })(),
          el('span', { class: 'check-box' }),
          el('span', { class: 'text', text: tr('practice.symbolOnly') })
        ]),
        /* Filters start collapsed: thirteen group chips make the toolbar two
           rows tall and push the on-screen keyboard below the fold — and the
           keyboard is what you look at during the main loop. */
        el('button', {
          class: 'btn btn-secondary btn-sm',
          type: 'button',
          text: tr(expanded ? 'practice.btn.filterHide' : 'practice.btn.filter'),
          title: tr('practice.btn.filterTitle'),
          onclick: function () {
            app.store.setSetting('optionsExpanded', !expanded);
            self.mount(container);
          }
        }),
        el('button', {
          class: 'btn btn-secondary', type: 'button', text: tr('practice.btn.repeat'),
          title: tr('practice.btn.repeatTitle'),
          onclick: function () {
            var seed = self.drill && self.drill.seed;
            self.startDrill(self.build(seed));
          }
        }),
        el('button', {
          class: 'btn btn-primary', type: 'button', text: tr('practice.btn.newSet'),
          onclick: function () { self.startDrill(self.build()); }
        })
      ]));

      /* Options row: everything when expanded, a one-line summary plus the most
         frequently changed control when collapsed. */
      refs.optRow = el('div', { class: 'opt-row' });
      if (expanded) {
        this.renderOptions(refs.optRow, container);
      } else {
        refs.optRow.appendChild(el('span', { class: 't-body-sm dim', text: this.optionsSummary() }));
        refs.optRow.appendChild(el('span', { class: 'spacer' }));
        refs.optRow.appendChild(el('span', { class: 't-caption mute nowrap', text: tr('practice.lines') }));
        refs.optRow.appendChild(UI.select(
          [1, 2, 3, 4, 5, 6, 8, 10].map(function (n) { return { value: n, label: String(n) }; }),
          app.store.settings.lines,
          function (v) {
            app.store.setSetting('lines', parseInt(v, 10));
            self.applyOptions(container);
          }
        ));
      }
      bar.appendChild(refs.optRow);
      root.appendChild(bar);

      /* --- HUD --- */
      refs.hud = {};
      var hudCells = ['cpm', 'wpm', 'acc', 'errors', 'progress', 'time'];
      var hud = el('div', { class: 'hud' });
      hudCells.forEach(function (id) {
        var value = el('span', { class: 'hud-value', text: tr('common.dash') });
        refs.hud[id] = value;
        hud.appendChild(el('div', { class: 'hud-cell' }, [
          el('span', { class: 'hud-label', text: tr('practice.hud.' + id) }),
          value
        ]));
      });
      root.appendChild(hud);

      /* --- practice stage --- */
      refs.stage = el('div', { class: 'stage', 'data-focused': 'false' });
      refs.scroll = el('div', { class: 'stage-scroll' });
      refs.text = el('div', { class: 'typing-text' });
      refs.scroll.appendChild(refs.text);
      refs.stage.appendChild(refs.scroll);

      /* Pause overlay: a real element so its text can be translated. */
      refs.stage.appendChild(el('div', { class: 'stage-paused', text: tr('practice.paused') }));

      /* Capture layer: receives keystrokes and IME composition events. */
      refs.input = el('input', {
        class: 'capture',
        type: 'text',
        autocomplete: 'off',
        autocorrect: 'off',
        autocapitalize: 'off',
        spellcheck: 'false',
        'aria-label': 'Typing input area'
      });
      refs.stage.appendChild(refs.input);
      root.appendChild(refs.stage);

      /* --- status row: target cue and live feedback on one line --- */
      refs.feedback = el('div', { class: 'feedback' });
      refs.cueKey = el('span', { class: 'fc-key', text: tr('common.dash') });
      refs.cueText = el('span', { class: 't-body-sm dim nowrap', text: tr('practice.clickToStart') });
      root.appendChild(el('div', { class: 'status-row' }, [
        el('span', { class: 't-caption mute nowrap', text: tr('practice.target') }),
        refs.cueKey,
        refs.cueText,
        el('span', { class: 'status-sep' }),
        refs.feedback,
        el('span', { class: 'spacer' }),
        el('span', { class: 't-body-sm mute nowrap', text: tr('practice.esc') })
      ]));

      refs.resultSlot = el('div', { class: 'result-slot' });
      root.appendChild(refs.resultSlot);

      if (app.store.settings.showKeyboard) {
        this.kb.relabel('hint');
        root.appendChild(this.kb.wrap);
      }

      container.appendChild(root);
      this.refs = refs;

      /* keydown is the single input entry point */
      refs.input.addEventListener('keydown', function (e) { self.onKeyDown(e, container); });
      refs.input.addEventListener('input', function () { refs.input.value = ''; });
      refs.input.addEventListener('blur', function () {
        refs.stage.setAttribute('data-focused', 'false');
      });
      refs.stage.addEventListener('mousedown', function (e) {
        if (e.target !== refs.input) { e.preventDefault(); refs.input.focus(); }
        refs.stage.setAttribute('data-focused', 'true');
      });

      this.renderText();
      this.refresh();

      if (!this.drill || !this.drill.text) this.startDrill(this.build());
      else this.focusInput();
    },

    /* Re-mount after an option change that affects CONTENT, and immediately
       generate a drill of the new shape. Without the second step the toolbar
       and summary update but the text on screen stays whatever was loaded
       last, which reads as the switch having done nothing — the mode buttons
       looked broken because of exactly this.
       Configuration-only changes (collapsing the filters, for instance) must
       keep using mount() so the current drill is not thrown away. */
    applyOptions: function (container) {
      this.mount(container);
      this.startDrill(this.build());
    },

    /* One-line summary shown while the filters are collapsed, so the current
       scope is visible without expanding. */
    optionsSummary: function () {
      var s = app.store.settings;
      if (s.mode === 'symbols') {
        var all = TD.SymbolDrills.GROUPS.length;
        var picked = (s.groupIds && s.groupIds.length) ? s.groupIds : null;
        var desc = picked
          ? tr('practice.summary.symbolsSome', {
              n: picked.length,
              names: joinList(picked.map(function (id) {
                var g = TD.SymbolDrills.byId(id);
                return g ? g.label : id;
              }))
            })
          : tr('practice.summary.symbolsAll', { n: all });
        return tr('practice.summary.symbols', {
          groups: desc, tokens: s.tokensPerLine, lines: s.lines
        });
      }
      if (s.mode === 'code') {
        var allP = TD.Snippets.PACKS.length;
        var pickedP = (s.packIds && s.packIds.length) ? s.packIds : null;
        var descP = pickedP
          ? tr('practice.summary.codeSome', {
              n: pickedP.length,
              names: joinList(pickedP.map(function (id) {
                var p = TD.Snippets.byId(id);
                return p ? p.label : id;
              }))
            })
          : tr('practice.summary.codeAll', { n: allP });
        return tr('practice.summary.code', {
          langs: descP,
          density: s.density === 'high' ? tr('practice.summary.codeDensity') : '',
          lines: s.lines
        });
      }
      if (s.mode === 'adaptive') {
        var focus = TD.Adaptive.rankWeakKeys(app.store.agg, { minAttempts: 1, limit: 6 });
        return focus.length
          ? tr('practice.summary.adaptiveWeak', {
              list: joinList(focus.map(function (f) { return f.label; })),
              lines: s.lines + 1
            })
          : tr('practice.summary.adaptiveNoData');
      }
      var item = s.customId ? app.store.getCustom(s.customId) : app.store.custom[0];
      return item
        ? tr('practice.summary.custom', { name: item.name, lines: s.lines })
        : tr('practice.summary.customNone');
    },

    renderOptions: function (row, container) {
      var self = this;
      var s = app.store.settings;
      util.clear(row);

      if (s.mode === 'symbols') {
        var allIds = TD.SymbolDrills.GROUPS.map(function (g) { return g.id; });
        var picked = s.groupIds && s.groupIds.length ? s.groupIds : allIds;
        row.appendChild(el('span', { class: 't-caption mute nowrap', text: tr('practice.groups') }));
        row.appendChild(UI.chips(
          TD.SymbolDrills.GROUPS.map(function (g) {
            return {
              value: g.id, label: g.label,
              title: g.desc + '\n' + tr('practice.charsInGroup', { chars: g.chars.join(' ') })
            };
          }),
          function (id) { return picked.indexOf(id) !== -1; },
          function (id) {
            var next = picked.slice();
            var at = next.indexOf(id);
            if (at === -1) next.push(id); else next.splice(at, 1);
            if (!next.length) next = allIds.slice();
            app.store.setSetting('groupIds', next.length === allIds.length ? null : next);
            self.applyOptions(container);
          }
        ));
      } else if (s.mode === 'code') {
        var allPacks = TD.Snippets.PACKS.map(function (p) { return p.id; });
        var pickedP = s.packIds && s.packIds.length ? s.packIds : allPacks;
        row.appendChild(el('span', { class: 't-caption mute nowrap', text: tr('practice.langs') }));
        row.appendChild(UI.chips(
          TD.Snippets.PACKS.map(function (p) {
            return {
              value: p.id, label: p.label, mono: true,
              title: p.desc + '\n' + tr('practice.packStats', {
                n: p.lines.length, ratio: (p.avgRatio * 100).toFixed(0)
              })
            };
          }),
          function (id) { return pickedP.indexOf(id) !== -1; },
          function (id) {
            var next = pickedP.slice();
            var at = next.indexOf(id);
            if (at === -1) next.push(id); else next.splice(at, 1);
            if (!next.length) next = allPacks.slice();
            app.store.setSetting('packIds', next.length === allPacks.length ? null : next);
            self.applyOptions(container);
          }
        ));
        row.appendChild(UI.chips(
          [{ value: 'high', label: tr('practice.density.high') }],
          function (v) { return s.density === v; },
          function (v) {
            app.store.setSetting('density', s.density === 'high' ? 'any' : 'high');
            self.applyOptions(container);
          }
        ));
      } else if (s.mode === 'adaptive') {
        var focus = TD.Adaptive.rankWeakKeys(app.store.agg, { minAttempts: 1, limit: 6 });
        if (focus.length) {
          row.appendChild(el('span', { class: 't-caption mute nowrap', text: tr('practice.weakNow') }));
          row.appendChild(el('div', { class: 'chips' }, focus.map(function (f) {
            return el('span', {
              class: 'badge badge-error mono',
              title: f.fingerLabel + '　' + f.keyHint,
              text: f.label
            });
          })));
        } else {
          row.appendChild(el('div', { class: 't-body-sm dim', text: tr('practice.noKeyData') }));
        }
      } else {
        row.appendChild(el('span', { class: 't-caption mute nowrap', text: tr('practice.library') }));
        if (!app.store.custom.length) {
          row.appendChild(el('span', { class: 't-body-sm dim', text: tr('practice.noCustom') }));
        } else {
          row.appendChild(UI.select(
            app.store.custom.map(function (c) {
              return { value: c.id, label: tr('practice.customLines', { name: c.name, n: c.text.split('\n').length }) };
            }),
            s.customId || app.store.custom[0].id,
            function (v) {
              app.store.setSetting('customId', v);
              self.applyOptions(container);
            }
          ));
        }
      }

      row.appendChild(el('span', { class: 'spacer' }));
      row.appendChild(el('span', { class: 't-caption mute nowrap', text: tr('practice.lines') }));
      row.appendChild(UI.select(
        [1, 2, 3, 4, 5, 6, 8, 10].map(function (n) { return { value: n, label: String(n) }; }),
        app.store.settings.lines,
        function (v) {
          app.store.setSetting('lines', parseInt(v, 10));
          self.applyOptions(container);
        }
      ));
      if (s.mode === 'symbols') {
        row.appendChild(el('span', { class: 't-caption mute nowrap', text: tr('practice.tokensPerLine') }));
        row.appendChild(UI.select(
          [6, 8, 10, 12, 14, 16, 20].map(function (n) { return { value: n, label: String(n) }; }),
          app.store.settings.tokensPerLine,
          function (v) {
            app.store.setSetting('tokensPerLine', parseInt(v, 10));
            self.applyOptions(container);
          }
        ));
      }
    },

    /* ------------------------------------------------------ text rendering */

    renderText: function () {
      var refs = this.refs;
      var eng = this.engine;
      util.clear(refs.text);

      this.spans = new Array(eng.items.length);
      this.lineEls = [];

      /* An empty drill — the custom library has nothing in it — would leave a
         blank stage that looks like a rendering failure. Say what to do. */
      if (!eng.items.length) {
        var isEmptyDrill = !!(this.drill && this.drill.empty);
        refs.text.appendChild(el('div', { class: 'empty' }, [
          el('div', { class: 't-title-sm', text: isEmptyDrill && this.drill.title ? this.drill.title : tr('practice.allDone') }),
          el('div', { class: 't-body-sm', text: isEmptyDrill ? tr('drill.customHint') : '' })
        ]));
        return;
      }

      var idx = 0;
      eng.lines.forEach(function (line, li) {
        var body = el('div', { class: 'tline-body' });
        for (var ci = 0; ci < line.length; ci++) {
          var span = el('span', { text: line[ci] });
          body.appendChild(span);
          this.spans[idx] = span;
          idx++;
        }
        var row = el('div', { class: 'tline' }, [
          el('div', { class: 'tline-no', text: String(li + 1) }),
          body
        ]);
        this.lineEls.push(row);
        refs.text.appendChild(row);
      }, this);

      this.lastPaintedPos = -1;
      this.paintAll();
    },

    /* Character states: untyped is the most readable, typed-correct fades back,
       the caret carries the accent, and an error turns the caret red. */
    spanClass: function (item, isCurrent) {
      var cls = [];
      if (!item.isFocus) cls.push('t-skip');
      else if (item.done) cls.push('t-done');
      else if (isCurrent) cls.push('t-cur');
      else cls.push('t-untyped');

      if (item.everWrong && (item.done || isCurrent)) cls.push('t-bad');
      else if (item.everWrong) cls.push('t-err');

      if (item.ch === ' ') cls.push('t-sp');
      else if (item.ch === '\t') cls.push('t-tab');
      return cls.join(' ');
    },

    paintAll: function () {
      var eng = this.engine;
      for (var i = 0; i < eng.items.length; i++) {
        if (!this.spans[i]) continue;
        this.spans[i].className = this.spanClass(eng.items[i], i === eng.pos);
      }
      this.lastPaintedPos = eng.pos;
    },

    /* Repaint only around the change, keeping the per-keystroke cost constant
       regardless of drill length. */
    paintAround: function (prevPos, pos) {
      var eng = this.engine;
      var from = Math.max(0, Math.min(prevPos, pos) - 1);
      var to = Math.min(eng.items.length - 1, Math.max(prevPos, pos) + 1);
      for (var i = from; i <= to; i++) {
        if (!this.spans[i]) continue;
        this.spans[i].className = this.spanClass(eng.items[i], i === eng.pos);
      }
      this.lastPaintedPos = pos;
    },

    scrollCaretIntoView: function () {
      var refs = this.refs;
      var li = this.engine.currentLineIndex();
      var row = this.lineEls[li];
      if (!row || !refs.scroll) return;
      var scroller = refs.scroll;
      var top = row.offsetTop - scroller.scrollTop;
      var bottom = top + row.offsetHeight;
      if (top < 8) scroller.scrollTop = row.offsetTop - 8;
      else if (bottom > scroller.clientHeight - 8) {
        scroller.scrollTop = row.offsetTop + row.offsetHeight - scroller.clientHeight + 8;
      }
    },

    /* --------------------------------------------------------------- HUD */

    paintHud: function () {
      var h = this.refs.hud;
      var s = this.engine.snapshot();
      var started = s.started;

      h.cpm.textContent = started ? util.fmt(s.cpm, 0) : tr('common.dash');
      h.wpm.textContent = started ? util.fmt(s.wpm, 0) : tr('common.dash');
      h.acc.textContent = started ? util.pct(s.firstTryRate, 1) : tr('common.dash');
      h.errors.textContent = String(s.errorStrokes);
      h.progress.textContent = util.pct(s.progress, 0);
      h.time.textContent = started ? util.formatDuration(s.elapsedMs) : '0:00';

      h.acc.parentNode.setAttribute('data-tone',
        started && s.firstTryRate < 0.9 ? (s.firstTryRate < 0.8 ? 'error' : 'warn') : '');
      h.errors.parentNode.setAttribute('data-tone', s.errorStrokes > 0 ? 'warn' : '');
    },

    refresh: function () {
      if (!this.refs) return;
      this.paintHud();

      var item = this.engine.currentItem();
      var ch = item ? item.ch : null;

      if (app.store.settings.showKeyboard) this.kb.hint(ch);

      var cue = ch ? this.kb.cue(ch) : null;
      this.refs.cueKey.textContent = cue ? (ch === ' ' ? tr('key.space') : ch) : tr('common.dash');
      this.refs.cueText.textContent = cue ? cue.text : tr('practice.allDone');

      this.paintAround(Math.max(0, this.engine.pos), this.engine.pos);
      this.scrollCaretIntoView();

      if (this.engine.started && !this.engine.finished) this.startTimer();
      if (this.engine.finished) this.stopTimer();
    },

    /* -------------------------------------------------------------- input */

    focusInput: function () {
      if (!this.refs) return;
      this.refs.input.focus();
      this.refs.stage.setAttribute('data-focused', 'true');
    },

    onKeyDown: function (e, container) {
      var res = this.engine.press(e);
      if (res.consumed) e.preventDefault();

      if (res.kind === 'escape') {
        this.refs.input.blur();
        return;
      }
      if (res.kind === 'ime') {
        this.showFeedback([
          el('span', { class: 'badge badge-warning', text: tr('practice.fb.imeBadge') }),
          el('span', { class: 't-body-sm', text: tr('practice.fb.imeHint') })
        ]);
        return;
      }
      if (res.kind === 'backspace-blocked') {
        this.showFeedback([
          el('span', { class: 'badge badge-warning', text: tr('practice.fb.strictBadge') }),
          el('span', { class: 't-body-sm', text: tr('practice.fb.strictHint') })
        ]);
        return;
      }
      if (res.kind === 'capslock') {
        this.showFeedback([
          el('span', { class: 'badge badge-warning', text: tr('practice.fb.capsBadge') }),
          el('span', { class: 't-body-sm', text: tr('practice.fb.capsHint') })
        ]);
        return;
      }
      if (res.kind === 'modifier' || res.kind === 'non-char' ||
          res.kind === 'tab-ignored' || res.kind === 'backspace-idle' ||
          res.kind === 'finished') {
        return;
      }
      if (res.kind === 'backspace') {
        this.refresh();
        this.showFeedback([el('span', { class: 't-body-sm mute', text: tr('practice.fb.retro') })]);
        return;
      }

      /* Anything reaching here is a character keystroke. */
      if (res.ok) {
        if (res.kind !== 'wrong-shift-side') {
          this.kb.flash(res.target ? res.target.code : e.code);
        }
        this.showSuccess(res);
      } else {
        this.showError(res);
      }

      this.refresh();

      if (res.finished) {
        this.stopTimer();
        this.finishSession(container);
      }
    },

    showFeedback: function (nodes) {
      if (!this.refs) return;
      util.clear(this.refs.feedback);
      nodes.forEach(function (n) { this.refs.feedback.appendChild(n); }, this);
    },

    showSuccess: function (res) {
      if (res.kind === 'wrong-shift-side') {
        /* Right character, wrong technique: worth a remark, not a penalty. */
        var ex = TD.Engine.explain(res);
        this.showFeedback([
          el('span', { class: 'badge badge-warning', text: tr('practice.fb.finger') }),
          el('span', { class: 't-body-sm', text: ex.message })
        ]);
        return;
      }
      this.showFeedback([el('span', { class: 'fb-good t-body-sm', text: tr('practice.fb.correct') })]);
    },

    showError: function (res) {
      var ex = TD.Engine.explain(res);
      this.showFeedback([
        el('span', { class: 'fb-char', text: res.expected === ' ' ? '␣' : res.expected }),
        el('span', { class: 'badge badge-error', text: ex.label }),
        el('span', { class: 'fb-hint t-body-sm', text: ex.message }),
        el('span', { class: 'spacer' }),
        el('span', { class: 'mute t-body-sm', text: tr('practice.fb.ignored') })
      ]);
      if (app.store.settings.sound) util.beep('error');
    },

    /* -------------------------------------------------------------- result */

    finishSession: function (container) {
      var result = this.engine.result();
      Stats.mergeSession(app.store.agg, result);
      app.store.save();
      if (app.store.settings.sound) util.beep('done');
      this.renderResult(result, container);
      this.paintHud();
    },

    renderResult: function (result, container) {
      var self = this;
      util.clear(this.refs.resultSlot);

      var metrics = [
        ['cpm', util.fmt(result.cpm, 0)],
        ['wpm', util.fmt(result.wpm, 0)],
        ['firstTry', util.pct(result.firstTryRate, 1)],
        ['rawAcc', util.pct(result.rawAccuracy, 1)],
        ['errors', String(result.errorStrokes)],
        ['time', util.formatDuration(result.elapsedMs)]
      ];

      var card = el('div', { class: 'card' });
      card.appendChild(el('div', { class: 'card-head' }, [
        el('span', { class: 't-title-sm', text: tr('result.title') }),
        el('span', { class: 'badge badge-neutral', text: result.title || '' }),
        result.symbolOnly ? el('span', { class: 'badge badge-primary', text: tr('result.badge.symbolOnly') }) : null,
        !result.allowBackspace ? el('span', { class: 'badge badge-warning', text: tr('result.badge.strict') }) : null
      ]));

      var grid = el('div', { class: 'result-metrics' });
      metrics.forEach(function (m) {
        grid.appendChild(el('div', {}, [
          el('span', { class: 'hud-label', text: tr('result.metric.' + m[0]) }),
          el('div', { class: 'result-metric-value', text: m[1] }),
          el('div', { class: 'mute', style: { 'font-size': '12px' }, text: tr('result.metric.' + m[0] + 'Sub') })
        ]));
      });
      card.appendChild(grid);

      /* Error breakdown: name the kinds of mistake rather than just counting. */
      var kinds = Object.keys(result.errorKinds || {});
      if (kinds.length) {
        card.appendChild(el('div', { class: 'card-head', style: { 'margin-top': '16px' } }, [
          el('span', { class: 't-title-sm', text: tr('result.errorSplit') })
        ]));
        card.appendChild(el('div', { class: 'chips' }, kinds.map(function (k) {
          return el('span', {
            class: 'badge ' + (k === 'wrong-key' ? 'badge-error' : 'badge-warning'),
            text: tr('kind.' + k) + ' ' + result.errorKinds[k]
          });
        })));
      }

      if (result.confusions && result.confusions.length) {
        card.appendChild(el('div', { class: 'card-head', style: { 'margin-top': '16px' } }, [
          el('span', { class: 't-title-sm', text: tr('result.confusions') })
        ]));
        var list = el('div', { class: 'list' });
        result.confusions.slice(0, 5).forEach(function (c) {
          list.appendChild(el('div', { class: 'list-row' }, [
            el('span', { class: 'mono t-strong', style: { 'font-size': '16px' }, text: c.expected === ' ' ? '␣' : c.expected }),
            el('span', { class: 'mute', text: '←' }),
            el('span', { class: 'mono', style: { color: 'var(--color-error)' }, text: c.typed === ' ' ? '␣' : c.typed }),
            el('span', { class: 'badge badge-neutral', text: tr('result.times', { n: c.count }) }),
            el('span', { class: 'spacer' }),
            el('span', { class: 't-body-sm dim', text: confusionInsight(c.expected, c.typed) })
          ]));
        });
        card.appendChild(list);
      }

      card.appendChild(el('div', { class: 'row', style: { 'margin-top': '16px' } }, [
        el('button', {
          class: 'btn btn-primary', type: 'button', text: tr('result.btn.repeat'),
          onclick: function () { self.startDrill(self.build(result.seed)); }
        }),
        el('button', {
          class: 'btn btn-secondary', type: 'button', text: tr('result.btn.newSet'),
          onclick: function () { self.startDrill(self.build()); }
        }),
        result.mode === 'adaptive' ? null : el('button', {
          class: 'btn btn-secondary', type: 'button', text: tr('result.btn.goAdaptive'),
          onclick: function () {
            app.store.setSetting('mode', 'adaptive');
            self.mount(app.container);
            /* The mode changed, so a fresh set is required — reusing the old
               one would keep showing symbol rows under a weak-key heading. */
            self.startDrill(self.build());
          }
        }),
        el('span', { class: 'spacer' }),
        el('button', {
          class: 'btn btn-text', type: 'button', text: tr('result.btn.seeStats'),
          onclick: function () { app.nav('stats'); }
        })
      ]));

      this.refs.resultSlot.appendChild(card);
    }
  };

  /* Turn a confusion pair into an actionable conclusion. */
  function confusionInsight(expected, typed) {
    var a = Keymap.lookup(expected);
    var b = Keymap.lookup(typed);
    if (!a || !b) return tr('stats.confusion.unknown');
    if (a.code === b.code) {
      if (!a.needsShift) return tr('stats.confusion.sameKeyExtraShift');
      return tr('stats.confusion.sameKeyMissingShift', { finger: Keymap.fingerLabel(a.shiftFinger) || '' });
    }
    if (a.finger === b.finger) {
      return tr('stats.confusion.sameFinger', { finger: Keymap.fingerLabel(a.finger) });
    }
    return tr('stats.confusion.wrongHand', {
      wrong: Keymap.fingerLabel(b.finger),
      right: Keymap.fingerLabel(a.finger)
    });
  }

  /* ============================================================ weak keys */

  function mountAdaptive(container) {
    var allRanked = TD.Adaptive.rankWeakKeys(app.store.agg, { minAttempts: 1, limit: 12 });
    var summary = Stats.summary(app.store.agg);

    var root = el('div', { class: 'stack-lg' });

    root.appendChild(UI.banner({
      kind: summary.sessions < 3 ? 'info' : null,
      icon: 'adaptive',
      title: tr('adaptive.banner.title'),
      detail: tr('adaptive.banner.body') + (summary.sessions < 3 ? tr('adaptive.banner.hintEarly') : '')
    }));

    var card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'card-head' }, [
      el('span', { class: 't-title-sm', text: tr('adaptive.rank.title') }),
      el('span', { class: 'badge badge-neutral', text: tr('adaptive.rank.keys', { n: allRanked.length }) }),
      el('span', { class: 'spacer' }),
      el('span', { class: 't-body-sm mute', text: tr('adaptive.rank.formula') })
    ]));

    if (!allRanked.length) {
      var hasAnyKeyData = Object.keys(app.store.agg.keys || {}).length > 0;
      card.appendChild(el('div', { class: 'empty' }, [
        el('div', {
          class: 't-display',
          text: tr(hasAnyKeyData ? 'adaptive.empty.noWeakTitle' : 'adaptive.empty.noDataTitle')
        }),
        el('div', {
          class: 't-body-sm',
          text: tr(hasAnyKeyData ? 'adaptive.empty.noWeakBody' : 'adaptive.empty.noDataBody')
        })
      ]));
    } else {
      var list = el('div', { class: 'list' });
      allRanked.forEach(function (r, i) {
        list.appendChild(el('div', { class: 'list-row' }, [
          el('span', { class: 'mute nowrap', style: { width: '20px' }, text: String(i + 1) }),
          el('span', {
            class: 'mono t-strong', style: { 'font-size': '18px', 'min-width': '28px', 'text-align': 'center' },
            text: r.label
          }),
          el('span', { class: 'badge badge-neutral', text: r.keyHint }),
          el('span', { class: 't-body-sm dim nowrap', text: r.fingerLabel }),
          /* Accurate but slow is a different kind of weakness; label it so a 0%
             error rate on the list is not confusing. */
          (r.errors === 0 && r.slow) ? el('span', { class: 'badge badge-warning', text: tr('adaptive.rank.slow') }) : null,
          /* Say plainly when the sample is too small to trust. */
          !r.enoughSamples ? el('span', {
            class: 'badge badge-neutral',
            title: tr('adaptive.rank.fewSamplesTitle', { n: TD.Adaptive.ENOUGH_SAMPLES }),
            text: tr('adaptive.rank.fewSamples')
          }) : null,
          el('span', { class: 'spacer' }),
          el('span', { class: 't-body-sm nowrap', text: tr('common.errorRate') + ' ' + util.pct(r.errorRate, 1) }),
          el('span', {
            class: 'badge ' + (r.errorRate > 0.18 ? 'badge-error' : (r.errorRate > 0.08 ? 'badge-warning' : 'badge-success')),
            text: r.errors + ' / ' + r.attempts
          }),
          el('span', {
            class: 't-body-sm mute nowrap', style: { width: '88px', 'text-align': 'right' },
            text: r.medianMs === null ? tr('common.noSample') : util.fmt(r.medianMs, 0) + ' ms'
          })
        ]));
      });
      card.appendChild(list);
    }
    root.appendChild(card);

    /* Jump straight into a drill. */
    var startCard = el('div', { class: 'card' });
    startCard.appendChild(el('div', { class: 'card-head' }, [
      el('span', { class: 't-title-sm', text: tr('adaptive.start.title') }),
      el('span', { class: 'spacer' }),
      el('span', { class: 't-body-sm mute', text: tr('adaptive.start.hint') })
    ]));
    startCard.appendChild(el('div', { class: 'row' }, [
      el('button', {
        class: 'btn btn-primary', type: 'button', text: tr('adaptive.btn.generate'),
        onclick: function () {
          app.store.setSetting('mode', 'adaptive');
          /* Go through navigation rather than mounting directly: navigation
             clears the container and updates the sidebar highlight. */
          app.nav('practice');
          Practice.startDrill(Practice.build());
        }
      }),
      el('button', {
        class: 'btn btn-secondary', type: 'button', text: tr('adaptive.btn.seeStats'),
        onclick: function () { app.nav('stats'); }
      })
    ]));
    root.appendChild(startCard);

    container.appendChild(root);
  }

  /* =============================================================== library */

  function mountLibrary(container) {
    var root = el('div', { class: 'stack-lg' });

    var addCard = el('div', { class: 'card' });
    addCard.appendChild(el('div', { class: 'card-head' }, [
      el('span', { class: 't-title-sm', text: tr('library.add.title') }),
      el('span', { class: 't-body-sm mute', text: tr('library.add.subtitle') })
    ]));

    var nameInput = el('input', { class: 'input', type: 'text', placeholder: tr('library.field.namePlaceholder') });
    var textArea = el('textarea', { class: 'textarea', placeholder: tr('library.field.contentPlaceholder') });

    addCard.appendChild(el('div', { class: 'stack' }, [
      UI.field(tr('library.field.name'), nameInput),
      UI.field(tr('library.field.content'), textArea, tr('library.field.contentHint'))
    ]));

    var fileInput = el('input', {
      type: 'file',
      accept: '.txt,.md,.js,.ts,.jsx,.tsx,.py,.sh,.bash,.go,.sql,.json,.yaml,.yml,.css,.html',
      style: { display: 'none' }
    });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      util.readTextFile(f).then(function (text) {
        textArea.value = text;
        if (!nameInput.value) nameInput.value = f.name.replace(/\.[^.]+$/, '');
        var n = text.split('\n').length;
        UI.toast(tr('library.toast.readOk', { n: n, name: f.name, lines: n }));
      }).catch(function (e) {
        UI.toast(tr('library.toast.readFail', { msg: e.message }), 'error');
      });
      fileInput.value = '';
    });

    function doAdd() {
      var name = nameInput.value.trim() ||
        tr('library.defaultName', { n: app.store.custom.length + 1 });
      var item = app.store.addCustom(name, textArea.value);
      app.store.setSetting('customId', item.id);
      textArea.value = '';
      nameInput.value = '';
      UI.toast(tr('library.toast.saved', { name: item.name }), 'success');
      app.nav('library');
    }

    addCard.appendChild(el('div', { class: 'row', style: { 'margin-top': '12px' } }, [
      el('button', {
        class: 'btn btn-secondary', type: 'button', text: tr('library.btn.import'),
        onclick: function () { fileInput.click(); }
      }),
      fileInput,
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn btn-primary', type: 'button', text: tr('library.btn.save'),
        onclick: function () {
          var text = textArea.value;
          if (!text.trim()) { UI.toast(tr('library.toast.empty'), 'error'); return; }
          var bad = findUnprintable(text);
          if (bad.length) {
            UI.confirm({
              title: tr('library.unprintable.title'),
              body: tr('library.unprintable.body', { n: bad.length }),
              content: el('div', {
                class: 'code-block t-code',
                style: { 'margin-top': '12px', 'max-height': '120px', overflow: 'auto' },
                text: bad.slice(0, 40).join('  ')
              }),
              confirmText: tr('library.unprintable.confirm'),
              danger: true
            }).then(function (ok) { if (ok) doAdd(); });
            return;
          }
          doAdd();
        }
      })
    ]));

    root.appendChild(addCard);

    var listCard = el('div', { class: 'card' });
    listCard.appendChild(el('div', { class: 'card-head' }, [
      el('span', { class: 't-title-sm', text: tr('library.list.title') }),
      el('span', { class: 'badge badge-neutral', text: tr('library.list.count', { n: app.store.custom.length }) })
    ]));

    if (!app.store.custom.length) {
      listCard.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 't-body', text: tr('library.list.empty') })
      ]));
    } else {
      var list = el('div', { class: 'list' });
      app.store.custom.forEach(function (c) {
        var lines = c.text.split('\n');
        var nonEmpty = lines.filter(function (l) { return l.trim().length; }).length;
        var badCount = findUnprintable(c.text).length;
        list.appendChild(el('div', { class: 'list-row' }, [
          el('div', { class: 'list-row-main' }, [
            el('div', { class: 'list-row-title', text: c.name }),
            el('div', {
              class: 'list-row-sub',
              text: tr('library.row.sub', {
                n: nonEmpty, lines: nonEmpty, chars: c.text.length, date: util.formatDate(c.addedAt)
              })
            })
          ]),
          badCount ? el('span', { class: 'badge badge-error', text: tr('library.row.badChars', { n: badCount }) }) : null,
          app.store.settings.customId === c.id ? el('span', { class: 'badge badge-primary', text: tr('library.row.inUse') }) : null,
          el('button', {
            class: 'btn btn-text', type: 'button', text: tr('library.btn.use'),
            onclick: function () {
              app.store.setSetting('customId', c.id);
              app.store.setSetting('mode', 'custom');
              app.nav('practice');
              Practice.startDrill(Practice.build());
            }
          }),
          el('button', {
            class: 'btn btn-text', type: 'button', text: tr('common.delete'),
            onclick: function () {
              UI.confirm({
                title: tr('library.confirm.deleteTitle'),
                body: tr('library.confirm.deleteBody', { name: c.name }),
                confirmText: tr('common.delete'), danger: true
              }).then(function (ok) {
                if (!ok) return;
                app.store.removeCustom(c.id);
                UI.toast(tr('library.toast.deleted'), 'success');
                app.nav('library');
              });
            }
          })
        ]));
      });
      listCard.appendChild(list);
    }
    root.appendChild(listCard);

    container.appendChild(root);
  }

  /* Characters a US keyboard cannot produce directly. Tabs are included
     because the drill has no way to consume them from pasted content. */
  function findUnprintable(text) {
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === '\n' || ch === '\r') continue;
      if (!Keymap.lookup(ch) && !seen[ch]) {
        seen[ch] = 1;
        out.push(ch === '\t' ? '⇥(tab)' : ch);
      }
    }
    return out;
  }

  /* ================================================================= stats */

  function mountStats(container) {
    var agg = app.store.agg;
    var summary = Stats.summary(agg);
    var root = el('div', { class: 'stack-lg' });

    if (!summary.sessions) {
      root.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'empty' }, [
          el('div', { class: 't-display', text: tr('stats.empty.title') }),
          el('div', { class: 't-body dim', text: tr('stats.empty.body') }),
          el('button', {
            class: 'btn btn-primary', type: 'button', text: tr('stats.empty.btn'),
            style: { 'margin-top': '12px' },
            onclick: function () { app.nav('practice'); }
          })
        ])
      ]));
      container.appendChild(root);
      return;
    }

    var overview = el('div', { class: 'grid-4' });
    /* Third element: whether this metric carries a sub-label. Metrics without
       one must not look up a Sub key at all — a missing key renders as the raw
       key name, which is exactly what happened before this flag existed. */
    [
      ['sessions', String(summary.sessions), false],
      ['chars', String(summary.chars), false],
      ['avgCpm', util.fmt(summary.avgCpm, 0), true],
      ['bestCpm', util.fmt(summary.bestCpm, 0), true],
      ['accuracy', util.pct(summary.accuracy, 1), true],
      ['duration', util.formatDuration(summary.ms), false],
      ['keys', String(summary.keyCount), true],
      ['errors', String(summary.errors), false]
    ].forEach(function (m) {
      var card = el('div', { class: 'card' }, [
        el('span', { class: 'hud-label', text: tr('stats.overview.' + m[0]) }),
        el('div', { class: 'result-metric-value', text: m[1] })
      ]);
      if (m[2]) {
        card.appendChild(el('div', {
          class: 'mute', style: { 'font-size': '12px' },
          text: tr('stats.overview.' + m[0] + 'Sub')
        }));
      }
      overview.appendChild(card);
    });
    root.appendChild(overview);

    var trendCard = el('div', { class: 'card' });
    trendCard.appendChild(el('div', { class: 'card-head' }, [
      el('span', { class: 't-title-sm', text: tr('stats.trend.title') })
    ]));
    var trendSlot = el('div');
    trendCard.appendChild(trendSlot);
    root.appendChild(trendCard);
    TD.Charts.renderTrend(trendSlot, Stats.trend(agg, 60));

    var fingerCard = el('div', { class: 'card' });
    fingerCard.appendChild(el('div', { class: 'card-head' }, [
      el('span', { class: 't-title-sm', text: tr('stats.finger.title') }),
      el('span', { class: 'spacer' }),
      el('span', { class: 't-body-sm mute', text: tr('stats.finger.subtitle') })
    ]));
    var fingerSlot = el('div');
    fingerCard.appendChild(fingerSlot);
    root.appendChild(fingerCard);
    TD.Charts.renderFingerBars(fingerSlot, Stats.fingerRows(agg));

    var heatCard = el('div', { class: 'card' });
    heatCard.appendChild(el('div', { class: 'card-head' }, [
      el('span', { class: 't-title-sm', text: tr('stats.heat.title') }),
      el('span', { class: 'spacer' }),
      el('span', { class: 't-body-sm mute', text: tr('stats.heat.subtitle') })
    ]));
    var heatKb = TD.Keyboard.create();
    heatKb.useHeatLegend();
    heatKb.heat(Stats.heatByCode(agg));
    heatCard.appendChild(heatKb.wrap);
    root.appendChild(heatCard);

    root.appendChild(buildKeyTable(agg));

    var conf = Stats.confusionRows(agg, 10);
    if (conf.length) {
      var confCard = el('div', { class: 'card' });
      confCard.appendChild(el('div', { class: 'card-head' }, [
        el('span', { class: 't-title-sm', text: tr('stats.confusion.title') })
      ]));
      var cl = el('div', { class: 'list' });
      conf.forEach(function (c) {
        cl.appendChild(el('div', { class: 'list-row' }, [
          el('span', { class: 'mono t-strong', style: { 'font-size': '16px' }, text: c.expected === ' ' ? '␣' : c.expected }),
          el('span', { class: 'mute', text: '←' }),
          el('span', { class: 'mono', style: { color: 'var(--color-error)' }, text: c.typed === ' ' ? '␣' : c.typed }),
          el('span', { class: 'badge badge-neutral', text: tr('result.times', { n: c.count }) }),
          el('span', { class: 'spacer' }),
          el('span', { class: 't-body-sm dim', text: confusionInsight(c.expected, c.typed) })
        ]));
      });
      confCard.appendChild(cl);
      root.appendChild(confCard);
    }

    container.appendChild(root);
  }

  function buildKeyTable(agg) {
    var state = { key: 'attempts', dir: -1 };
    var card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'card-head' }, [
      el('span', { class: 't-title-sm', text: tr('stats.table.title') }),
      el('span', { class: 'spacer' }),
      el('span', { class: 't-body-sm mute', text: tr('stats.table.subtitle') })
    ]));

    var wrap = el('div', { class: 'table-wrap' });
    var table = el('table', { class: 'table' });
    var thead = el('thead');
    var headRow = el('tr');
    var cols = [
      { key: 'label', labelKey: 'stats.table.char', mono: true },
      { key: 'keyHint', labelKey: 'stats.table.key' },
      { key: 'fingerLabel', labelKey: 'stats.table.finger' },
      { key: 'attempts', labelKey: 'stats.table.attempts', num: true },
      { key: 'errors', labelKey: 'stats.table.errors', num: true },
      { key: 'errorRate', labelKey: 'stats.table.errorRate', num: true },
      { key: 'medianMs', labelKey: 'stats.table.median', num: true },
      { key: 'samples', labelKey: 'stats.table.samples', num: true }
    ];
    cols.forEach(function (c) {
      var th = el('th', { class: 'sortable' + (c.num ? ' num' : ''), text: tr(c.labelKey) });
      th.addEventListener('click', function () {
        if (state.key === c.key) state.dir = -state.dir;
        else { state.key = c.key; state.dir = c.num ? -1 : 1; }
        renderBody();
      });
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = el('tbody');
    table.appendChild(tbody);
    wrap.appendChild(table);
    card.appendChild(wrap);

    function renderBody() {
      var ths = headRow.children;
      for (var i = 0; i < cols.length; i++) {
        var mark = ths[i].querySelector('.sort-mark');
        if (mark) mark.parentNode.removeChild(mark);
        if (cols[i].key === state.key) {
          ths[i].appendChild(el('span', { class: 'sort-mark', text: state.dir < 0 ? '▾' : '▴' }));
        }
      }

      var rows = Stats.keyRows(agg);
      rows.sort(function (a, b) {
        var x = a[state.key], y = b[state.key];
        if (x === null || x === undefined) x = state.dir < 0 ? -Infinity : Infinity;
        if (y === null || y === undefined) y = state.dir < 0 ? -Infinity : Infinity;
        if (typeof x === 'string') return state.dir * x.localeCompare(y);
        return state.dir * (x - y);
      });

      util.clear(tbody);
      rows.forEach(function (r) {
        tbody.appendChild(el('tr', {}, [
          el('td', { class: 'cell-key', text: r.label === tr('key.space') ? '␣ ' + r.label : r.label }),
          el('td', { class: 'dim', text: r.keyHint }),
          el('td', { class: 'dim', text: r.fingerLabel }),
          el('td', { class: 'num', text: String(r.attempts) }),
          el('td', { class: 'num', text: String(r.errors) }),
          el('td', { class: 'num' }, [
            el('span', {
              class: 'badge ' + (r.errorRate > 0.18 ? 'badge-error' : (r.errorRate > 0.08 ? 'badge-warning' : 'badge-success')),
              text: util.pct(r.errorRate, 1)
            })
          ]),
          el('td', { class: 'num', text: r.medianMs === null ? tr('common.dash') : util.fmt(r.medianMs, 0) + ' ms' }),
          el('td', { class: 'num mute', text: String(r.samples) })
        ]));
      });
    }

    renderBody();
    return card;
  }

  /* ============================================================== settings */

  function mountSettings(container) {
    var s = app.store.settings;
    var root = el('div', { class: 'stack-lg' });

    function set(key, value) {
      app.store.setSetting(key, value);
    }

    /* appearance */
    var look = el('div', { class: 'card' });
    look.appendChild(el('div', { class: 'card-head' }, [el('span', { class: 't-title-sm', text: tr('settings.appearance') })]));
    look.appendChild(UI.settingRow(tr('settings.theme'), tr('settings.themeDesc'),
      UI.seg(
        UI.Theme.SETTINGS.map(function (v) { return { value: v, label: UI.Theme.label(v) }; }),
        s.theme,
        function (v) {
          app.store.setSetting('theme', v);
          UI.Theme.apply(v);
          app.nav('settings');
        }
      )));
    look.appendChild(UI.settingRow(tr('lang.label'), tr('lang.desc'),
      UI.seg([
        { value: 'auto', label: tr('lang.auto') },
        { value: 'zh-CN', label: tr('lang.name.zh-CN') },
        { value: 'en', label: tr('lang.name.en') }
      ], s.lang, function (v) {
        /* Goes through I18n, which notifies and re-renders every view. */
        app.setLang(v);
      })));
    look.appendChild(UI.settingRow(tr('settings.fontSize'), tr('settings.fontSizeDesc'),
      UI.select([20, 22, 24, 28, 32].map(function (n) { return { value: n, label: n + ' px' }; }), s.fontSize, function (v) {
        var px = parseInt(v, 10);
        app.store.setSetting('fontSize', px);
        document.documentElement.style.setProperty('--typing-size', px + 'px');
      })));
    look.appendChild(UI.settingRow(tr('settings.keyboard'), tr('settings.keyboardDesc'),
      UI.switchRow(s.showKeyboard, function (v) { set('showKeyboard', v); app.nav('practice'); })));
    root.appendChild(look);

    /* practice rules */
    var rules = el('div', { class: 'card' });
    rules.appendChild(el('div', { class: 'card-head' }, [el('span', { class: 't-title-sm', text: tr('settings.rules') })]));
    rules.appendChild(UI.settingRow(tr('settings.symbolOnly'), tr('settings.symbolOnlyDesc'),
      UI.switchRow(s.symbolOnly, function (v) { set('symbolOnly', v); })));
    rules.appendChild(UI.settingRow(tr('settings.strict'), tr('settings.strictDesc'),
      UI.switchRow(!s.allowBackspace, function (v) { set('allowBackspace', !v); })));
    rules.appendChild(UI.settingRow(tr('settings.sound'), tr('settings.soundDesc'),
      UI.switchRow(s.sound, function (v) { set('sound', v); })));
    root.appendChild(rules);

    /* data */
    var data = el('div', { class: 'card' });
    data.appendChild(el('div', { class: 'card-head' }, [
      el('span', { class: 't-title-sm', text: tr('settings.data') }),
      el('span', { class: 'spacer' }),
      el('span', {
        class: 'badge ' + (app.store.available ? 'badge-success' : 'badge-warning'),
        text: tr(app.store.available ? 'settings.data.stored' : 'settings.data.memoryOnly')
      })
    ]));

    data.appendChild(el('div', { class: 'banner', style: { 'margin-bottom': '12px' } }, [
      el('div', { class: 'banner-body' }, [
        el('div', { class: 't-strong', text: tr('settings.data.whereTitle') }),
        el('div', {
          style: { 'margin-top': '2px' },
          text: tr('settings.data.whereBody', { key: TD.Store.KEY }) +
            (app.store.available ? '' : tr('settings.data.whereBodyMemory'))
        })
      ])
    ]));

    /* The file picker lives in a variable: putting it inside the row and
       finding it again with querySelector would be fragile. */
    var importFile = el('input', { type: 'file', accept: '.json', style: { display: 'none' } });
    importFile.addEventListener('change', function () {
      var f = importFile.files && importFile.files[0];
      if (!f) return;
      util.readTextFile(f).then(function (text) {
        var parsed = app.store.parseImport(text);
        if (!parsed.ok) { UI.toast(tr('settings.import.failed', { msg: parsed.error }), 'error'); return; }
        return UI.confirm({
          title: tr('settings.import.title'),
          body: tr('settings.import.body', {
            sessions: parsed.summary.sessions,
            keys: parsed.summary.keys,
            custom: parsed.summary.custom
          }),
          content: el('div', { class: 't-body-sm dim', style: { 'margin-top': '8px' }, text: tr('settings.import.hint') }),
          confirmText: tr('settings.import.merge'),
          cancelText: tr('settings.import.replace')
        }).then(function (merge) {
          var r = app.store.applyImport(parsed, !!merge);
          if (!r.ok) { UI.toast(tr('settings.import.failed', { msg: r.error }), 'error'); return; }
          if (r.skipped === 'duplicate') {
            UI.toast(tr('settings.import.duplicate'));
          } else if (r.partial) {
            UI.toast(tr('settings.import.partial', { n: r.newSessions }), 'error', 6000);
          } else {
            UI.toast(tr('settings.import.done'), 'success');
          }
          UI.Theme.apply(app.store.settings.theme);
          document.documentElement.style.setProperty('--typing-size', app.store.settings.fontSize + 'px');
          app.nav('stats');
        });
      }).catch(function (e) {
        UI.toast(tr('library.toast.readFail', { msg: e.message }), 'error');
      });
      importFile.value = '';
    });

    data.appendChild(el('div', { class: 'row row-wrap' }, [
      el('button', {
        class: 'btn btn-secondary', type: 'button', text: tr('settings.btn.export'),
        onclick: function () {
          util.downloadText('typing-drill-' + new Date().toISOString().slice(0, 10) + '.json',
            app.store.exportData(), 'application/json');
          UI.toast(tr('settings.toast.exported'), 'success');
        }
      }),
      importFile,
      el('button', {
        class: 'btn btn-secondary', type: 'button', text: tr('settings.btn.import'),
        onclick: function () { importFile.click(); }
      }),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn btn-danger', type: 'button', text: tr('settings.btn.clearStats'),
        onclick: function () {
          UI.confirm({
            title: tr('settings.confirm.clearTitle'),
            body: tr('settings.confirm.clearBody'),
            confirmText: tr('settings.confirm.clearConfirm'),
            danger: true
          }).then(function (ok) {
            if (!ok) return;
            app.store.clearStats();
            UI.toast(tr('settings.toast.cleared'), 'success');
            app.nav('stats');
          });
        }
      }),
      el('button', {
        class: 'btn btn-danger', type: 'button', text: tr('settings.btn.resetAll'),
        onclick: function () {
          UI.confirm({
            title: tr('settings.confirm.resetTitle'),
            body: tr('settings.confirm.resetBody'),
            confirmText: tr('settings.confirm.resetConfirm'),
            danger: true
          }).then(function (ok) {
            if (!ok) return;
            app.store.clearAll();
            UI.Theme.apply('auto');
            UI.toast(tr('settings.toast.reset'), 'success');
            location.reload();
          });
        }
      })
    ]));
    root.appendChild(data);

    /* about */
    var about = el('div', { class: 'card' });
    about.appendChild(el('div', { class: 'card-head' }, [el('span', { class: 't-title-sm', text: tr('settings.about') })]));
    about.appendChild(el('div', { class: 't-body-sm dim' }, [
      el('div', { text: tr('settings.about.line1') }),
      el('div', { style: { 'margin-top': '6px' }, text: tr('settings.about.line2') }),
      el('div', { style: { 'margin-top': '6px' }, text: tr('settings.about.line3') }),
      el('div', { style: { 'margin-top': '12px' } }, [
        el('span', { class: 'mute', text: tr('settings.about.verify') }),
        el('a', {
          href: '../tests/test.html',
          class: 't-body-sm',
          style: { color: 'var(--color-link)' },
          text: tr('settings.about.verifyLink')
        }),
        el('span', { class: 'mute', text: tr('settings.about.verifyCli') })
      ])
    ]));
    root.appendChild(about);

    container.appendChild(root);
  }

  /* ========================================================= keyboard test */

  /* The tester owns window-level key listeners, so the handle it returns has
     to be kept and destroyed when the view is left — see teardown below. */
  var keyTest = { handle: null };

  function mountKeyTest(container) {
    keyTest.handle = TD.Tester.mount(container, { store: app.store });
  }

  /* -------------------------------------------------------- view registry */

  /* Views expose a label *key*, not a label: main.js resolves it at render
     time so the sidebar follows a language switch. */
  var VIEWS = {
    practice: { labelKey: 'nav.practice', icon: 'practice', render: function (c) { Practice.mount(c); } },
    adaptive: { labelKey: 'nav.adaptive', icon: 'adaptive', render: mountAdaptive },
    library: { labelKey: 'nav.library', icon: 'library', render: mountLibrary },
    stats: { labelKey: 'nav.stats', icon: 'stats', render: mountStats },
    keytest: { labelKey: 'nav.keytest', icon: 'pulse', render: mountKeyTest },
    settings: { labelKey: 'nav.settings', icon: 'settings', render: mountSettings }
  };

  TD.Views = {
    LIST: Object.keys(VIEWS).map(function (k) {
      return { id: k, labelKey: VIEWS[k].labelKey, icon: VIEWS[k].icon };
    }),
    init: function (context) { app = context; },
    render: function (name, container) {
      var v = VIEWS[name] || VIEWS.practice;
      container.appendChild(document.createComment('view:' + name));
      v.render(container);
    },
    /* Stop the clock when leaving the practice view so it does not run in the
       background; engine state is kept, so returning resumes where you were.
       The keyboard tester listens on window for every key, so leaving that view
       MUST detach it — otherwise arrow keys pressed on another view would keep
       feeding its counters. */
    teardown: function (name) {
      if (name === 'practice') Practice.stopTimer();
      if (name === 'keytest' && keyTest.handle) {
        keyTest.handle.destroy();
        keyTest.handle = null;
      }
    },
    Practice: Practice
  };
})(window.TD);
