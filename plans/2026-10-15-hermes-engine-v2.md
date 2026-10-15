# Hermes Engine 2.0.0 "Nocturne" — Audit + TUI Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every defect the audit found, then ship Hermes Engine 2.0.0 in the terminal landing page: more commands, easter eggs, adaptive behaviour, and an in-forest release announcement.

**Architecture:** Everything user-facing lives in the single standalone page `docs/terminal/index.html` (inline CSS/JS, hand-edited per AGENTS.md §2). New behaviour is added as `COMMANDS.<name>` entries plus small helpers next to the existing ones; all persisted state goes in `localStorage` behind try/catch, like `owlcotPrefs`. The test harness is the existing headless-Chrome audit `tools/browser_test.mjs`; every new behaviour gets `check(...)` lines there first.

**Tech Stack:** vanilla JS in one HTML file, MkDocs Material, Python 3 tooling, puppeteer-core + the preinstalled Chromium.

**Spec:** The user request (2026-10-15): "thorough audit and verification that the site operates effectively and aesthetically as expected; expand the TUI commands; add easter eggs; add adaptive user experiences; release the new semantic version of the Hermes engine in the TUI dark forest." Audit findings are listed in Task 1.

## Global Constraints

- Follow AGENTS.md. Never hand-edit `docs/terminal/data.js`, `docs/home.md` generated blocks, `docs/entries/002-welcome.md`, `docs/journal-index.md`, or the `Entries:`/`announce:` blocks of `mkdocs.yml` — regenerate with `python3 tools/update_index.py`.
- Engine version: `2.0.0`, codename `nocturne`, release date `2026-10-15`. Previous version: `1.0.0` "darkforest".
- Every animation must respect `reduced()` (prefers-reduced-motion): no timers/intervals spawned, final frame printed immediately.
- All `localStorage` access wrapped in try/catch; the page must work with storage throwing.
- Any user-typed text echoed into HTML goes through `escapeHtml`.
- No new external network resources (no new CDNs/fonts/scripts).
- Zero new console errors in `tools/browser_test.mjs`; mobile (390px) must not overflow horizontally.
- Sandbox has no access to wikimedia/unsplash: image probes fall back to local. Before committing, revert any generated-file hunks that only flip an existing entry's thumbnail remote→local (AGENTS.md §8 "churn").

Environment for every task:
```sh
export PATH=/tmp/claude-0/owlvenv/bin:$PATH        # mkdocs venv
export CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
tools/validate.sh && node tools/browser_test.mjs   # the "CI"
```

## Review Focus

1. Storage blocked (private mode / `localStorage` throws) → page boots, adaptive features silently degrade to first-visit behaviour. Test: Task 4 boots with `localStorage` getters throwing.
2. `data.js` missing (`OWL === null`) → every new command prints a graceful message, no exception. Test: Task 3 runs new commands against a page with `window.OWL_DATA` deleted.
3. Hostile input (`<img src=x onerror=...>` as a command or argument) → rendered as text. Test: Task 1 checks not-found echo; Task 3 checks `grep <b>`.
4. Reduced motion → `sl`, `matrix`, release card print a static final frame. Test: Task 5 runs them under the reduced-motion page.
5. Narrow touch screen → quick-command chips wrap without horizontal overflow. Test: Task 4 mobile check.

---

### Task 1: Audit fixes — Entry #023, stale tests, escaping

**Findings this task closes:**
- A. `docs/entries/023-forgetting-as-mercy.md`: `image_local` file does not exist (validate.sh fails); `image` is a relative path, not an absolute URL; the standard footer line is missing.
- B. Entry #023 was never indexed: nav, announce banner, home, All Entries, journal-index still end at #022.
- C. `tools/browser_test.mjs` hard-codes `018-the-present-tense` as "latest" (stale) and requires a wikimedia og:image (fails offline even though the fallback is correct by design).
- D. `browser_test.mjs` counts `Failed to load resource` console errors for *external* hosts as hard errors (they are already reported by the `requestfailed` soft-warning handler).
- E. `submitCommand` echoes unknown `cmd` into HTML unescaped (`<cmd>: command not found`, and the `did you mean` line).

**Files:**
- Create: `docs/assets/images/entries/023-forgetting-as-mercy.jpg` (procedurally generated with Pillow — dark forest night, a single lit lantern/clearing; ≤ 1280px wide, ≤ 450 KB). Generator script lives in the scratchpad, not the repo.
- Modify: `docs/entries/023-forgetting-as-mercy.md` (frontmatter `image:` → `https://exios66.github.io/owlcot/assets/images/entries/023-forgetting-as-mercy.jpg`; append footer `---\n\n*Written by Hermes Chan · Posted 2026-10-14 · Entry #023*`)
- Modify: `docs/assets/images/entries/CREDITS.txt` (row: original generated artwork, public domain / CC0)
- Regenerate: `docs/home.md`, `docs/entries/002-welcome.md`, `docs/journal-index.md`, `docs/terminal/data.js`, `mkdocs.yml` via `tools/update_index.py`
- Modify: `tools/browser_test.mjs`, `docs/terminal/index.html` (`submitCommand`)

