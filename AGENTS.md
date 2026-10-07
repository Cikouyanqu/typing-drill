# AGENTS.md — typing-drill

Guidance for AI coding agents working in this repository.

## What this is

A zero-dependency, offline typing trainer for programming symbols. Plain
HTML/CSS/JS served as static files. No build step, no package manager, no
network access at runtime.

## Hard constraints — read before changing code

- **Classic scripts only, never `type="module"`.** Under `file://` a browser
  refuses to load ES modules (CORS), which would leave a blank page when
  `index.html` is opened by double-click. `index.html`'s script order **is** the
  dependency order; adding a file means updating it.
- **Run the suite after any change:** `node tests/validate.js`. Three
  assertions are load-bearing and will catch most mistakes:
  - every character in the content library must be typeable on a US keyboard
    (CJK comments, full-width punctuation and tabs all break the drill);
  - each keyboard row in `js/keymap.js` must total 15u;
  - both locale dictionaries must carry identical key sets.
- **Escaping in `js/content.snippets.js` is dense** (`\\`, `\'` and backticks
  mixed). After editing it, run `node --check js/content.snippets.js` and then
  the suite — a case spot-checks that these escapes resolve to the intended
  characters.
- **Only one spacing system per container.** `.practice` is a flex column whose
  spacing comes from its own `gap`; adding `margin-top` to a child does not
  collapse with that gap, it adds to it.
- **Clear the container before re-mounting a view.** `Practice.mount()` calls
  `util.clear(container)` for this reason; changing a filter or the mode
  re-mounts within the same view, and without the clear a second complete
  interface stacks on top of the first. Cross-view jumps must go through
  `app.nav(...)`, not `Practice.mount(app.container)`.
- **Keep `tests/test.html`'s script list in sync with `index.html`.** It loads
  the logic modules plus `keyboard.js` (one case needs a DOM). A module missing
  from that list makes the corresponding case throw and fail.
- **The keyboard tester (`js/tester.js`) attaches listeners to `window`**, so
  anything that re-renders a view must tear the previous one down first. A
  language switch that re-rendered without `TD.Views.teardown` left a second
  listener set alive: every keypress was counted twice and ordinary typing was
  reported as chatter. `mount()` also destroys any previous mount defensively,
  and a case covers it — do not remove either.
- **The tester's block widths are fixed pixels on purpose.** Intrinsic sizing
  fights back: grid tracks take a max-content contribution from their items and
  `.tk-board` carries `min-width: max-content`, so an unbreakable label like
  `PGUP` inflated the navigation block from 132px to 459px and the whole board
  overflowed. `NAV_KEYS` / `NUMPAD_KEYS` positions are in key units and are
  scaled by 4 when converted to grid columns.
- **Never commit generated data or machine-specific paths.** Local-only notes
  belong in `.local/`, which is gitignored.
- **Keep `.nojekyll`.** GitHub Pages runs Jekyll by default, and Jekyll treats
  `{{ }}` and `{% %}` in Markdown as Liquid template syntax. This project
  documents JS, JSX and Go template code, so a documentation example containing
  those sequences would break the Pages build with a confusing Liquid error and
  silently stop the site from updating. The empty `.nojekyll` file disables
  Jekyll entirely, which also stops it from generating duplicate HTML pages out
  of the Markdown files.

## Bilingual convention

The interface and documentation are bilingual (English and Chinese); code —
comments, test names, assertion messages — is **English only**.

Two rules make this enforceable rather than aspirational:

- **Resolve translated strings at call time, never at load time.** A module that
  bakes a label into a constant during load will not follow a language switch
  until the page reloads. Where an existing call site reads a property (for
  example `Keymap.FINGERS[id].label`), the label is exposed as a read-time
  accessor instead of a stored string, which keeps every call site working.
- **Never put a translated string or a CJK character outside `js/locales/`.**

The Node runner enforces both: it checks dictionary key parity, verifies that
every key referenced from source exists, and fails if any CJK character appears
outside `js/locales/`. A single line may opt out with an `i18n-check-allow`
marker — used where a test legitimately asserts on a Chinese dictionary value.

Adding a string: add the key to `js/locales/en.js` **and** `js/locales/zh-CN.js`,
then reference it with `tr('key.path')` in the view. Keys are flat dot-notation
namespaces whose prefix identifies the owning area.

## Architecture in one paragraph

`Engine` holds all typing state and is the single source of truth; the DOM is a
projection of it, so switching views and returning loses nothing. `Engine.press()`
takes a duck-typed event and never touches the DOM, which is what lets the suite
feed it synthetic keystrokes. `Stats` is pure aggregation, `Store` is the only
module that touches persistence, `Adaptive` ranks weak keys and builds drills,
and `Views` renders everything. `I18n` is the only path to a user-visible string.

## Environment

Node is needed only to run the tests; the application itself does not use it.
The launcher scripts use Python's `http.server` (port 8777).
