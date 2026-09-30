/* ==========================================================================
   charts.js — hand-written SVG trend chart

   No charting library: the two series are drawn directly with SVG elements,
   which keeps the project at zero dependencies. Left axis is CPM (accent
   solid line), right axis is first-try accuracy (success dashed line); each
   series scales independently.
   ========================================================================== */

window.TD = window.TD || {};
(function (TD) {
  'use strict';

  var util = TD.util;

  function tr(key, params) {
    return TD.I18n ? TD.I18n.t(key, params) : key;
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function sv(tag, attrs, children) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (attrs[k] === null || attrs[k] === undefined) return;
        node.setAttribute(k, String(attrs[k]));
      });
    }
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  var W = 720, H = 200;
  var PAD_L = 44, PAD_R = 46, PAD_T = 14, PAD_B = 24;
  var INNER_W = W - PAD_L - PAD_R;
  var INNER_H = H - PAD_T - PAD_B;

  /**
   * Draw the trend into `target`.
   * trend comes from TD.Stats.trend(): { points: [{ts, cpm, acc}], minCpm, maxCpm, total }
   * opts: { emptyTitle, emptyText }
   */
  function renderTrend(target, trend, opts) {
    opts = opts || {};
    util.clear(target);

    var pts = (trend && trend.points) || [];
    if (pts.length < 2) {
      target.appendChild(util.el('div', { class: 'empty' }, [
        util.el('div', { class: 't-title-sm', text: opts.emptyTitle || tr('stats.trend.emptyTitle') }),
        util.el('div', { class: 't-body-sm', text: opts.emptyText || tr('stats.trend.emptyBody') })
      ]));
      return;
    }

    var maxCpm = Math.max(20, trend.maxCpm * 1.12);
    var xOf = function (i) { return PAD_L + (i / (pts.length - 1)) * INNER_W; };
    var yCpm = function (v) { return PAD_T + INNER_H - (util.clamp(v, 0, maxCpm) / maxCpm) * INNER_H; };
    var yAcc = function (v) { return PAD_T + INNER_H - util.clamp(v, 0, 1) * INNER_H; };

    var svg = sv('svg', {
      class: 'chart',
      viewBox: '0 0 ' + W + ' ' + H,
      preserveAspectRatio: 'none',
      role: 'img',
      'aria-label': tr('stats.trend.aria', { n: pts.length })
    });

    /* Grid plus both axis scales. */
    for (var g = 0; g <= 3; g++) {
      var frac = g / 3;
      var yy = PAD_T + INNER_H - frac * INNER_H;
      svg.appendChild(sv('line', { class: 'chart-grid', x1: PAD_L, y1: yy, x2: PAD_L + INNER_W, y2: yy }));
      /* left axis: CPM */
      svg.appendChild(sv('text', {
        class: 'chart-axis', x: PAD_L - 6, y: yy + 3, 'text-anchor': 'end'
      }, [document.createTextNode(String(Math.round(maxCpm * frac)))]));
      /* right axis: accuracy */
      svg.appendChild(sv('text', {
        class: 'chart-axis', x: PAD_L + INNER_W + 6, y: yy + 3, 'text-anchor': 'start'
      }, [document.createTextNode(Math.round(frac * 100) + '%')]));
    }

    var dCpm = '', dAcc = '';
    pts.forEach(function (p, i) {
      var x = xOf(i);
      dCpm += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + yCpm(p.cpm).toFixed(1);
      dAcc += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + yAcc(p.acc).toFixed(1);
    });
    svg.appendChild(sv('path', { class: 'chart-line-cpm', d: dCpm }));
    svg.appendChild(sv('path', { class: 'chart-line-acc', d: dAcc }));

    /* Points are only drawn when there are few enough to stay readable. */
    if (pts.length <= 30) {
      pts.forEach(function (p, i) {
        var dot = sv('circle', { class: 'chart-dot', cx: xOf(i), cy: yCpm(p.cpm), r: 2.6 });
        dot.appendChild(sv('title', {}, [document.createTextNode(
          util.formatDate(p.ts) + '　' + p.cpm.toFixed(0) + ' CPM　' + util.pct(p.acc, 1)
        )]));
        svg.appendChild(dot);
      });
    }

    /* Emphasise the latest point. */
    var last = pts[pts.length - 1];
    svg.appendChild(sv('circle', {
      class: 'chart-dot', cx: xOf(pts.length - 1), cy: yCpm(last.cpm), r: 4,
      style: 'fill:var(--color-primary);stroke:var(--color-canvas)'
    }));

    /* Date labels at both ends. */
    svg.appendChild(sv('text', {
      class: 'chart-axis', x: PAD_L, y: H - 6, 'text-anchor': 'start'
    }, [document.createTextNode(util.formatDate(pts[0].ts).slice(5))]));
    svg.appendChild(sv('text', {
      class: 'chart-axis', x: PAD_L + INNER_W, y: H - 6, 'text-anchor': 'end'
    }, [document.createTextNode(util.formatDate(last.ts).slice(5))]));

    target.appendChild(svg);

    target.appendChild(util.el('div', { class: 'chart-legend' }, [
      util.el('span', { class: 'chart-legend-item' }, [
        util.el('span', { class: 'chart-key' }),
        util.el('span', { text: tr('stats.trend.cpmAxis') })
      ]),
      util.el('span', { class: 'chart-legend-item' }, [
        util.el('span', { class: 'chart-key dashed' }),
        util.el('span', { text: tr('stats.trend.accAxis') })
      ]),
      util.el('span', { class: 'chart-legend-item mute', text: tr('stats.trend.total', { total: trend.total, shown: pts.length }) })
    ]));
  }

  /**
   * Per-finger error bars. Plain DOM rather than SVG: this is a layout
   * problem, not a drawing one.
   * rows comes from TD.Stats.fingerRows()
   */
  function renderFingerBars(target, rows) {
    util.clear(target);
    var maxRate = 0.02;
    rows.forEach(function (r) { if (r.errorRate > maxRate) maxRate = r.errorRate; });

    rows.forEach(function (r) {
      var tone = r.errorRate > 0.18 ? 'error' : (r.errorRate > 0.08 ? 'warn' : 'ok');
      var width = maxRate > 0 ? (r.errorRate / maxRate) * 100 : 0;
      target.appendChild(util.el('div', { class: 'finger-row' }, [
        util.el('div', { class: 'finger-row-name', text: r.label }),
        util.el('div', { class: 'finger-bar' }, [
          util.el('div', {
            class: 'finger-bar-fill',
            'data-tone': tone,
            style: { width: Math.max(width, r.attempts ? 2 : 0) + '%' }
          })
        ]),
        util.el('div', { class: 'finger-row-val' }, [
          document.createTextNode(r.attempts ? util.pct(r.errorRate, 1) : tr('common.dash')),
          util.el('span', { class: 'mute', text: r.attempts ? tr('stats.finger.times', { n: r.attempts }) : '  ' + tr('common.notPractised') })
        ])
      ]));
    });
  }

  TD.Charts = {
    renderTrend: renderTrend,
    renderFingerBars: renderFingerBars
  };
})(window.TD);
