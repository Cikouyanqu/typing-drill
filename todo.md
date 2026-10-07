# todo — typing-drill

## Changelog (completed work)

### 2026-10-07 — keyboard test view

A new diagnostic view, sixth in the sidebar, for checking whether a keyboard
actually works.

- **Full 104-key layout** decomposed into four blocks (fn 16 / main 61 / nav 10 /
  numpad 17) with a layout switch for full / TKL 87 / 60%. The main block reuses
  `Keymap.ROWS`, so the tester and the drill cannot disagree about key positions.
  Coverage is measured against the selected variant, otherwise keys the keyboard
  does not have would count as permanently untested.
- **Four key states** (held / pressed / never / flagged), per-key press counts,
  and a legend.
- **Readouts**: coverage, APM, total presses, maximum held at once (rollover),
  and Caps / Num / Scroll indicators.
- **Chatter detection**, the failure a mechanical keyboard most often develops:
  re-triggering without releasing, or within 30ms of releasing. The OS key repeat
  is excluded, so holding a key is never flagged.
- **Character mismatch detection** against the US layout, which catches a wrong
  firmware remap or another layout; the caveat is stated in the interface.
- Reset, optional synthesised key click, and an honest note about what a browser
  cannot test (Win and Menu are intercepted by the OS and can be marked by hand).
- `js/tester.js` holds a pure, clock-injectable state machine so all of the above
  is covered by the Node run; 13 new cases, plus one that drives the view through
  the DOM.

**Bugs found while building it**

| Problem | Symptom | Fix |
|---|---|---|
| A re-render without teardown left two listener sets alive | every keypress counted twice, and ordinary typing reported as chatter | tear down before re-rendering on a language switch; `mount()` also destroys any previous mount |
| Grid intrinsic sizing inflated the blocks | the navigation block rendered 459px instead of 132px and the board overflowed to 1875px | fixed block widths, and positions in key units scaled to grid columns |
| Multi-character legends overflowed their keys | `PGUP`, `ENTER`, `PRTSC` were clipped | long legends take the smaller named-label style |
| APM exploded at the start of a session | a burst in the opening milliseconds divided by an almost-zero window and read 267273 | one-second floor on the divisor |
| Test results were lost on leaving the view | checking the statistics page discarded a half-finished test | the state object outlives the view; Reset is the explicit way to clear it |

### 2026-09-30 — bilingual release, published

**Internationalisation**

- `js/i18n.js`: translation runtime with `{name}` interpolation, `{one, other}`
  plural forms, language detection from the browser, persistence, and
  `data-i18n` DOM application.
- `js/locales/en.js` and `js/locales/zh-CN.js`: 402 keys each, verified equal.
- All interface strings in 11 modules externalised (286 references verified by a
  static check). Practice *content* — symbol tokens and code lines — is shared,
  since code is code; only labels, descriptions and messages are translated.
- Language switch in *Settings → Appearance* and in the top bar; follows the
  browser by default and remembers the choice.
- Late binding throughout: finger labels and character names are read-time
  accessors, so existing call sites needed no change and nothing goes stale
  after a switch.

**Code and tests in English**

- Comments, section headers and user-facing diagnostics across 13 JS files, 2
  CSS files and the test suite translated to English. Code logic unchanged; the
  suite's assertion count was used to confirm nothing was lost.
- Test suite renamed and reworded: 66 cases, 593 assertions.

**Guard rails added**

- Dictionary key parity, so a half-translated release fails the suite.
- Every dictionary key referenced from source must exist.
- No CJK character anywhere outside `js/locales/` — one rule covering both
  untranslated strings and untranslated comments, with an explicit
  `i18n-check-allow` opt-out for the two lines that legitimately assert on a
  Chinese dictionary value.
- A dedicated case enumerating every dynamically composed key family (keys built
  by string concatenation, which the static scan cannot see). This one caught a
  real bug: four statistics sub-labels were missing, so the raw key names were
  being rendered into the interface in both languages.

**Repository**

