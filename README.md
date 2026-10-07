# typing-drill

A typing trainer for **programming symbols**. Zero-dependency static pages: plain HTML/CSS/JS, no build step, no package manager, works offline. Language: **English · [中文](README.zh-CN.md)** <!-- i18n-check-allow: language names are written in their own script -->

![The practice view](docs/screenshot-practice-en.png)

---

## Why this exists

Because I could not be bothered hunting for a site that drills symbols on their own.

### 1. Symbols grouped by which finger has to move

`{ } | \ ; : ' " / ?` all live under the right pinky; `! @ # ` ~` under the left — though feel free to use other fingers, toes included. The 13 practice groups are organised by finger and key layer, and the on-screen keyboard highlights not just the target key but **the whole region that finger owns**.

### 2. Shift mistakes classified separately

The engine reads both `event.key` (the character produced) and `event.code` (the physical key), so it can tell these apart:

| Mistake          | Example                    | Meaning                                                      |
| ---------------- | -------------------------- | ------------------------------------------------------------ |
| Wrong key        | want `{`, typed `]`        | hand position was off                                        |
| Missing Shift    | want `{`, typed `[`        | right key, Shift not held                                    |
| Extra Shift      | want `[`, typed `{`        | right key, Shift held by mistake                             |
| Wrong Shift side | typed `{` with right Shift | correct character, wrong technique — reported, not penalised |
| Caps Lock on     | want `a`, typed `A`        | named explicitly so you do not blame your fingers            |

It also tells you which hand should hold Shift: **always the opposite pinky** (left-hand keys take right Shift and vice versa), and lights that Shift key up on the on-screen keyboard.

### 3. A symbols-only mode

Letters and digits dim out and are skipped automatically, so you only press symbol keys. CPM is then computed over symbols only. Maximum symbol density, no interruption from words.

### 4. Weak-key drills driven by your own mistakes

Per-key error rates and response times are recorded, ranked, and turned into practice:

- **back-and-forth rows** built from your weakest symbols — including the *other layer of the same physical key*, because missing-Shift mistakes can only be trained by contrasting the two layers;
- **real code lines** from the snippet library that actually contain those characters.

The code lines are a guarantee rather than a probability: half the slots in a weak-key drill are reserved for lines containing a weak character, because a purely weighted draw can miss them for a whole round and leave the drill as filler.

---

## Quick start

**Option 1 — open `index.html` directly.** No installation. If your browser blocks local storage on `file://` URLs, a notice appears at the top of the page and practice records last only for that page view; you can export a JSON backup at any time from *Settings → Data*.

**Option 2 — run the local server.** `start.cmd` on Windows, `./start.sh` on macOS/Linux. This serves the page from `http://127.0.0.1:8777/` so it has a normal origin and practice records persist. Close the window (or press Ctrl+C) to stop.

> Both work; the difference is just **whether records are saved**. Use option 2 if you want to keep your data.

## How to practise

1. Open the **Practice** view and leave the mode on *Symbol drills*. All 13 groups are selected by default; use *Filters…* to narrow it down (starting with **Right pinky region** is a good idea).
2. Click the practice area and start typing. The target key is highlighted in the accent colour; the rest of its finger region is light blue.
3. When you press the wrong key, the status row explains what went wrong and which finger should have been used. The cursor does not advance; just type the character correctly.
4. Finishing a set shows a result card: CPM, accuracy, an error breakdown, and the characters you confuse most.
5. After a few rounds, open **Weak keys** — it names your weakest keys and builds drills around them.
6. **Stats** has the per-key table, per-finger error rates, a per-key heatmap, and a speed/accuracy trend.

## Modes

| Mode              | Content                                                                                                               | Use it for                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Symbol drills** | 13 groups, multi-select, adjustable symbols per line                                                                  | Everyday practice; also for attacking one finger region |
| **Code lines**    | 214 hand-written real statements across five language families (JS/TS including JSON and JSX, Python, Shell, Go, SQL) | Practising symbols in meaningful context                |
| **Weak keys**     | Generated from your own per-key data                                                                                  | Most valuable after a few rounds                        |
| **Custom**        | Paste code you have at hand, or import a `.txt`/`.js`/`.py`/`.sql` file                                               | Practising your own codebase's style                    |

## Stats

- **CPM** — characters per minute. Symbols favour character counts over word counts, so CPM is the primary figure; WPM is derived as CPM ÷ 5.
- **First-try accuracy** — the share of characters you got right on the first press. More telling than overall accuracy.
- **Raw accuracy** — correct presses ÷ all presses. Retyping after Backspace counts in both, so it can never exceed 100%.
- **Median response time** — the median rather than the mean, because one distraction is enough to drag an average far off.
- **Idle handling** — gaps over 2 seconds are excluded from response-time samples, and gaps over 5 seconds are excluded from the clock. Both thresholds are at the top of `js/engine.js`.
- **Weakness score** — 70% error rate + 30% slowness, scaled by sample confidence. A key you have never got wrong and that is not slow is *not* a weakness: practised is not the same as weak.

## Keyboard test

A separate diagnostic view, for checking whether a keyboard actually works: press
anything and the board lights up.

![Keyboard test](docs/screenshot-keytest.png)

- **Full 104-key layout**, with a layout switch for full / TKL 87 / 60%, so keys
  your keyboard does not have are not counted as permanently untested.
- **Four states per key**: held, pressed (covered), never, and flagged — and each
  key shows how many times it was pressed.
- **Coverage**, **APM** (real-time triggers per minute), **total presses**, the
  **maximum held at once** (rollover), and **Caps / Num / Scroll indicators**.
- **Chatter detection** — the failure a mechanical keyboard most often develops:
  a key re-firing without releasing, or re-triggering within 30ms of releasing.
  The operating system's own key repeat is excluded, so holding a key down is
  never mistaken for a fault.
- **Character mismatch** — compares what each physical key produces against the
  US layout, which catches a wrong firmware remap or a keyboard set to another
  layout. On a non-US layout entries here are expected rather than a fault.
- Reset, an optional key click, and a plain statement of what a browser cannot
  test: the Win and Menu keys are intercepted by the operating system, so those
  two can be marked by hand.

Results survive leaving the view and coming back; *Reset* is the way to clear
them.

## Data and privacy

- Practice records live only in **this computer's browser local storage**, under the key `typing-drill/v1`.
- The tool **makes no network requests at all**: fonts come from the system font stack, there is no CDN, no analytics, no telemetry. It works fully offline.
- A corrupt save is copied to `typing-drill/v1.corrupt` before a fresh state starts; user data is never silently destroyed.
- Export and import are plain JSON. Merging is supported, and importing the same file twice is detected and skipped.

## Project layout

```
typing-drill/
├── index.html              entry point; script order IS the dependency order
├── start.cmd / start.sh    optional local static server launchers
├── css/tokens.css          design tokens — the single source of values
├── css/app.css             layout and components, tokens only
├── js/i18n.js              translation runtime
├── js/locales/             zh-CN.js and en.js dictionaries
├── js/util.js              helpers + seedable RNG
├── js/keymap.js            US QWERTY key map, finger mapping, mistake classification
├── js/content.symbols.js   13 symbol groups and drill generation
├── js/content.snippets.js  the code-line library
├── js/engine.js            typing engine: verdicts, mistake kinds, timing
├── js/stats.js             aggregation: per-key, per-finger, heat buckets, trend
├── js/store.js             persistence: probe and degrade, import/export
├── js/adaptive.js          weakness ranking and drill generation
├── js/keyboard.js          on-screen keyboard: finger guidance and heatmap
├── js/tester.js            keyboard test: state machine, 104-key layout, view
├── js/charts.js            hand-written SVG trend chart
├── js/ui.js                theme, icons, toasts, modal
├── js/views.js             the six views
├── js/main.js              boot and shell
├── docs/I18N.md            how the bilingual setup works, reusable elsewhere
└── tests/                  cases.js, validate.js (Node), test.html (browser)
```

## Tests

```bash
node tests/validate.js
```

Covers key-map completeness, the typeability of every character in the content library, engine mistake classification, statistics definitions (with hand-computed fixtures), storage degradation and import de-duplication, adaptive scoring monotonicity, keyboard-test state handling (chatter rules, key repeat, rollover, layout composition), and the translation layer. Currently **82 cases / 760 assertions, all passing** (three DOM-only cases are skipped under Node).

Open `tests/test.html` in a browser to run the same cases; anything the browser cannot support is reported as *skipped* rather than as a failure.

The Node runner also performs static checks:

- both dictionaries carry exactly the same keys, so a half-translated release fails the suite;
- every dictionary key referenced from source exists;
- **no CJK character appears anywhere outside `js/locales/`**. A line can opt out with an explicit `i18n-check-allow` marker.

## Extending it

**Add code lines** — edit the `lines` array of a pack in `js/content.snippets.js`. Re-run the suite afterwards: an assertion requires every character in the library to be typeable on a US keyboard, so CJK comments, full-width punctuation and tabs are all rejected.

**Add a symbol group** — edit `GROUPS` in `js/content.symbols.js`. The character set, the fingers involved and the Shift ratio are derived automatically. Tokens may be multi-character (`->`, `===`).

**Use a different keyboard layout** — replace `ROWS` and the finger assignments in `js/keymap.js`. Everything else (mistake classification, finger guidance, heatmap, statistics) reads from that one table.

**Tune the pacing** — theme, text size, line count, symbols-only and strict mode are in *Settings*. The remaining defaults are in `DEFAULT_SETTINGS` in `js/store.js`.

## Known limitations

- **US QWERTY only.** Other layouts place symbols differently, so the finger guidance would be wrong (`ROWS` is replaceable).
- **Only printable ASCII typeable on a US keyboard.** CJK, full-width punctuation and tabs cannot be drilled — they need an input method editor or special keys and would stall the drill. The library view checks pasted content and the test suite enforces it.
- **Shift-side detection requires you to actually press Shift.** When Caps Lock is used for uppercase, which side was pressed cannot be determined.
- **The on-screen keyboard needs about 660px**; narrower windows scroll horizontally.
- **Whether `file://` allows local storage depends on the browser.** Only the served path has been verified in this repository's development; when opened directly, the page detects a blocked local store, says so, and offers an export.

## License

[MIT](LICENSE)
