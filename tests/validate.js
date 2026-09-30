/* ==========================================================================
   validate.js — Node assertion runner

   Purpose: run every logic assertion from the command line
   (`node tests/validate.js`) without opening a browser. It shares
   tests/cases.js with tests/test.html, so the two runners must agree.

   How: attach a minimal window stand-in to Node and require the front-end
   modules directly. Front-end modules only define functions at load time and
   never touch the DOM, so they load safely under Node.
   ========================================================================== */

'use strict';

var path = require('path');

var ROOT = path.resolve(__dirname, '..');

/* Minimal DOM stand-in: only the names window and localStorage need to exist. */
global.window = {};
if (typeof global.document === 'undefined') global.document = undefined;

var APP_FILES = [
  'util.js',
  'i18n.js',
  'locales/zh-CN.js',
  'locales/en.js',
  'keymap.js',
  'content.symbols.js',
  'content.snippets.js',
  'engine.js',
  'stats.js',
  'store.js',
  'adaptive.js',
  'keyboard.js'
];

var loaded = [];
APP_FILES.forEach(function (f) {
  try {
    require(path.join(ROOT, 'js', f));
    loaded.push(f);
  } catch (e) {
    console.error('failed to load: js/' + f + '\n  ' + (e && e.stack ? e.stack : e));
    process.exit(2);
  }
});

require(path.join(__dirname, 'cases.js'));

var TD = global.window.TD;

if (!TD || !TD.TEST_CASES) {
  console.error('test cases not loaded: window.TD.TEST_CASES is missing');
  process.exit(2);
}

/* -------------------------------------------------------- assertion set */