- English `README.md` plus `README.zh-CN.md`, cross-linked, with a screenshot.
- `AGENTS.md` (public) and `.local/AGENTS.local.md` (gitignored private notes).
- MIT `LICENSE`, `.gitignore`, `start.sh` for macOS/Linux alongside `start.cmd`.
- `docs/I18N.md` documenting the bilingual approach for reuse in future projects.

**Delivered earlier the same day**

- Zero-dependency static page skeleton, classic-script dependency chain (ES
  modules are blocked under `file://`).
- Design token layer measured from a flat "tool" style spec; light and dark
  themes; no component hardcodes a colour.
- Key map: 61 physical keys, 95 typeable characters, finger ownership and
  Shift-side derivation.
- Typing engine with five mistake kinds, Backspace and strict mode, seedable
  timing, idle exclusion.
- 13 symbol groups organised by finger and key layer.
- 214 hand-written real code lines across five language families. Measured
  average symbol density: Shell 35.8%, JS/TS 34.5%, Python 31.1%, Go 27.1%,
  SQL 18.2%.
- Weak-key ranking (70% error rate + 30% slowness, scaled by confidence) and
  drill generation with a hard guarantee that weak characters appear in the
  code half.
- Five views; on-screen keyboard with finger guidance and per-key heatmap;
  hand-written SVG trend chart; per-key sortable table; per-finger error bars.
- Storage probe with graceful degradation to memory; corrupt saves set aside;
  import merging with duplicate and partial-overlap detection.

## Issues found by testing, and how they were fixed

Kept as a reference for future work; the generalisable ones are also in the
project memory.

| Problem | Symptom | Fix |
|---|---|---|
| Backspace double-counted first-try credit | first-try accuracy could exceed 100% | track a `counted` flag per character and retract it on Backspace |
| `reset()` cleared event subscriptions | `finish`/`update` never fired after loading a new set | initialise subscriptions in the constructor only |
| Shift side read from the wrong source | `event.location` is always 0 on character events, so the check never fired | track Shift keydowns separately in the engine |
| CJK comments in the content library | the drill stalled on characters a US keyboard cannot produce | replaced with ASCII; an assertion now guards it |
| Import de-duplication was inconsistent | sessions were deduplicated but per-key statistics were not, so re-importing doubled them | skip the entire merge when an import contains no new session; flag partial overlap |
| Non-weak keys listed as weaknesses | keys with a 0% error rate and one attempt appeared in the ranking | keep only keys that were mistyped or noticeably slow; mark small samples |
| Tiny samples outranked solid evidence | `1 attempt, 1 error` (100%) came first, ahead of `40 attempts, 6 errors` (15%) | lowered the confidence floor to 0.1 and raised the saturation point to 40 |
| Keyboard flashes accumulated | a single timer meant earlier flashes were never cleared, so fast typing left a trail of highlights | one flash at a time; a new flash clears the previous immediately |
| Idle time counted towards CPM | leaving mid-drill destroyed the speed reading | gaps over 5s are excluded from the clock; the timer freezes |
| The interface rendered twice | `mount()` never cleared its container, so changing a filter or mode stacked a second copy | `mount()` clears first; cross-view jumps go through `app.nav` |
| Spacing counted twice | a flex `gap` and a child `margin-top` added up (28px instead of 12px) | one spacing system per container |
| The keyboard fell below the fold | group chips took two rows and status information took two rows | filters collapse by default; target cue and feedback share a line |
| Internal IDs leaked into the interface | the confusion hint said "L5 side" | translated finger names |
| Four statistics sub-labels missing | raw key names were rendered in both languages | made the sub-label optional per metric, plus a new case covering every dynamic key family |

## Possible next steps

- [ ] Try it and confirm the practice approach itself works
- [ ] Optional: add more code lines, or more SQL dialects
- [ ] Optional: Colemak / Dvorak support (replace `ROWS` in `js/keymap.js`)
- [ ] Optional: GitHub Pages, so visitors can try it without cloning
