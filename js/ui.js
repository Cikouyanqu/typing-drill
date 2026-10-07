/* ==========================================================================
   ui.js — interface primitives: theme, icons, toasts, modal confirmation

   Theme resolution also lives here. index.html carries an equivalent minimal
   snippet in <head> so that data-theme is decided before first paint and the
   page does not flash light before turning dark.
   ========================================================================== */

window.TD = window.TD || {};
(function (TD) {
  'use strict';

  var util = TD.util;
  var el = util.el;

  function tr(key, params) {
    return TD.I18n ? TD.I18n.t(key, params) : key;
  }

  /* ---------------------------------------------------------------- theme */

  var Theme = {
    KEY: 'data-theme',
    SETTINGS: ['auto', 'light', 'dark'],
    LABEL_KEYS: { auto: 'theme.auto', light: 'theme.light', dark: 'theme.dark' },

    /* 'auto' resolves to a concrete value; light/dark pass through. */
    resolve: function (setting) {
      if (setting === 'light' || setting === 'dark') return setting;
      var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
      return (mq && mq.matches) ? 'dark' : 'light';
    },

    apply: function (setting) {
      var resolved = Theme.resolve(setting);
      document.documentElement.setAttribute('data-theme', resolved);
      return resolved;
    },

    /* When following the system, a change there must take effect live. */
    watch: function (onChange) {
      var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
      if (!mq) return;
      var handler = function () { onChange(); };
      if (mq.addEventListener) mq.addEventListener('change', handler);
      else if (mq.addListener) mq.addListener(handler);
    },

    label: function (setting) {
      return tr(Theme.LABEL_KEYS[setting] || 'theme.auto');
    }
  };

  /* ---------------------------------------------------------------- icons */

  /* All 16x16, stroke=currentColor line art. No icon library. */
  var ICON_PATHS = {
    practice: 'M2 4.5h12v7H2zM4 7h2M7 7h2M10 7h2M4 9.5h5M11 9.5h1',
    adaptive: 'M8 1.8a6.2 6.2 0 100 12.4A6.2 6.2 0 008 1.8zM8 5.4a2.6 2.6 0 100 5.2 2.6 2.6 0 000-5.2z',
    library: 'M2.5 3.2h11v9.6h-11zM2.5 6.2h11M5.8 6.2v6.6',
    stats: 'M2.5 13.5V8M8 13.5V2.5M13.5 13.5v-8',
    settings: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h11M5.6 3.1v2.8M10.4 6.6v2.8M4.2 10.1v2.8',
    chevronLeft: 'M10 3.5L5.5 8l4.5 4.5',
    chevronRight: 'M6 3.5L10.5 8L6 12.5',
    refresh: 'M13.2 8a5.2 5.2 0 11-1.6-3.8M13.2 2.2v3.2H10',
    download: 'M8 2.5v7.5M5 7l3 3 3-3M3 13.5h10',
    upload: 'M8 10.5V3M5 6l3-3 3 3M3 13.5h10',
    trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9',
    check: 'M3.5 8.5l3 3 6-6',
    plus: 'M8 3.5v9M3.5 8h9',
    close: 'M4 4l8 8M12 4l-8 8',
    play: 'M4.5 3.2l8 4.8-8 4.8z',
    eye: 'M8 3.5C4.5 3.5 2 8 2 8s2.5 4.5 6 4.5S14 8 14 8 11.5 3.5 8 3.5zM8 6.2a1.8 1.8 0 100 3.6 1.8 1.8 0 000-3.6z',
    /* A trace/heartbeat line: diagnostics rather than measurement. */
    pulse: 'M1.5 8h2.8l1.4-4.4L8.2 12l1.6-5.2 1.2 1.2h3.5',
    alert: 'M8 2.8l5.6 10H2.4zM8 6.4v3.2M8 11.2v.6',
    globe: 'M8 1.8a6.2 6.2 0 100 12.4A6.2 6.2 0 008 1.8zM1.9 8h12.2M8 1.8c1.7 1.8 2.6 3.9 2.6 6.2S9.7 12.4 8 14.2C6.3 12.4 5.4 10.3 5.4 8S6.3 3.6 8 1.8z'
  };

  function icon(name, size) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    var s = size || 16;
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', s);
    svg.setAttribute('height', s);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.4');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    if (ICON_PATHS[name]) {
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', ICON_PATHS[name]);
      svg.appendChild(p);
    }
    return svg;
  }

  /* --------------------------------------------------------------- toast */

  var toastHost = null;

  function ensureToastHost() {
    if (!toastHost) {
      toastHost = el('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(toastHost);
    }
    return toastHost;
  }

  function toast(message, kind, ms) {
    var host = ensureToastHost();
    var node = el('div', { class: 'toast' + (kind ? ' toast-' + kind : ''), text: message });
    host.appendChild(node);
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, ms || 3200);
    return node;
  }

  /* --------------------------------------------------------------- modal */

  function openModal(opts) {
    var scrim = el('div', { class: 'modal-scrim' });
    var box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
    box.appendChild(el('div', { class: 't-title-md', text: opts.title || '' }));
    if (opts.body) box.appendChild(el('div', { class: 't-body-sm dim', style: { 'margin-top': '8px' }, text: opts.body }));
    if (opts.content) box.appendChild(opts.content);

    var foot = el('div', { class: 'modal-foot' });

    function close(value) {
      document.removeEventListener('keydown', onKey, true);
      if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
      if (opts.onClose) opts.onClose(value);
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(false); }
    }

    (opts.actions || []).forEach(function (a) {
      foot.appendChild(el('button', {
        class: 'btn ' + (a.kind === 'primary' ? 'btn-primary' : (a.kind === 'danger' ? 'btn-danger' : 'btn-secondary')),
        type: 'button',
        text: a.text,
        onclick: function () {
          if (a.onClick) {
            var r = a.onClick(box);
            if (r === false) return;
          }
          close(a.value === undefined ? true : a.value);
        }
      }));
    });

    box.appendChild(foot);
    scrim.appendChild(box);
    scrim.addEventListener('click', function (e) { if (e.target === scrim) close(false); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(scrim);

    /* Move focus into the dialog so it is operable from the keyboard. */
    var focusable = box.querySelector('button, input, select, textarea');
    if (focusable) focusable.focus();

    return { close: close, box: box };
  }

  /* Returns Promise<bool> so callers can await the answer. */
  function confirm(opts) {
    return new Promise(function (resolve) {
      openModal({
        title: opts.title || tr('common.confirmTitle'),
        body: opts.body || '',
        content: opts.content || null,
        actions: [
          { text: opts.cancelText || tr('common.cancel'), kind: 'secondary', value: false, onClick: function () { resolve(false); } },
          { text: opts.confirmText || tr('common.confirm'), kind: opts.danger ? 'danger' : 'primary', value: true, onClick: function () { resolve(true); } }
        ],
        onClose: function (v) { resolve(!!v); }
      });
    });
  }

  /* Persistent notice strip, used for conditions that need explaining rather
     than a disappearing toast (storage unavailable, corrupt save). */
  function banner(opts) {
    var node = el('div', { class: 'banner' + (opts.kind ? ' banner-' + opts.kind : '') });
    node.appendChild(el('span', { class: 'banner-icon' }, [icon(opts.icon || 'alert')]));
    node.appendChild(el('div', { class: 'banner-body' }, [
      el('div', { class: 't-strong', text: opts.title || '' }),
      opts.detail ? el('div', { style: { 'margin-top': '2px' }, text: opts.detail }) : null,
      opts.content || null
    ]));
    if (opts.actions && opts.actions.length) {
      var acts = el('div', { class: 'banner-actions' });
      opts.actions.forEach(function (a) {
        acts.appendChild(el('button', {
          class: 'btn ' + (a.kind === 'primary' ? 'btn-primary' : 'btn-text') + ' btn-sm',
          type: 'button',
          text: a.text,
          onclick: a.onClick
        }));
      });
      node.appendChild(acts);
    }
    return node;
  }

  /* ------------------------------------------------------------ controls */

  function field(label, control, hint) {
    return el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: label }),
      control,
      hint ? el('span', { class: 'field-hint', text: hint }) : null
    ]);
  }

  function select(options, value, onChange) {
    var node = el('select', { class: 'select' });
    options.forEach(function (o) {
      var opt = el('option', { value: String(o.value), text: o.label });
      if (String(o.value) === String(value)) opt.selected = true;
      node.appendChild(opt);
    });
    node.addEventListener('change', function () { onChange(node.value); });
    return node;
  }

  function switchRow(checked, onChange) {
    var input = el('input', { type: 'checkbox' });
    input.checked = !!checked;
    input.addEventListener('change', function () { onChange(input.checked); });
    var track = el('span', { class: 'switch-track' });
    var label = el('label', { class: 'switch' }, [input, track]);
    label._input = input;
    return label;
  }

  function seg(items, active, onPick) {
    var node = el('div', { class: 'seg', role: 'group' });
    items.forEach(function (it) {
      node.appendChild(el('button', {
        class: 'seg-btn',
        type: 'button',
        text: it.label,
        'data-value': it.value,
        'aria-pressed': String(it.value === active),
        onclick: function () { onPick(it.value); }
      }));
    });
    return node;
  }

  /* Move the selected state without rebuilding the control.

     A seg writes aria-pressed once, at creation. A view whose callback refreshes
     only its own content — the keyboard tester switching layout, for instance —
     therefore leaves the highlight stuck on the original option while everything
     else changes, which reads as the switch not working. Views that re-render
     themselves (the practice mode switch, the settings rows) get this for free
     because the control is rebuilt. */
  function segSetActive(node, value) {
    if (!node) return;
    var btns = node.querySelectorAll('.seg-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', String(btns[i].getAttribute('data-value') === String(value)));
    }
  }

  function chips(items, isActive, onToggle) {
    var node = el('div', { class: 'chips' });
    items.forEach(function (it) {
      node.appendChild(el('button', {
        class: 'chip',
        type: 'button',
        title: it.title || '',
        'aria-pressed': String(isActive(it.value)),
        onclick: function () { onToggle(it.value); }
      }, [
        it.mono ? el('span', { class: 'mono', text: it.label }) : document.createTextNode(it.label),
        it.hint ? el('span', { class: 'mute', text: ' ' + it.hint }) : null
      ]));
    });
    return node;
  }

  /* Settings row: title and description on the left, control on the right. */
  function settingRow(title, desc, control) {
    return el('div', { class: 'setting' }, [
      el('div', { class: 'setting-main' }, [
        el('div', { class: 'setting-title', text: title }),
        desc ? el('div', { class: 'setting-desc', text: desc }) : null
      ]),
      el('div', { class: 'setting-ctl' }, [control])
    ]);
  }

  TD.UI = {
    Theme: Theme,
    icon: icon,
    toast: toast,
    openModal: openModal,
    confirm: confirm,
    banner: banner,
    field: field,
    select: select,
    switchRow: switchRow,
    seg: seg,
    segSetActive: segSetActive,
    chips: chips,
    settingRow: settingRow
  };
})(window.TD);