function makeAssertions() {
  var checks = 0;
  var failures = [];
  var skips = [];
  function fail(msg) { failures.push(msg); }
  return {
    ok: function (cond, msg) {
      checks++;
      if (!cond) fail(msg || 'expected a truthy value, got a falsy one');
    },
    eq: function (actual, expected, msg) {
      checks++;
      if (actual !== expected) {
        fail((msg || 'equality assertion') + ' → expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
      }
    },
    notEq: function (a, b, msg) {
      checks++;
      if (a === b) fail((msg || 'inequality assertion') + ' → both sides are ' + JSON.stringify(a));
    },
    near: function (actual, expected, tol, msg) {
      checks++;
      if (!(Math.abs(actual - expected) <= tol)) {
        fail((msg || 'approximate assertion') + ' → expected ' + expected + '±' + tol + ', got ' + actual);
      }
    },
    /* When the environment cannot support a case, say so honestly: a skip is
       neither a pass nor a failure. */
    skip: function (msg) { checks++; skips.push(msg); },
    _tally: function () { return { checks: checks, failures: failures, skips: skips }; }
  };
}

/* =========================================================== static checks

   These need the filesystem, so they run only in Node. They are the guard
   rails for the bilingual convention this project follows:
     1. every locale carries exactly the same key set (no drift, no half
        translated release);
     2. every key referenced from source exists in the dictionary (catches
        typos and forgotten additions);
     3. no CJK character appears anywhere in the source except the locale
        dictionaries — this catches both untranslated UI strings and
        untranslated comments in a single rule.
   ========================================================================= */

var fs = require('fs');

/* tests/ is included on purpose: the bilingual convention covers the test
   suite too, not just the shipping source.
   Documentation is listed file by file rather than by directory, because
   README.zh-CN.md is the one document that is supposed to be Chinese and must
   stay out of this check. */
var SOURCE_DIRS = ['js', 'css', 'tests'];
var SOURCE_FILES = ['index.html', 'start.cmd', 'start.sh',
  'README.md', 'AGENTS.md', 'todo.md', path.join('docs', 'I18N.md')];
var LOCALE_DIR = path.join('js', 'locales');

function walk(dir, out) {
  out = out || [];
  var full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return out;
  fs.readdirSync(full).forEach(function (name) {
    var rel = path.join(dir, name);
    var abs = path.join(ROOT, rel);
    if (fs.statSync(abs).isDirectory()) walk(rel, out);
    else out.push(rel);
  });
  return out;
}

function sourceFiles() {
  var files = [];
  SOURCE_DIRS.forEach(function (d) {
    walk(d).filter(function (f) {
      return /\.(js|css|html)$/.test(f) && f.indexOf(LOCALE_DIR) !== 0;
    }).forEach(function (f) { files.push(f); });
  });
  SOURCE_FILES.forEach(function (f) {
    if (fs.existsSync(path.join(ROOT, f))) files.push(f);
  });
  return files;
}

/* Remove comments while respecting string literals, so example keys inside
   documentation comments are not mistaken for real references. Regex literals
   are not tracked (none in this codebase contain comment markers). */
function stripComments(text) {
  var out = '';
  var i = 0, n = text.length;
  var quote = null;
  while (i < n) {
    var c = text[i], d = text[i + 1];
    if (quote) {
      if (c === '\\') { out += c + (d === undefined ? '' : d); i += 2; continue; }
      if (c === quote) quote = null;
      out += c; i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i++; continue; }
    if (c === '/' && d === '/') {
      while (i < n && text[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) {
        out += (text[i] === '\n' ? '\n' : ' ');
        i++;
      }
      out += '  ';
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/* Extract the argument text of every tr(...) / t(...) / labelKey: call, with
   balanced-paren scanning so nested params objects do not truncate it. */
function extractKeyRefs(text) {
  text = stripComments(text);
  var refs = [];
  var dynamic = 0;
  var re = /\b(?:tr|t)\s*\(|labelKey\s*:\s*/g;
  var m;
  while ((m = re.exec(text)) !== null) {
    var start = re.lastIndex;
    var depth = 1;
    var i = start;
    if (m[0].indexOf('labelKey') === 0) {
      /* labelKey: 'x.y' — take the literal directly, no parens involved. */
      var lit = /^(['"])([^'"]+)\1/.exec(text.slice(i));
      if (lit) refs.push(lit[2]);
      continue;
    }
    while (i < text.length && depth > 0) {
      var c = text[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    var arg = text.slice(start, i - 1);
    if (arg.indexOf('+') !== -1 && /['"]\s*\+/.test(arg)) { dynamic++; continue; }
    var lre = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
    var lm;
    while ((lm = lre.exec(arg)) !== null) {
      /* Only dotted, key-shaped literals are candidate dictionary keys. */
      if (/^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_.-]+)+$/.test(lm[2])) refs.push(lm[2]);
    }
  }
  return { refs: refs, dynamic: dynamic };
}

function staticChecks(I18n) {
  var problems = [];
  var notes = [];

  /* 1 — locale key parity */
  var langs = I18n.LANG_IDS.filter(function (l) { return I18n.hasDict(l); });
  var sets = langs.map(function (l) { return I18n.keysOf(l); });
  var base = sets[0] || [];
  langs.forEach(function (l, i) {
    var only = sets[i].filter(function (k) { return base.indexOf(k) === -1; });
    var missing = base.filter(function (k) { return sets[i].indexOf(k) === -1; });
    if (only.length) problems.push('[' + l + '] keys not present in ' + langs[0] + ': ' + only.slice(0, 8).join(', '));
    if (missing.length) problems.push('[' + l + '] missing keys: ' + missing.slice(0, 8).join(', '));
  });
  notes.push('dictionary keys: ' + langs.map(function (l, i) { return l + '=' + sets[i].length; }).join('  '));

  /* 2 — every referenced key exists */
  var known = Object.create(null);
  langs.forEach(function (l) {
    I18n.keysOf(l).forEach(function (k) { known[k] = 1; });
  });

  var files = sourceFiles();
  var totalRefs = 0;
  var dynamicSites = 0;
  var missingKeys = Object.create(null);
  files.forEach(function (rel) {
    if (!/\.(js|html)$/.test(rel)) return;
    var text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    var res = extractKeyRefs(text);
    dynamicSites += res.dynamic;
    res.refs.forEach(function (k) {
      totalRefs++;
      if (!known[k]) missingKeys[k] = rel;
    });
  });
  Object.keys(missingKeys).forEach(function (k) {
    problems.push('references a key that is not in any dictionary: ' + k + ' (' + missingKeys[k] + ')');
  });
  notes.push('dictionary keys referenced from source: ' + totalRefs +
    ' (all verified); dynamically composed calls: ' + dynamicSites +
    ' (prefix families are covered by key parity)');

  /* 3 — no CJK outside the locale dictionaries, in strings OR comments.
     A line may opt out with an explicit marker: asserting on a Chinese
     dictionary value is legitimate, and so is quoting a CJK character as test
     data. The marker keeps that decision visible and reviewable rather than
     silently excluding a whole directory. */
  var CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
  var ALLOW = 'i18n-check-allow';
  var leaks = [];
  var allowed = 0;
  files.forEach(function (rel) {
    var text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf(ALLOW) !== -1) { allowed++; continue; }
      if (CJK.test(lines[i])) leaks.push(rel + ':' + (i + 1));
    }
  });
  if (leaks.length) {
    problems.push('CJK text still present outside js/locales/: ' + leaks.slice(0, 10).join('  ') +
      (leaks.length > 10 ? '  …' + leaks.length + ' lines total' : ''));
  } else {
    notes.push('CJK appears only inside js/locales/ — no leftover strings or comments' +
      (allowed ? ' (' + allowed + ' line(s) opted out with ' + ALLOW + ')' : ''));
  }

  return { problems: problems, notes: notes };
}


function main() {
  var pad = '────────────────────────────────────────────────────────────';
  console.log('');
  console.log('typing-drill · logic assertions (Node)');
  console.log(pad);

  var pass = 0, failed = 0, skipped = 0;
  var totalChecks = 0;
  var allFailures = [];

  TD.TEST_CASES.forEach(function (c) {
    var t = makeAssertions();
    var thrown = null;
    try {
      c.fn(t, TD);
    } catch (e) {
      thrown = (e && e.message) ? e.message : String(e);
    }
    var tally = t._tally();
    totalChecks += tally.checks;

    if (thrown || tally.failures.length) {
      failed++;
      console.log('\u2717 ' + c.name);
      if (thrown) console.log('    · threw: ' + thrown);
      tally.failures.forEach(function (f) { console.log('    · ' + f); });
      allFailures.push(c.name);
    } else if (tally.skips.length) {
      skipped++;
      console.log('~ ' + c.name + '  (skipped ' + tally.skips.length + ')');
      tally.skips.forEach(function (s) { console.log('    · ' + s); });
    } else {
      pass++;
      console.log('\u2713 ' + c.name + '  (' + tally.checks + ')');
    }
  });

  /* Content overview: running the suite also reports content size, so a
     shrinking hand-written library cannot go unnoticed. */
  console.log(pad);
  console.log('Content:');
  var totalLines = 0;
  TD.Snippets.PACKS.forEach(function (p) {
    totalLines += p.lines.length;
    console.log('  ' + p.label.padEnd(10, ' ') + String(p.lines.length).padStart(3, ' ') +
      ' lines   symbol density ' + (p.avgRatio * 100).toFixed(1) + '%');
  });
  console.log('  ' + String(totalLines).padStart(13, ' ') + ' lines total');
  console.log('  symbol groups   ' + TD.SymbolDrills.GROUPS.length);
  console.log('  key map         ' + Object.keys(TD.Keymap.BY_CODE).length + ' physical keys / ' +
    Object.keys(TD.Keymap.BY_CHAR).length + ' typeable characters');

  /* Static checks: the guard rails for the bilingual convention. */
  console.log(pad);
  console.log('Static checks:');
  var stat = staticChecks(TD.I18n);
  stat.notes.forEach(function (n) { console.log('  · ' + n); });
  stat.problems.forEach(function (p) { console.log('  \u2717 ' + p); });

  console.log(pad);
  var ok = failed === 0 && stat.problems.length === 0;
  console.log((failed === 0 ? 'All cases passed' : failed + ' case(s) failed') +
    ' — ' + pass + ' / ' + (pass + failed) + ' cases' +
    (skipped ? ' (' + skipped + ' skipped)' : '') +
    ', ' + totalChecks + ' assertions' +
    (stat.problems.length ? ', ' + stat.problems.length + ' static problem(s)' : ''));

  if (!ok) {
    if (allFailures.length) {
      console.log('\nFailed cases:');
      allFailures.forEach(function (n) { console.log('  - ' + n); });
    }
    process.exit(1);
  }
  process.exit(0);
}

main();
