/* ==========================================================================
   main.js — boot and application shell

   Order: storage probe → load save → initialise i18n → apply theme → build
   shell → register views → open the practice view.

   Conditions that need explaining rather than a disappearing toast (storage
   unavailable, corrupt save) render as a persistent notice strip instead of
   being swallowed.
   ========================================================================== */

window.TD = window.TD || {};
(function (TD) {
  'use strict';

  var util = TD.util;
  var UI = TD.UI;
  var I18n = TD.I18n;
  var el = util.el;

  var Store = TD.Store;

  function tr(key, params) {
    return I18n ? I18n.t(key, params) : key;
  }

  /* Theme and language both cycle through a fixed list in the top bar. */
  var THEME_ORDER = ['auto', 'light', 'dark'];
  var LANG_ORDER = ['auto', 'zh-CN', 'en'];
  var LANG_SHORT = { auto: 'lang.short.auto', 'zh-CN': 'lang.short.zh-CN', en: 'lang.short.en' };
  var LANG_NAME = { 'zh-CN': 'lang.name.zh-CN', en: 'lang.name.en' };

  var state = { view: 'practice' };

  /* ----------------------------------------------------------- shell */

  function buildSidebar() {
    var sidebar = document.getElementById('sidebar');
    util.clear(sidebar);

    sidebar.appendChild(el('div', { class: 'sidebar-brand' }, [
      el('span', { class: 'sidebar-brand-mark', text: '{}' }),
      el('div', { class: 'sidebar-brand-text' }, [
        el('div', { class: 't-strong', text: tr('app.brand') }),
        el('div', { class: 't-caption mute', text: tr('app.brandSub') })
      ])
    ]));

    var nav = el('nav', { class: 'sidebar-nav' });
    TD.Views.LIST.forEach(function (v) {
      nav.appendChild(el('button', {
        class: 'nav-item',
        type: 'button',
        'data-view': v.id,
        onclick: function () { go(v.id); }
      }, [
        el('span', { class: 'nav-icon' }, [UI.icon(v.icon)]),
        el('span', { class: 'sidebar-nav-label', text: tr(v.labelKey) })
      ]));
    });
    sidebar.appendChild(nav);

    var foot = el('div', { class: 'sidebar-foot' });
    foot.appendChild(el('button', {
      class: 'nav-item',
      type: 'button',
      title: tr('nav.collapse'),
      onclick: toggleCollapse
    }, [
      el('span', { class: 'nav-icon' }, [UI.icon('chevronLeft')]),
      el('span', { class: 'sidebar-nav-label sidebar-foot-text', text: tr('nav.collapse') })
    ]));
    sidebar.appendChild(foot);

    sidebar.setAttribute('data-collapsed', Store.settings.sidebarCollapsed ? 'true' : 'false');
    markCurrentNav();
  }

  function markCurrentNav() {
    var items = document.querySelectorAll('.nav-item[data-view]');
    for (var i = 0; i < items.length; i++) {
      if (items[i].getAttribute('data-view') === state.view) items[i].setAttribute('aria-current', 'page');
      else items[i].removeAttribute('aria-current');
    }
  }

  function toggleCollapse() {
    var sidebar = document.getElementById('sidebar');
    var next = sidebar.getAttribute('data-collapsed') !== 'true';
    sidebar.setAttribute('data-collapsed', next ? 'true' : 'false');
    Store.setSetting('sidebarCollapsed', next);
  }

  function buildTopbar() {
    var topbar = document.getElementById('topbar');
    util.clear(topbar);

    var current = TD.Views.LIST.filter(function (v) { return v.id === state.view; })[0];
    topbar.appendChild(el('div', { class: 'topbar-title t-title-sm', text: current ? tr(current.labelKey) : '' }));

    /* Storage state: at a glance, whether records are actually being kept. */
    topbar.appendChild(el('span', {
      class: 'badge ' + (Store.available ? 'badge-success' : 'badge-warning'),
      title: Store.available ? tr('topbar.savedTitle') : tr('topbar.memoryOnlyTitle', { reason: Store.reason || '' })
    }, [
      el('span', { class: 'dot ' + (Store.available ? 'dot-running' : 'dot-warning') }),
      el('span', { text: Store.available ? tr('topbar.saved') : tr('topbar.memoryOnly') })
    ]));

    /* Theme quick switch: system → light → dark. */
    topbar.appendChild(el('button', {
      class: 'btn btn-secondary btn-sm',
      type: 'button',
      title: tr('theme.switchTitle', { name: UI.Theme.label(Store.settings.theme) }),
      text: UI.Theme.label(Store.settings.theme),
      onclick: function (e) {
        var i = THEME_ORDER.indexOf(Store.settings.theme);
        var next = THEME_ORDER[(i + 1) % THEME_ORDER.length];
        Store.setSetting('theme', next);
        UI.Theme.apply(next);
        e.target.textContent = UI.Theme.label(next);
        e.target.title = tr('theme.switchTitle', { name: UI.Theme.label(next) });
      }
    }));

    /* Language quick switch, next to the theme so both live in one place. */
    topbar.appendChild(el('button', {
      class: 'btn btn-secondary btn-sm',
      type: 'button',
      title: tr('lang.switchTitle', { name: langName(Store.settings.lang) }),
      onclick: function (e) {
        var i = LANG_ORDER.indexOf(Store.settings.lang);
        var next = LANG_ORDER[(i + 1) % LANG_ORDER.length];
        /* setLang goes through I18n, which notifies and re-renders. */
        setLang(next);
        e.target.title = tr('lang.switchTitle', { name: langName(Store.settings.lang) });
      }
    }, [
      el('span', { class: 'nav-icon', style: { 'margin-right': '4px' } }, [UI.icon('globe')]),
      el('span', { text: langShort(Store.settings.lang) })
    ]));
  }

  function langShort(setting) {
    if (setting === 'auto') return tr(LANG_SHORT[I18n.lang()] || LANG_SHORT.en);
    return tr(LANG_SHORT[setting] || LANG_SHORT.en);
  }

  function langName(setting) {
    if (setting === 'auto') return tr('lang.auto');
    return LANG_NAME[setting] ? tr(LANG_NAME[setting]) : setting;
  }

  function setLang(setting) {
    Store.settings.lang = setting;
    Store.save();
    I18n.set(setting);
  }

  /* Persistent notices: corrupt save, storage unavailable. */
  function buildNotices() {
    var host = document.getElementById('notices');
    util.clear(host);

    if (Store.corrupt) {
      host.appendChild(UI.banner({
        kind: 'error',
        title: tr('notice.corrupt.title'),
        detail: tr('notice.corrupt.body'),
        actions: [{ text: tr('notice.dismiss'), onClick: function () { util.clear(host); } }]
      }));
    }

    if (!Store.available) {
      host.appendChild(UI.banner({
        kind: 'warning',
        title: tr('notice.noStorage.title'),
        detail: tr('notice.noStorage.body', { reason: Store.reason || '' }),
        actions: [{
          text: tr('notice.exportBackup'),
          onClick: function () {
            util.downloadText('typing-drill-' + new Date().toISOString().slice(0, 10) + '.json',
              Store.exportData(), 'application/json');
            UI.toast(tr('settings.toast.exported'), 'success');
          }
        }]
      }));
    }
  }

  /* ---------------------------------------------------------- navigation */

  function go(name) {
    TD.Views.teardown(state.view);
    state.view = name;
    markCurrentNav();

    var container = document.getElementById('view');
    util.clear(container);
    TD.Views.render(name, container);
    buildTopbar();

    /* Focus the capture input on the practice view so typing can start
       without an extra click. */
    if (name === 'practice') TD.Views.Practice.focusInput();
    if (container.scrollTop) container.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  /* A language switch re-renders everything: the views build their DOM from
     translated strings, so nothing can stay stale — except objects that are
     kept alive across renders and need an explicit relabel. */
  function onLangChanged() {
    buildSidebar();
    buildNotices();
    var container = document.getElementById('view');
    util.clear(container);
    TD.Views.render(state.view, container);
    buildTopbar();
    if (state.view === 'practice') TD.Views.Practice.focusInput();
  }

  /* --------------------------------------------------------------- boot */

  function boot() {
    Store.probe();
    Store.load();

    I18n.init({
      setting: Store.settings.lang,
      persist: function (value) {
        Store.settings.lang = value;
        Store.save();
      }
    });

    UI.Theme.apply(Store.settings.theme);
    UI.Theme.watch(function () {
      /* Only following the system needs a live response to system changes. */
      if (Store.settings.theme === 'auto') UI.Theme.apply('auto');
    });
    document.documentElement.style.setProperty('--typing-size', Store.settings.fontSize + 'px');

    /* Static markup in index.html carries data-i18n attributes. */
    I18n.applyDom(document);
    I18n.onChange(onLangChanged);

    buildSidebar();

    TD.Views.init({
      store: Store,
      nav: go,
      setLang: setLang,
      container: document.getElementById('view')
    });

    buildNotices();
    go('practice');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.TD);
