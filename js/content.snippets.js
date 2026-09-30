/* ==========================================================================
   content.snippets.js — library of real code lines

   Selection criterion: a line must be a complete statement you would actually
   type, with a high ratio of symbol characters — not a syntax fragment.

   Five packs: JS/TS (including JSON and JSX), Python, Shell, Go, SQL.
   The code itself is the practice content and is language-independent, so it
   is identical for every UI language. Only pack labels and descriptions are
   translated.

   Note: escaping in this file is dense (\\ , \' and backticks mixed). After
   editing, run `node --check js/content.snippets.js`, then the test suite,
   which spot-checks that the escapes resolved to the intended characters.
   ========================================================================== */

window.TD = window.TD || {};
(function (TD) {
  'use strict';

  var util = TD.util;
  var Keymap = TD.Keymap;

  function tr(key, params) {
    return TD.I18n ? TD.I18n.t(key, params) : key;
  }

  function joinList(items) {
    return TD.I18n ? TD.I18n.joinList(items) : items.join(', ');
  }

  function defineText(obj, prop, key) {
    Object.defineProperty(obj, prop, {
      enumerable: false,
      configurable: true,
      get: function () { return tr(key); }
    });
  }

  var PACKS = [
    {
      id: 'js',
      lines: [
        /* destructuring and modules */
        'const { data, error } = await api.get(\'/users\');',
        'const [first, ...rest] = items.filter(Boolean);',
        'const { name = \'anon\', age = 0 } = props;',
        'const [, second, , fourth] = arr;',
        'const { data: { list = [] } = {} } = res;',
        'export { default as Foo } from \'./foo.js\';',
        'import { useState, useEffect } from \'react\';',
        'export default function App({ children }) {',
        /* arrows and template literals */
        'items.map(x => ({ id: x.id, name: x.name }));',
        'const sum = (a, b) => a + b;',
        'const pick = (o, k) => o?.[k] ?? null;',
        'setTimeout(() => { clearTimeout(timer); }, 1000);',
        'const url = `/api/v1/users/${id}?page=${page}`;',
        'const msg = `${name}: ${value.toFixed(2)}`;',
        'console.log(`${JSON.stringify(obj, null, 2)}`);',
        /* conditionals, optional chaining, bitwise */
        'if (a?.b?.[0] ?? fallback) { render(); }',
        'const ok = x !== null && x !== undefined && x > 0;',
        'if (res.status >= 200 && res.status < 300) return res;',
        'while (i < len && arr[i] !== target) i++;',
        'const t = typeof v === \'string\' ? v.trim() : String(v);',
        'const merged = { ...a, ...b, c: 1 };',
        'const unique = [...new Set(list)];',
        'const flags = a | b | c;',
        'x <<= 1;',
        'n = (n + 1) % len;',
        /* types */
        'interface User { id: number; name?: string }',
        'type Cb = (err: Error | null, data?: T) => void;',
        'const map = new Map<string, number[]>();',
        'function first<T>(arr: T[]): T | undefined {',
        'let n: number | null = null;',
        'enum Kind { A = \'a\', B = \'b\' }',
        'type Row = Record<string, string | number>;',
        /* JSX */
        '<Foo bar={baz} {...rest} onClick={() => setX(x + 1)} />',
        '<div className={cls} style={{ margin: \'0 auto\' }}>',
        '{items.map((it, i) => <li key={i}>{it.name}</li>)}',
        '<Route path="/u/:id" element={<User />} />',
        '<input value={v} onChange={e => setV(e.target.value)} />',
        /* regex and strings */
        'const re = /^[a-z0-9_-]+$/i;',
        'const parts = str.split(/[,\\s]+/);',
        'path.replaceAll(\'\\\\\', \'/\');',
        'const u = new URL(\'https://x.dev/a?b=1&c=2\');',
        'const { hostname, searchParams } = u;',
        'arr.sort((a, b) => a - b);',
        'if (!(key in obj)) throw new Error(\'missing\');',
        'for (const [k, v] of Object.entries(o)) {',
        'delete obj?.[key];',
        /* JSON */
        '{ "name": "svc", "port": 5002, "tags": ["a", "b"] }',
        '"deps": { "express": "^4.18.0", "pg": "~8.11.0" },',
        '"scripts": { "dev": "vite", "build": "vite build" },',
        '[{ "id": 1, "ok": true }, { "id": 2, "ok": false }]',
        '"env": { "NODE_ENV": "production" }'
      ]
    },
    {
      id: 'python',
      lines: [
        'def f(a: int, b: str = "x") -> dict[str, int]:',
        'if __name__ == "__main__":',
        'for i, (k, v) in enumerate(d.items()):',
        'print(f"{name!r}: {value:>8.2f}")',
        'data.get("key", [])[1:]',
        '@app.route("/users/<int:uid>", methods=["GET"])',
        '@staticmethod',
        'class Foo(Bar, metaclass=Meta):',
        'self._cache: dict[str, list[int]] = {}',
        'with open(path, "r", encoding="utf-8") as fh:',
        'lines = [ln.strip() for ln in fh if ln.strip()]',
        'except (ValueError, KeyError) as exc:',
        'raise ValueError(f"bad value: {v!r}") from exc',
        'x, *rest = [1, 2, 3, 4]',
        'a, b = b, a',
        's = "|".join(str(x) for x in items)',
        'if not (a and b) or c is None:',
        'assert len(rows) > 0, "empty"',
        'result = {k: v for k, v in d.items() if v is not None}',
        'nums = [x ** 2 for x in range(10) if x % 2 == 0]',
        'n = (n + 1) % 60',
        'r = re.sub(r"\\s+", " ", text).strip()',
        'm = re.match(r"^(?P<key>[a-z_]+)=(.+)$", line)',
        'bits = flags & ~MASK',
        'total += int(item["qty"]) * item["price"]',
        'path = Path(__file__).resolve().parent / "data"',
        'args = parser.parse_args()',
        'subprocess.run(cmd, shell=True, check=True, capture_output=True)',
        'return {"ok": True, "data": rows or []}',
        'if isinstance(v, (list, tuple)) and len(v) > 1:',
        'for k, v in sorted(d.items(), key=lambda kv: -kv[1]):',
        'a[1:3], a[::2], a[::-1]',
        'x = y if z else w',
        'n //= 2',
        'print(*args, sep=", ", end="\\n")',
        'd.setdefault("k", []).append(v)',
        'class C: __slots__ = ("a", "b")',
        'with suppress(FileNotFoundError):',
        'async def fetch(session, url):',
        'await asyncio.gather(*tasks, return_exceptions=True)',
        'yield from (x for x in gen if x)'
      ]
    },
    {
      id: 'shell',
      lines: [
        'if [ -z "${VAR}" ]; then',
        'if [[ "$x" =~ ^[0-9]+$ ]]; then',
        'for f in *.log; do gzip "$f"; done',
        'echo "${arr[@]:1:2}"',
        ': "${VAR:?must be set}"',
        'echo "${#str}"',
        'x=${1:-default}',
        'grep -E \'^[a-z_]+=\' .env | cut -d= -f1',
        'awk -F: \'{print $1, $3}\' /etc/passwd',
        "sed -i 's/\\r$//' \"$file\"",
        "find . -type f -name '*.tmp' -delete",
        'tar -czf "backup-$(date +%F).tar.gz" ./data',
        'docker run --rm -v "$PWD:/w" -w /w node:20 npm test',
        'cmd > out.log 2>&1 &',
        'nohup ./svc.sh >> svc.log 2>&1 &',
        'cat <<EOF > /tmp/x',
        'export PATH="$HOME/.local/bin:$PATH"',
        "PS1='\\u@\\h:\\w\\$ '",
        '[ -f "$f" ] && source "$f" || true',
        'echo "$(( (a + b) * 2 ))"',
        'if (( n % 2 == 0 )); then',
        'while IFS= read -r line; do echo "$line"; done < in.txt',
        "printf '%s\\t%s\\n' \"$k\" \"$v\"",
        "curl -fsSL -H 'Accept: application/json' \"$URL\" | jq -r '.items[]?.name'",
        "ps aux | grep -v grep | grep -c '[n]ode'",
        'du -sh */ | sort -rh | head -5',
        "df -h | awk '$5+0 > 80 {print $6}'",
        'chmod 755 script.sh && ./script.sh',
        'set -euo pipefail',
        'trap \'rm -f "$tmp"\' EXIT',
        'mktemp -d "${TMPDIR:-/tmp}/x.XXXXXX"',
        'rsync -avz --delete ./src/ user@host:/srv/app/',
        'systemctl is-active --quiet nginx && echo up || echo down',
        "journalctl -u svc --since '1 hour ago' -n 50",
        'git log --oneline --graph --all | head -20',
        'git diff --stat HEAD~1..HEAD',
        "sed -n '1,10p' file.txt | tr -d '\\r'",
        'paste -d, a.txt b.txt',
        "tr '[:upper:]' '[:lower:]' < in > out",
        "sed -E 's/([0-9]{4})-([0-9]{2})/\\2-\\1/'"
      ]
    },
    {
      id: 'go',
      lines: [
        'if err != nil { return nil, fmt.Errorf("load: %w", err) }',
        'for i, v := range items {',
        'for k := range m { delete(m, k) }',
        'ch := make(chan struct{}, 1)',
        'var wg sync.WaitGroup',
        'go func() { defer wg.Done(); work() }()',
        'type Config struct {',
        'Port int `json:"port" yaml:"port"`',
        'Name string `json:"name,omitempty"`',
        'type Reader interface { Read(p []byte) (int, error) }',
        'func (s *Server) Start(ctx context.Context) error {',
        'p := &User{ID: 1, Tags: []string{"a"}}',
        'v, ok := m[key]; if !ok { return }',
        'defer f.Close()',
        'b, err := json.MarshalIndent(v, "", "  ")',
        'if err := json.Unmarshal(data, &out); err != nil {',
        's := strings.TrimSpace(strings.Join(parts, ","))',
        'n, _ := strconv.Atoi(os.Getenv("PORT"))',
        'select { case <-ctx.Done(): return ctx.Err() }',
        'mu.Lock()',
        'defer mu.Unlock()',
        'errors.Is(err, os.ErrNotExist)',
        'srv := &http.Server{Addr: ":8080", Handler: mux}',
        'x := []int{1, 2, 3}',
        'm := map[string][]int{"a": {1, 2}}',
        'const MaxRetry = 3',
        'var _ io.Reader = (*File)(nil)',
        'func init() { flag.Parse() }',
        'ch <- struct{}{}',
        '<-done',
        'case err := <-errc:',
        't.Cleanup(func() { os.Remove(tmp) })',
        'if got := f(x); got != want {',
        'slices.SortFunc(a, func(x, y int) int { return x - y })',
        'fmt.Printf("%s=%v\\n", key, val)',
        '//go:embed templates/*.html',
        'runtime.GOMAXPROCS(runtime.NumCPU())',
        'n, err := io.Copy(w, r.Body)',
        'ctx, cancel := context.WithTimeout(ctx, 5*time.Second)',
        'defer cancel()'
      ]
    },
    {
      id: 'sql',
      lines: [
        'SELECT a.id, COUNT(*) AS n FROM t a LEFT JOIN u b ON a.id = b.a_id GROUP BY 1;',
        "SELECT * FROM t WHERE a.d LIKE '%x%' AND a.n IS NOT NULL;",
        "INSERT INTO t (a, b, c) VALUES (1, 'x', NOW());",
        "UPDATE t SET a = a + 1, b = 'y' WHERE id = 5;",
        "DELETE FROM t WHERE created_at < NOW() - INTERVAL '30 days';",
        "SELECT COALESCE(SUM(amt), 0) AS total FROM t WHERE st = 'paid';",
        'SELECT id, name FROM t WHERE id IN (SELECT t_id FROM u WHERE n > 0);',
        'SELECT a.*, b.name FROM a INNER JOIN b ON a.b_id = b.id AND b.ok = 1;',
        "SELECT CASE WHEN n > 0 THEN 'up' ELSE 'down' END AS dir FROM t;",
        'SELECT ROW_NUMBER() OVER (PARTITION BY g ORDER BY ts DESC) AS rn FROM t;',
        'WITH cte AS (SELECT 1 AS x) SELECT * FROM cte;',
        "SELECT t.* FROM t WHERE t.ts BETWEEN '2026-01-01' AND '2026-12-31';",
        'ALTER TABLE t ADD COLUMN note VARCHAR(255) NULL;',
        'CREATE INDEX idx_t_a ON t (a, b DESC);',
        "SELECT STRING_AGG(name, ', ' ORDER BY name) FROM t;",
        'SELECT a, COUNT(*) FROM t GROUP BY a HAVING COUNT(*) > 1;',
        'SELECT DISTINCT ON (a) a, b FROM t ORDER BY a, ts DESC;',
        'EXPLAIN ANALYZE SELECT * FROM t WHERE a = 1;',
        '-- comment: reconcile ledger by month',
        '/* block comment: why this calculation */',
        'SELECT COUNT(DISTINCT a_id) FROM t;',
        'SELECT TOP 10 id, name FROM t WHERE flag = 1 ORDER BY id DESC;',
        "IF OBJECT_ID('dbo.t', 'U') IS NOT NULL DROP TABLE dbo.t;",
        'SELECT a.[key], COUNT(*) AS [cnt] FROM [t] AS a GROUP BY a.[key];',
        'SELECT * FROM t WHERE d >= DATEADD(DAY, -7, GETDATE());',
        'SELECT ISNULL(a, 0) + ISNULL(b, 0) AS s FROM t;',
        'UPDATE t SET x = CASE WHEN n > 0 THEN 1 ELSE 0 END WHERE id = 3;',
        "EXEC dbo.sp_name @p1 = 1, @p2 = 'x';",
        'DECLARE @n INT = 0;',
        'SELECT id, RANK() OVER (ORDER BY score DESC) FROM t;',
        'CREATE TABLE t (id INT PRIMARY KEY, name NVARCHAR(50) NOT NULL);',
        'SELECT CONVERT(VARCHAR(10), GETDATE(), 120);',
        /* A second batch with a higher symbol density. SQL keywords are long,
           so statement skeletons alone score poorly — and ( ) ' || :: -> []
           are exactly the keys worth drilling here. */
        'SELECT SUM(CASE WHEN st = \'paid\' THEN amt ELSE 0 END) FROM t;',
        'SELECT a || \'-\' || b AS k, COALESCE(c, \'\') FROM t;',
        'SELECT (a->>\'id\')::int, b[1], c#>>\'{x,y}\' FROM t;',
        'UPDATE t SET j = j || \'{"k":1}\'::jsonb WHERE id = 1;',
        'SELECT COUNT(*) FILTER (WHERE n > 0) FROM t;',
        'DELETE FROM t WHERE d < now() - interval \'7 days\';',
        'SELECT unnest(ARRAY[1, 2, 3]) AS n;',
        'INSERT INTO t (a) VALUES (DEFAULT) RETURNING id;',
        'SELECT ARRAY_AGG(DISTINCT a ORDER BY a) FROM t;',
        'ALTER TABLE t ALTER COLUMN a SET NOT NULL;'
      ]
    }
  ];

  /* ------------------------------------------- derived metrics per pack */

  /* Share of non-space characters that are symbols. This is the metric the
     drill uses to prefer dense lines. */
  function symbolRatio(line) {
    var n = 0, sym = 0;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === ' ' || ch === '\t') continue;
      n++;
      if (Keymap.isSymbol(ch)) sym++;
    }
    return n ? sym / n : 0;
  }

  PACKS.forEach(function (p) {
    defineText(p, 'label', 'pack.' + p.id + '.label');
    defineText(p, 'desc', 'pack.' + p.id + '.desc');

    p.lineMeta = p.lines.map(function (line) {
      return { packId: p.id, text: line, ratio: symbolRatio(line) };
    });

    /* Every symbol character that appears in the pack, for matching against
       the user's weak keys. */
    var seen = Object.create(null);
    var chars = [];
    p.lines.forEach(function (line) {
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (Keymap.isSymbol(ch) && !seen[ch]) { seen[ch] = 1; chars.push(ch); }
      }
    });
    p.symbolChars = chars;
    p.avgRatio = p.lineMeta.length
      ? util.mean(p.lineMeta.map(function (m) { return m.ratio; }))
      : 0;
  });

  var BY_ID = Object.create(null);
  PACKS.forEach(function (p) { BY_ID[p.id] = p; });

  function allMeta() {
    var out = [];
    PACKS.forEach(function (p) { out = out.concat(p.lineMeta); });
    return out;
  }

  /**
   * Generate a code-line drill.
   * opts: {
   *   packIds: string[]      packs to include; empty means all
   *   lines: number
   *   seed: number
   *   density: 'any'|'high'  prefer lines with a high symbol ratio
   *   preferChars: string[]  prefer lines containing these characters (weak keys)
   *   titleSuffix: string
   * }
   */
  function generate(opts) {
    opts = opts || {};
    var ids = (opts.packIds && opts.packIds.length) ? opts.packIds : PACKS.map(function (p) { return p.id; });
    var selected = ids.map(function (id) { return BY_ID[id]; }).filter(Boolean);
    if (!selected.length) selected = PACKS.slice();

    var seed = opts.seed === undefined || opts.seed === null ? util.newSeed() : (opts.seed >>> 0);
    var rng = util.mulberry32(seed);

    var pool = [];
    selected.forEach(function (p) { pool = pool.concat(p.lineMeta); });
    if (!pool.length) {
      return { mode: 'code', seed: seed, packIds: [], lines: [], text: '', title: tr('drill.codeEmpty') };
    }

    var want = Math.min(opts.lines || 4, pool.length);
    var highDensity = opts.density === 'high';
    var prefer = opts.preferChars && opts.preferChars.length ? opts.preferChars : null;

    function hits(m) {
      if (!prefer) return 0;
      var h = 0;
      for (var i = 0; i < prefer.length; i++) if (m.text.indexOf(prefer[i]) !== -1) h++;
      return h;
    }

    function weightOf(m, strong) {
      var w = highDensity ? Math.pow(m.ratio, 1.5) + 0.05 : 1;
      var h = hits(m);
      if (h) w *= (1 + h * (strong ? 4 : 1.2));
      return w;
    }

    var remaining = pool.slice();
    var chosen = [];

    /* Weak keys are a hard guarantee, not a probability: reserve part of the
       budget for lines that actually contain them. Weighted sampling alone is
       not enough — a line containing a weak character can miss the whole round
       because its overall density is slightly lower, and then the code half of
       the drill degenerates into filler. */
    var matchCount = remaining.filter(function (m) { return hits(m) > 0; }).length;
    var reserve = (prefer && matchCount) ? Math.min(matchCount, Math.max(1, Math.ceil(want / 2))) : 0;

    for (var r = 0; r < reserve; r++) {
      var cand = remaining.filter(function (m) { return hits(m) > 0; });
      if (!cand.length) break;
      var w1 = cand.map(function (m) { return weightOf(m, true); });
      var m1 = cand[util.weightedIndex(w1, rng)];
      chosen.push(m1);
      remaining.splice(remaining.indexOf(m1), 1);
    }

    /* Remaining slots are drawn by symbol density, keeping some variety. */
    while (chosen.length < want && remaining.length) {
      var w2 = remaining.map(function (m) { return weightOf(m, false); });
      var i2 = util.weightedIndex(w2, rng);
      chosen.push(remaining[i2]);
      remaining.splice(i2, 1);
    }

    var usedPacks = [];
    chosen.forEach(function (m) { if (usedPacks.indexOf(m.packId) === -1) usedPacks.push(m.packId); });

    var title = tr('drill.code', {
      packs: joinList(usedPacks.map(function (id) { return BY_ID[id].label; }))
    });
    if (opts.titleSuffix) title += ' · ' + opts.titleSuffix;

    return {
      mode: 'code',
      seed: seed,
      packIds: usedPacks,
      lines: chosen.map(function (m) { return m.text; }),
      meta: chosen,
      text: chosen.map(function (m) { return m.text; }).join('\n'),
      title: title
    };
  }

  TD.Snippets = {
    PACKS: PACKS,
    byId: function (id) { return BY_ID[id] || null; },
    allMeta: allMeta,
    symbolRatio: symbolRatio,
    generate: generate
  };
})(window.TD);