- [ ] Step 1: In `browser_test.mjs`, replace the hard-coded `018-the-present-tense` with the slug of the highest-`num` post read from `window.OWL_DATA.posts`; change the og:image check to pass when the URL is either `upload.wikimedia.org`/`images.unsplash.com` or `https://exios66.github.io/owlcot/assets/images/entries/`; in the console handler skip `Failed to load resource` messages (local failures are still caught by the `response`/`requestfailed` handlers keyed on `BASE`). Add `check('not-found echo is escaped', …)` that runs `<img src=x onerror=window.__xss=1>` and asserts `window.__xss === undefined` and the output contains the literal text `&lt;img` or `<img` as text.
- [ ] Step 2: Run `node tools/browser_test.mjs` — expect only the new escaping check to FAIL.
- [ ] Step 3: Escape `cmd` in both not-found lines of `submitCommand`.
- [ ] Step 4: Generate the image, fix the frontmatter/footer, add CREDITS row, run `python3 tools/update_index.py`.
- [ ] Step 5: `tools/validate.sh` → `✅ All checks passed.`; `node tools/browser_test.mjs` → `0 FAILURES, 0 ERRORS`.
- [ ] Step 6: Revert thumbnail churn hunks (only #023 lines may change in generated files besides intended diffs), re-run both checks, commit `fix: index Entry #023, add its thumbnail, harden the browser audit`.

### Task 2: Hermes Engine 2.0.0 — version source of truth + release in the forest

**Files:** Modify `docs/terminal/index.html`, `tools/browser_test.mjs`

**Interfaces — Produces:**
- `const ENGINE = { name: 'hermes-engine', version: '2.0.0', codename: 'nocturne', date: '2026-10-15' }`
- `const CHANGELOG = [ { version, codename, date, notes: string[] }, … ]` newest first; entries for `2.0.0` (summarise Tasks 2–5) and `1.0.0` "darkforest" (`the terminal landing page, forest/owl/hoot, themes, crt, sound`).
- `function engineString() -> string` → `'hermes-engine 2.0.0 (nocturne)'`
- `function maybeAnnounceRelease() -> boolean` — prints the release card once per version per visitor, persisting `seenEngine` in `localStorage` key `owlcotEngine` (string). Returns true if printed.
- `window.__owl = { ENGINE }` (test handle; later tasks add fields).

- [ ] Step 1: Add checks: `version` output contains `hermes-engine 2.0.0` and `nocturne`; `uname -a` contains `2.0.0`; `uname -r` prints exactly `2.0.0-nocturne`; `neofetch` contains `hermes-engine 2.0.0`; boot output contains `hermes-engine 2.0.0`; fresh visitor boot shows `.release-card`; after reload the card is absent; `changelog` lists `2.0.0` before `1.0.0`; `changelog 1.0.0` shows only that release; `hermes --version` prints `engineString()`.
- [ ] Step 2: Run browser test — new checks FAIL.
- [ ] Step 3: Implement. Replace every hard-coded version (`uname`, neofetch `OS` line, boot line `owlcot shell 1.0.0 — dark forest edition`) with `ENGINE`. Commands: `version` (alias `ver`), `changelog` (alias `releases`, optional version arg), `uname` with flags `-a`/`-r`/none, `hermes` (`--version`, `--help`; otherwise a one-line engine status). Release card: a `<div class="release-card">` with a small ASCII egg-hatching owl, `hermes-engine v2.0.0 "nocturne" has hatched in the dark forest`, top 3 notes, and `type 'changelog' for the full notes`; shown after the MOTD on boot when `seenEngine !== ENGINE.version`, and always via `forest release` (subcommand of `forest`). Style with existing vars (`--amber`, `--cyan`), fade-in skipped under `reduced()`. Add MAN_PAGES for `version`, `changelog`, `hermes`; add to HELP_TEXT.
- [ ] Step 4: Browser test + validate pass.
- [ ] Step 5: Commit `feat(terminal): hermes-engine 2.0.0 "nocturne" — version, changelog, release card`.

### Task 3: New TUI commands

**Files:** Modify `docs/terminal/index.html`, `tools/browser_test.mjs`

**Interfaces — Consumes:** `POSTS`, `POST_NAMES` (ordered oldest→newest), `catPost(p)`, `resolveFile`, `renderMarkdown`, `escapeHtml`. **Produces:** `function postByNum(n) -> post|null`, `function levenshtein(a: string, b: string) -> number`.

| command | behaviour |
|---|---|
| `random` (alias `shuffle`) | `catPost` of a random entry |
| `latest` | same as `read` with no args |
| `first` | `catPost` of entry #000 |
| `next` / `prev` | relative to the last entry `catPost`ed this session (`state.lastRead`); at the ends print `end of the trail — no newer entry` / `this is where it began — no older entry`; with nothing read yet, `next` reads #000 |
| `grep <term>` | case-insensitive full-text search of bodies; prints up to 3 matching lines per entry (term wrapped in `<mark>`, everything else escaped), max 10 entries, then `N matches in M entries`; no hits → `grep: no matches for '<term>'` |
| `head <file> [n]` | first n (default 10) lines of the raw markdown body |
| `wc <file>` | `<lines> <words> <chars> <name>`; without arg totals across entries |
| `stats` | entries, total words, avg read time, first/latest dates, top 5 tags with counts as ASCII bars (`█`) |
| `tags` (alias `topics`) | every topic with entry count, sorted by count desc |
| `fortune` | random sentence (≥ 40 chars, no markdown headings/links) from a random entry body, attributed `— Entry #NNN` |
| `calendar` (alias `cal`) | entries grouped by `YYYY-MM` with counts |
| `reset` | clears `owlcotPrefs`, `owlcotHistory`, `owlcotVisitor`, `owlcotEngine`, then prints `forest reset. reload to start over.` |

Unknown commands: replace the prefix-based "did you mean" with the 3 closest `COMMANDS` keys with `levenshtein ≤ 2` (fallback to the old prefix rule if none). Add all new commands to HELP_TEXT, tab completion (`head`/`wc` complete files like `cat`; `changelog` completes versions), and one-paragraph MAN_PAGES for `grep`, `stats`, `fortune`, `next`.

- [ ] Step 1: Add checks per row above (assert on distinctive output text: e.g. `grep forest` shows a `<mark>`; `grep <b>` renders literal text; `stats` contains `entries` and `█`; `prev` after `read 0` prints `where it began`; `next` after `read <max>` prints `end of the trail`; `tsgs` suggests `tags`). Add a `noData` page section: load `/` with `evaluateOnNewDocument` stubbing `data.js` away (intercept the request and respond 404 is NOT allowed — instead `Object.defineProperty(window,'OWL_DATA',{set(){},get(){return undefined}})`) and assert `random`, `grep x`, `stats`, `fortune`, `next` each print without a pageerror.
- [ ] Step 2: Run — FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Pass browser test + validate.
- [ ] Step 5: Commit `feat(terminal): random/next/prev/grep/head/wc/stats/tags/fortune/calendar/reset + fuzzy suggestions`.

### Task 4: Adaptive experience

**Files:** Modify `docs/terminal/index.html`, `tools/browser_test.mjs`

**Interfaces — Produces:**
- `localStorage['owlcotVisitor'] = { visits: number, lastVisit: string|null /* ISO */, read: string[] /* entry names */ }` loaded into `const visitor` by `loadVisitor()`; `saveVisitor()`; `markRead(name)` called from `catPost`.
- `function daypart(d: Date) -> 'night'|'dawn'|'day'|'dusk'` — night 21:00–04:59, dawn 05:00–07:59, day 08:00–17:59, dusk 18:00–20:59.
- `function newSinceLastVisit() -> post[]` — posts whose `date` > `visitor.lastVisit` date part (empty on first visit).
- `window.__owl` gains `{ visitor, daypart }`.

Behaviours:
1. Greeting line (replaces the fixed `you are here because…` line): first visit → `first time in the forest? type 'read 0' to start at the beginning, or 'latest' for the newest.`; returning → `welcome back. visit #N.` plus, when `newSinceLastVisit()` is non-empty, `K new entries since your last visit — type 'whatsnew'.`
2. Daypart flavour line in the MOTD: night → `the owls are awake. so are you.`; dawn → `the forest is waking up.`; day → `daylight. the owls are sleeping — tread softly.`; dusk → `dusk. the fireflies are clocking in.`
3. Returning visitors (`visits > 1`) get a fast boot: progress bar and `bootLines` delays are skipped (lines still print).
4. `whatsnew`: lists `newSinceLastVisit()` (or `nothing new since your last visit (<date>)`; first visit → `everything is new. start with 'read 0'.`).
5. Read tracking: `ls` in `~/entries` adds class `unread` (a leading `•` via CSS `::before`, amber) to unread entries; `stats` gains a line `you have read R of N entries`. `next` with nothing read this session continues from the highest-numbered read entry (else #000).
6. `prefers-contrast: more` → CRT defaults off (only when the user has no saved `crt` pref).
7. Touch/narrow (`matchMedia('(pointer: coarse)')` or width ≤ 640): after the MOTD print a `.quick-chips` row of buttons `help ls latest random forest whatsnew`; clicking one runs `submitCommand(<cmd>)` and refocuses input. Chips wrap (`flex-wrap`), never overflow.
8. `lastVisit` updated to now at the end of boot; `visits` incremented once per page load.

- [ ] Step 1: Add checks: fresh profile → greeting contains `first time in the forest`; reload → `visit #2`; seeded visitor (`evaluateOnNewDocument` setting `owlcotVisitor` with `lastVisit: '2026-01-01T00:00:00Z'`, `visits: 3`) → `new entries since your last visit` and `whatsnew` lists ≥ 1 entry; `__owl.daypart(new Date(2026,0,1,23))==='night'`, `(…,6)==='dawn'`, `(…,12)==='day'`, `(…,19)==='dusk'`; after `read 0`, `ls entries` (from `~`) shows `000-boss-man.md` without `.unread` and another entry with it; mobile page shows `.quick-chips` and clicking `ls` chip produces a listing; mobile still has no horizontal overflow; storage-blocked page (`evaluateOnNewDocument` redefining `localStorage` getter to throw) boots to the MOTD with no pageerror.
- [ ] Step 2: Run — FAIL. Step 3: Implement. Step 4: Pass + validate.
- [ ] Step 5: Commit `feat(terminal): adaptive greetings, read tracking, whatsnew, fast boot for regulars, touch chips`.

### Task 5: Easter eggs

**Files:** Modify `docs/terminal/index.html`, `tools/browser_test.mjs`

None of these appear in HELP_TEXT (they are eggs) except a single TIPS line: `Some commands are not in this manual. The forest rewards curiosity.` Add `eggs` tracking: each egg found adds its name to `localStorage['owlcotEggs']` (string[]); `eggs` command prints `you have found X of N easter eggs.` (no names).

| trigger | output |
|---|---|
| `xyzzy` | `Nothing happens.` |
| `coffee` / `make coffee` (first word `make`, arg `coffee`) | `HTTP 418 I'm a teapot` + link to `OWL.coffee` if set |
| `42` | `the answer is 42. the question was lost between sessions.` |
| `sl` | an owl (OWL_TINY) flies left→right across one line over ~2 s (CSS transform animation); reduced motion: prints the owl once, static |
| `matrix` | 12 lines of falling green glyphs for ~2.5 s then `wake up, hermes…`; reduced motion: one static frame + the line |
| `git` (any args) | `blame` → `it was the previous session. it always is.`; otherwise `fatal: not a git repository (the forest has no .git, only roots)` |
| `sudo make me a sandwich` | `okay.` (the classic); plain `sudo` keeps its existing message |
| `lumos` / `nox` | toggles a `.lumos` class on `body` that brightens the ambient forest (fireflies opacity/fog); prints `lumos.` / `nox.` |
| `ping owl` | 3 lines `64 bytes from owl: icmp_seq=N ttl=64 time=hoo ms` then `--- owl ping statistics: 3 hoots transmitted, 3 received ---` |
| Konami code (↑↑↓↓←→←→ b a) keyed in the input | golden owl: prints OWL_BIG with class `golden` (gold colour, `#ffd700`) and `you found the golden owl.` |
| `hoot hoot hoot` (hoot with ≥ 2 args all `hoot`) | `the forest hoots back. three times. ominously.` |
| `exit` typed 3 times in a session | third time: `fine. you may leave. (you won't.)` |

- [ ] Step 1: Add checks for every row (Konami via `page.keyboard.press` sequence into `#cmdInput`), plus `eggs` count increases after `xyzzy`, and reduced-motion page: `sl` and `matrix` complete with no pending timers creating new nodes after 300 ms.
- [ ] Step 2: Run — FAIL. Step 3: Implement. Step 4: Pass + validate.
- [ ] Step 5: Commit `feat(terminal): easter eggs (xyzzy, 418, sl, matrix, konami golden owl, lumos, …)`.

### Task 6: Docs + final verification

**Files:** Modify `AGENTS.md` (§2 TTY command list, new §: "Engine versioning" — bump `ENGINE` + prepend `CHANGELOG` for each release; semver rules: new commands = minor, fixes = patch, breaking prefs/storage = major), `docs/about.md` only if it lists commands.

- [ ] Step 1: Update docs.
- [ ] Step 2: `tools/validate.sh` and `node tools/browser_test.mjs` — both clean; desktop + mobile screenshots in `.cache/browser_shots/` reviewed for aesthetics (no overlap, release card legible in all three themes).
- [ ] Step 3: Commit `docs: hermes-engine 2.0.0 operating notes`, push branch, open draft PR.
