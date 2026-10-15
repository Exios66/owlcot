// Focused unit tests for the terminal commands and visitor features.
// Run: node --test tools/terminal_test.mjs
// No site build, browser, network, or third-party packages are required.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { Script, createContext, runInContext } from 'node:vm';

const html = readFileSync(new URL('../docs/terminal/index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 1, 'expected one inline terminal script');
assert.match(scripts[0][1], /\nboot\(\);\s*$/);
// Evaluate the actual terminal, leaving boot under each test's control.
const terminal = new Script(scripts[0][1].replace(/\nboot\(\);\s*$/, '\n'), {
  filename: 'docs/terminal/index.html',
});

function entry(num, overrides = {}) {
  return {
    num, slug: `${String(num).padStart(3, '0')}-trail`, title: `Trail ${num}`,
    date: '2026-08-07', tags: [], readtime: 2, description: 'A breadcrumb.',
    url: `https://example.test/entries/${num}.html`, body: 'A quiet trail.',
    ...overrides,
  };
}

// Gaps in entry numbers catch navigation that incorrectly assumes num + 1.
function samplePosts() {
  return [
    entry(0, { tags: ['memory', 'identity'], body: 'Forest forest.\nA quiet lantern glows.\n' }),
    entry(2, { date: '2026-09-01', tags: ['memory', 'quiet'], readtime: 4,
      body: 'A second trail.\nMEMORY is a map.' }),
    entry(7, { date: '2026-10-15', tags: ['identity', 'quiet'], readtime: 6,
      body: 'Night returns & <b>forest</b>.\nThe forest keeps its promise.' }),
  ];
}

// Only DOM operations used by these units are represented. HTML is recorded,
// not parsed; layout, browser event semantics and XSS execution belong to the
// existing browser audit. Commands, rendering and persistence stay real.
function element(tag = 'div') {
  const listeners = new Map();
  return {
    tagName: tag.toUpperCase(), children: [], className: '', innerHTML: '', textContent: '',
    style: { setProperty(name, value) { this[name] = value; } },
    classList: { toggle() {} },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    click() { listeners.get('click')?.(); },
    focus() { this.focused = true; },
  };
}

function shell({ posts = samplePosts(), stored = {}, blocked = false, failedWrites = false,
  reducedMotion = true, contrast = false, coarse = false, width = 1280,
  random = 0.5, noData = false, storage = new Map(Object.entries(stored)) } = {}) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const writes = [];
  const removed = [];
  const delays = [];
  const errors = [];
  const localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) {
      if (failedWrites) throw new Error('quota exceeded');
      writes.push(key);
      storage.set(key, String(value));
    },
    removeItem(key) {
      if (failedWrites) throw new Error('storage unavailable');
      removed.push(key);
      storage.delete(key);
    },
  };
  const math = Object.create(Math);
  math.random = () => random;
  const context = createContext({
    document: {
      getElementById: node, querySelector: node, createElement: element,
      documentElement: element('html'), body: element('body'),
    },
    location: { pathname: '/' },
    console: { error: (...args) => errors.push(args) },
    Math: math,
    // Resolve animation waits immediately; record the requested delays so boot
    // timing policy can be checked without real timers or a ticking clock.
    setTimeout(callback, ms) { delays.push(ms); queueMicrotask(callback); return delays.length; },
    setInterval() { return 0; },
    clearInterval() {},
    clearTimeout() {},
    innerWidth: width,
    matchMedia(query) {
      return { matches: new Map([
        ['(prefers-reduced-motion: reduce)', reducedMotion],
        ['(prefers-contrast: more)', contrast],
        ['(pointer: coarse)', coarse],
      ]).get(query) ?? false };
    },
    OWL_DATA: noData ? undefined : {
      posts, topics: [...new Set(posts.flatMap(p => p.tags))],
      intro: '# A journal', about: '', contact: '', plan: '',
    },
  });
  context.window = context;
  Object.defineProperty(context, 'localStorage', {
    get() { if (blocked) throw new Error('storage blocked'); return localStorage; },
  });
  terminal.runInContext(context, { timeout: 1000 });
  const api = runInContext(`({ COMMANDS, state, visitor, daypart, postByNum, levenshtein,
    markLine, wcCounts, fortuneSentences, getCandidates, newSinceLastVisit,
    markRead, maybeAnnounceRelease, printReleaseCard, wantsChips,
    printQuickChips, submitCommand, boot, ENGINE, CHANGELOG })`, context);
  return {
    api, node, storage, writes, removed, delays, errors,
    get lines() { return node('output').children; },
    get html() { return this.lines.map(e => e.innerHTML).join('\n'); },
    clear() { node('output').children.length = 0; },
    run(command, args = []) {
      this.clear();
      api.COMMANDS[command](args);
      assert.equal(errors.length, 0, 'command should not log an internal error');
      return this.html;
    },
  };
}

const plain = value => JSON.parse(JSON.stringify(value));
const name = num => `${String(num).padStart(3, '0')}-trail.md`;

describe('entry navigation and read tracking', () => {
  test('postByNum accepts integer entry numbers and rejects missing or non-integer numbers', () => {
    const { postByNum } = shell().api;
    assert.equal(postByNum('002').name, name(2));
    assert.equal(postByNum(0).name, name(0));
    for (const number of [-1, 1, 2.5, 'nope', Infinity, NaN]) {
      assert.equal(postByNum(number), null);
    }
  });

  test('first, next and prev traverse entries with gaps, stopping at both ends', () => {
    const s = shell();
    assert.match(s.run('prev'), /no older entry/);
    s.run('next');
    assert.equal(s.api.state.lastRead, name(0));
    s.run('next');
    assert.equal(s.api.state.lastRead, name(2));
    s.run('prev');
    assert.equal(s.api.state.lastRead, name(0));
    assert.match(s.run('prev'), /no older entry/);
    s.run('latest');
    assert.equal(s.api.state.lastRead, name(7));
    assert.match(s.run('next'), /no newer entry/);
    assert.equal(s.api.state.lastRead, name(7));
  });

  test('first falls back to the oldest entry when entry zero is absent', () => {
    const s = shell({ posts: samplePosts().slice(1) });
    s.run('first');
    assert.equal(s.api.state.lastRead, name(2));
  });

  for (const [random, expected] of [[0, 0], [0.999999, 7]]) {
    test(`random selects the ${expected === 0 ? 'first' : 'last'} entry at the RNG boundary`, () => {
      const s = shell({ random });
      s.run('random');
      assert.equal(s.api.state.lastRead, name(expected));
      assert.equal(s.api.COMMANDS.shuffle, s.api.COMMANDS.random);
    });
  }

  test('next resumes from the highest valid read entry, ignoring stale names', () => {
    const s = shell({ stored: { owlcotVisitor: JSON.stringify({
      visits: 3, read: [name(2), 'deleted.md', name(0)],
    }) } });
    s.run('next');
    assert.equal(s.api.state.lastRead, name(7));
    s.run('first');
    s.run('next');
    assert.equal(s.api.state.lastRead, name(2), 'current session takes precedence over saved history');
  });

  test('next starts at the beginning if saved history contains only deleted entries', () => {
    const s = shell({ stored: { owlcotVisitor: JSON.stringify({ read: ['deleted.md'] }) } });
    s.run('next');
    assert.equal(s.api.state.lastRead, name(0));
  });

  test('a saved read of the latest entry stops next without re-reading it', () => {
    const s = shell({ stored: { owlcotVisitor: JSON.stringify({ read: [name(7)] }) } });
    assert.match(s.run('next'), /no newer entry/);
    assert.equal(s.api.state.lastRead, null);
    assert.equal(s.writes.length, 0);
  });

  test('reading through cat and navigation persists each entry exactly once', () => {
    const s = shell();
    s.run('cat', [`entries/${name(0)}`]);
    s.run('first');
    assert.deepEqual(plain(s.api.visitor.read), [name(0)]);
    assert.equal(s.writes.filter(k => k === 'owlcotVisitor').length, 1);
    s.run('next');
    assert.deepEqual(JSON.parse(s.storage.get('owlcotVisitor')).read, [name(0), name(2)]);
  });

  test('listings mark only unread entries, including filtered topic listings', () => {
    const s = shell();
    assert.match(s.run('ls', ['entries']), /class="file md unread">000-trail.md/);
    s.run('first');
    const listing = s.run('ls', ['entries']);
    assert.match(listing, /class="file md">000-trail.md/);
    assert.match(listing, /class="file md unread">002-trail.md/);
    assert.doesNotMatch(s.run('ls'), /unread/);
    s.run('cd', ['topics/memory']);
    const topic = s.run('ls');
    assert.match(topic, /class="file md">000-trail.md/);
    assert.match(topic, /class="file md unread">002-trail.md/);
    assert.doesNotMatch(topic, /007-trail.md/);
  });
});

describe('full-text grep', () => {
  test('matches bodies case-insensitively, counts occurrences, and escapes surrounding HTML', () => {
    const result = shell().run('grep', ['FOREST']);
    assert.match(result, /<mark>Forest<\/mark> <mark>forest<\/mark>/);
    assert.match(result, /&amp; &lt;b&gt;<mark>forest<\/mark>&lt;\/b&gt;/);
    assert.match(result, /4 matches in 2 entries/);
    assert.doesNotMatch(result, /<b>/);
  });

  test('joins multiple arguments and searches bodies rather than title or tags', () => {
    const s = shell({ posts: [entry(0, { title: 'titleonly', tags: ['tagonly'], body: 'A quiet lantern.' })] });
    assert.match(s.run('grep', ['quiet', 'lantern']), /<mark>quiet lantern<\/mark>/);
    assert.match(s.run('grep', ['titleonly']), /no matches/);
    assert.match(s.run('grep', ['tagonly']), /no matches/);
  });

  for (const term of ['.*+?^${}()|[]\\', '<img/src=x/onerror=alert(1)>', '&']) {
    test(`treats ${JSON.stringify(term)} as literal text`, () => {
      const s = shell({ posts: [entry(0, { body: `before ${term} after` })] });
      const result = s.run('grep', [term]);
      assert.match(result, /1 matches in 1 entries/);
      assert.doesNotMatch(result, /<img/);
      assert.equal((result.match(/<mark>/g) || []).length, 1);
    });
  }

  test('limits output to three matching lines and ten entries while counting all hits', () => {
    const posts = Array.from({ length: 12 }, (_, i) => entry(i, { body: 'hit hit\nhit\nhit\nhit' }));
    const result = shell({ posts }).run('grep', ['hit']);
    assert.equal((result.match(/class="file md"/g) || []).length, 10);
    assert.equal((result.match(/<mark>/g) || []).length, 40);
    assert.match(result, /and 2 more entries/);
    assert.match(result, /60 matches in 12 entries/);
  });

  test('centers a long snippet on the hit and preserves its highlight', () => {
    const body = `${'x'.repeat(150)}Needle${'y'.repeat(150)}`;
    const s = shell({ posts: [entry(0, { body })] });
    s.run('grep', ['needle']);
    const snippet = s.lines[1].innerHTML;
    assert.match(snippet, /…x{40}<mark>Needle<\/mark>y+…/);
    assert.ok(snippet.length < 150);
  });

  test('reports missing terms and safely echoes an unmatched HTML term', () => {
    const s = shell();
    assert.match(s.run('grep'), /usage: grep <term>/);
    assert.match(s.run('grep', ['<script>']), /no matches for '&lt;script&gt;'/);
  });

  test('highlighting resets reused regex state and handles zero-width matches', () => {
    const { markLine } = shell().api;
    const re = /owl/gi;
    re.lastIndex = 100;
    assert.equal(markLine('<owl> & OWL', re), '&lt;<mark>owl</mark>&gt; &amp; <mark>OWL</mark>');
    assert.equal(markLine('owl', re), '<mark>owl</mark>');
    assert.equal(markLine('<&>', /(?:)/g), '&lt;&amp;&gt;');
  });
});

describe('head and wc', () => {
  test('head defaults to ten raw lines, supports zero, and escapes markdown HTML', () => {
    const body = Array.from({ length: 12 }, (_, i) => `<b>line ${i}</b>`).join('\n');
    const s = shell({ posts: [entry(0, { body })] });
    const result = s.run('head', [name(0)]);
    assert.match(result, /&lt;b&gt;line 9&lt;\/b&gt;/);
    assert.doesNotMatch(result, /line 10|<b>/);
    const twoLines = s.run('head', [name(0), '2']);
    assert.equal(twoLines, '<div style="white-space:pre-wrap">&lt;b&gt;line 0&lt;/b&gt;\n&lt;b&gt;line 1&lt;/b&gt;</div>');
    assert.equal(s.run('head', [name(0), '0']), '<div style="white-space:pre-wrap"></div>');
    assert.match(s.run('head', [name(0), '20']), /line 11/);
    assert.equal(s.api.visitor.read.length, 0, 'a preview does not mark the entry read');
  });

  for (const count of ['-1', 'nope']) {
    test(`head rejects invalid line count ${count}`, () => {
      assert.match(shell().run('head', [name(0), count]), /invalid number of lines/);
    });
  }

  test('head and wc report missing files with escaped filenames', () => {
    const s = shell();
    assert.match(s.run('head'), /usage: head/);
    for (const command of ['head', 'wc']) {
      const result = s.run(command, ['<missing>']);
      assert.match(result, /&lt;missing&gt;: No such file or directory/);
      assert.doesNotMatch(result, /<missing>/);
    }
  });

  test('wc handles empty text, whitespace, trailing newlines, and Unicode', () => {
    const { wcCounts } = shell().api;
    assert.deepEqual(plain(wcCounts('')), { l: 1, w: 0, c: 0 });
    assert.deepEqual(plain(wcCounts(' \t\n')), { l: 2, w: 0, c: 3 });
    assert.deepEqual(plain(wcCounts('owl\nforest\n')), { l: 3, w: 2, c: 11 });
    assert.deepEqual(plain(wcCounts('café owl')), { l: 1, w: 2, c: 8 });
  });

  test('wc prints exact file counts and corpus totals', () => {
    const s = shell({ posts: [entry(0, { body: 'one two\nthree' }), entry(2, { body: 'four\nfive six' })] });
    assert.match(s.run('wc', [name(0)]), /^\s*2\s+3\s+13 000-trail.md$/);
    assert.match(s.run('wc'), /^\s*4\s+6\s+26 total$/);
    assert.equal(s.api.visitor.read.length, 0);
  });
});

describe('journal statistics and topics', () => {
  test('stats reports exact aggregates, date range, and valid read count', () => {
    const s = shell({ posts: [
      entry(0, { date: '2026-10-15', body: 'one two\nthree', readtime: 2 }),
      entry(2, { date: '2026-08-07', body: 'four\nfive six', readtime: 4 }),
    ], stored: { owlcotVisitor: JSON.stringify({ read: [name(0), 'deleted.md'] }) } });
    const result = s.run('stats');
    assert.match(result, /entries<\/span>\s+2/);
    assert.match(result, /total words<\/span>\s+6/);
    assert.match(result, /avg read time<\/span>\s+3\.0 min/);
    assert.match(result, /first entry<\/span>\s+2026-08-07/);
    assert.match(result, /latest entry<\/span>\s+2026-10-15/);
    assert.match(result, /you have read 1 of 2 entries/);
  });

  test('tags sort by frequency with alphabetical ties and escape tag text', () => {
    const s = shell({ posts: [
      entry(0, { tags: ['zebra', 'alpha', '<tag>'] }), entry(2, { tags: ['zebra', 'alpha'] }),
      entry(7, { tags: ['zebra'] }),
    ] });
    assert.match(s.run('tags'), /3  zebra\n\s*2  alpha\n\s*1  &lt;tag&gt;/);
    assert.equal(s.api.COMMANDS.topics, s.api.COMMANDS.tags);
    const tied = shell().run('tags');
    assert.ok(tied.indexOf('identity') < tied.indexOf('memory'));
    assert.ok(tied.indexOf('memory') < tied.indexOf('quiet'));
  });

  test('stats displays only the five most frequent tags and scales their bars', () => {
    const s = shell({ posts: [
      entry(0, { tags: ['a', 'b', 'c', 'd', 'e', 'f'] }), entry(2, { tags: ['a'] }),
    ] });
    s.run('stats');
    const rows = s.html.split('\n').filter(line => line.includes('class="green"'));
    assert.equal(rows.length, 5);
    assert.match(rows[0], /a\s+<span class="green">█{20}<\/span> 2/);
    assert.match(rows[1], /b\s+<span class="green">█{10}<\/span> 1/);
    assert.doesNotMatch(rows.join('\n'), /  f /);
  });

  test('empty tags and missing dates remain usable', () => {
    const s = shell({ posts: [entry(0, { tags: [], date: null, readtime: null, body: '' })] });
    assert.match(s.run('tags'), /no topics yet/);
    const stats = s.run('stats');
    assert.match(stats, /avg read time<\/span>\s+1\.0 min/);
    assert.match(stats, /first entry<\/span>\s+\?/);
    assert.match(stats, /latest entry<\/span>\s+\?/);
    assert.doesNotThrow(() => s.run('calendar'));
  });

  test('calendar groups and orders months, ignores missing dates, and scales bars', () => {
    const s = shell({ posts: [
      entry(0, { date: '2026-10-15' }), entry(2, { date: '2026-08-01' }),
      entry(7, { date: '2026-10-01' }), entry(8, { date: null }),
    ] });
    assert.match(s.run('calendar'), /2026-08\s+1\s+<span class="green">█{10}<\/span>\n2026-10\s+2\s+<span class="green">█{20}<\/span>/);
    assert.equal(s.api.COMMANDS.cal, s.api.COMMANDS.calendar);
  });
});

describe('fortune selection', () => {
  const sentence = 'The quiet forest keeps a lantern burning for the next visitor.';

  test('excludes code, headings, quotes, tables, images, and linked sentences', () => {
    const body = [
      `# ${sentence}`, `> ${sentence}`, `| ${sentence} |`, `<p>${sentence}</p>`,
      `![${sentence}](image.jpg)`, '```js', sentence, '```',
      `[${sentence}](https://example.test)`, sentence,
    ].join('\n');
    assert.deepEqual(plain(shell().api.fortuneSentences(body)), [sentence]);
  });

  test('sentence lengths include 40 and 240 characters and exclude their neighbors', () => {
    const candidates = [39, 40, 240, 241].map(n => `${'a'.repeat(n - 1)}.`);
    assert.deepEqual(plain(shell().api.fortuneSentences(candidates.join('\n'))), candidates.slice(1, 3));
  });

  test('strips list markers and emphasis from eligible prose', () => {
    const body = `- ${sentence}\n1. ${sentence}\n**${sentence.slice(0, -1)}**.`;
    assert.deepEqual(plain(shell().api.fortuneSentences(body)), [sentence, sentence, sentence]);
  });

  test('skips entries without prose and attributes the selected sentence', () => {
    const s = shell({ posts: [entry(0, { body: '# No prose.' }), entry(7, { body: sentence })] });
    assert.match(s.run('fortune'), new RegExp(sentence.replace(/\./g, '\\.')));
    assert.match(s.html, /— Entry #007/);
    assert.equal(s.api.visitor.read.length, 0);
  });

  test('reports when no entry contains eligible prose', () => {
    assert.match(shell({ posts: [entry(0, { body: 'Too short.' })] }).run('fortune'), /no fortune today/);
  });

  test('fortune escapes ampersands in selected prose', () => {
    const s = shell({ posts: [entry(7, {
      body: 'The forest keeps a lantern glowing & waits for the next visitor.',
    })] });
    assert.match(s.run('fortune'), /glowing &amp; waits/);
    assert.match(s.html, /— Entry #007/);
  });
});

describe('visitor persistence and adaptive behavior', () => {
  for (const [hour, expected] of [[0, 'night'], [4, 'night'], [5, 'dawn'], [7, 'dawn'],
    [8, 'day'], [17, 'day'], [18, 'dusk'], [20, 'dusk'], [21, 'night'], [23, 'night']]) {
    test(`daypart at ${hour}:00 is ${expected}`, () => {
      assert.equal(shell().api.daypart(new Date(2026, 0, 1, hour)), expected);
    });
  }

  for (const raw of ['{broken', 'null', '42', JSON.stringify({ visits: '3', lastVisit: 7, read: 'bad' })]) {
    test(`malformed visitor data ${raw} falls back to a first visit`, () => {
      const s = shell({ stored: { owlcotVisitor: raw } });
      assert.deepEqual(plain(s.api.visitor), { visits: 1, lastVisit: null, read: [] });
    });
  }

  test('loads valid visitor fields, filters non-string read names, and increments once', () => {
    const s = shell({ stored: { owlcotVisitor: JSON.stringify({
      visits: 4, lastVisit: '2026-09-01T23:59:59Z', read: [name(0), 2, null],
    }) } });
    assert.deepEqual(plain(s.api.visitor), {
      visits: 5, lastVisit: '2026-09-01T23:59:59Z', read: [name(0)],
    });
    s.api.markRead(null);
    assert.equal(s.writes.length, 0);
  });

  test('whatsnew uses the previous date exclusively, even after lastVisit changes', () => {
    const s = shell({ stored: { owlcotVisitor: JSON.stringify({
      visits: 1, lastVisit: '2026-09-01T23:59:59Z', read: [name(7)],
    }) } });
    s.api.visitor.lastVisit = '2099-01-01T00:00:00Z';
    assert.deepEqual(Array.from(s.api.newSinceLastVisit(), p => p.name), [name(7)]);
    const result = s.run('whatsnew');
    assert.match(result, /1 new since 2026-09-01/);
    assert.match(result, /class="file md">007-trail.md/);
    assert.doesNotMatch(result, /unread|002-trail.md/);
  });

  test('whatsnew marks fresh unread posts and handles first and up-to-date visits', () => {
    assert.match(shell().run('whatsnew'), /everything is new/);
    const returning = shell({ stored: { owlcotVisitor: JSON.stringify({ lastVisit: '2026-09-01' }) } });
    assert.match(returning.run('whatsnew'), /class="file md unread">007-trail.md/);
    const current = shell({ stored: { owlcotVisitor: JSON.stringify({ lastVisit: '2026-10-15' }) } });
    assert.match(current.run('whatsnew'), /nothing new since your last visit \(2026-10-15\)/);
  });

  for (const options of [{ blocked: true }, { failedWrites: true }]) {
    test(`read tracking and announcements survive ${options.blocked ? 'blocked storage' : 'failed writes'}`, () => {
      const s = shell(options);
      s.run('first');
      s.run('first');
      assert.deepEqual(plain(s.api.visitor.read), [name(0)]);
      assert.equal(s.api.maybeAnnounceRelease(), true);
      assert.match(s.run('reset'), /forest reset/);
      assert.deepEqual(s.errors, []);
    });
  }

  for (const [prefs, expected] of [[{}, false], [{ crt: true }, true], [{ crt: false }, false]]) {
    test(`high contrast respects saved CRT preference ${JSON.stringify(prefs)}`, () => {
      const s = shell({ contrast: true, stored: { owlcotPrefs: JSON.stringify(prefs) } });
      assert.equal(s.api.state.crt, expected);
    });
  }

  test('CRT stays enabled by default without high contrast', () => {
    assert.equal(shell().api.state.crt, true);
  });

  test('reset removes every owned key while preserving unrelated storage', () => {
    const stored = { owlcotPrefs: '{}', owlcotHistory: '[]', owlcotVisitor: '{}',
      owlcotEngine: '1.0.0', unrelated: 'keep' };
    const s = shell({ stored });
    assert.match(s.run('reset'), /forest reset. reload to start over/);
    assert.deepEqual(s.removed, ['owlcotPrefs', 'owlcotHistory', 'owlcotVisitor', 'owlcotEngine']);
    assert.deepEqual([...s.storage], [['unrelated', 'keep']]);
  });

  for (const [width, coarse, expected] of [[640, false, true], [641, false, false], [1280, true, true]]) {
    test(`quick chips eligibility at width ${width} with coarse pointer ${coarse}`, () => {
      assert.equal(shell({ width, coarse }).api.wantsChips(), expected);
    });
  }

  test('quick chips dispatch a real command and return focus to input', () => {
    const s = shell();
    s.api.printQuickChips();
    const row = s.lines[0];
    assert.equal(row.className, 'line quick-chips');
    assert.deepEqual(row.children.map(b => b.textContent), ['help', 'ls', 'latest', 'random', 'forest', 'whatsnew']);
    assert.ok(row.children.every(b => b.tagName === 'BUTTON' && b.type === 'button'));
    row.children.find(b => b.textContent === 'latest').click();
    assert.equal(s.api.state.lastRead, name(7));
    assert.equal(s.node('cmdInput').focused, true);
    assert.deepEqual(JSON.parse(s.storage.get('owlcotHistory')), ['latest']);
  });

  test('boot greets a new visitor, persists reads, and uses that history after reload', async () => {
    const first = shell();
    await first.api.boot();
    assert.match(first.html, /first time in the forest/);
    first.run('first');
    const second = shell({ storage: first.storage });
    await second.api.boot();
    assert.match(second.html, /welcome back. visit #2/);
    assert.doesNotMatch(second.html, /class="release-card/);
    second.run('next');
    assert.equal(second.api.state.lastRead, name(2));
    const saved = JSON.parse(second.storage.get('owlcotVisitor'));
    assert.equal(saved.visits, 2);
    assert.ok(Number.isFinite(Date.parse(saved.lastVisit)));
    assert.deepEqual(saved.read, [name(0), name(2)]);
  });

  test('returning boot skips progress and boot-line delays while still printing them', async () => {
    const first = shell({ reducedMotion: false });
    await first.api.boot();
    assert.ok(first.delays.includes(40));
    assert.ok(first.delays.includes(150));
    assert.ok(first.delays.includes(55));
    const returning = shell({ reducedMotion: false, stored: { owlcotVisitor: JSON.stringify({
      visits: 3, lastVisit: '2026-08-07T12:00:00Z',
    }) } });
    await returning.api.boot();
    assert.ok(!returning.delays.some(ms => [40, 150, 55].includes(ms)));
    assert.match(returning.html, /100%/);
    assert.match(returning.html, /mounting/);
    assert.match(returning.html, /welcome back. visit #4/);
    assert.match(returning.html, /2 new entries since your last visit/);
  });

  test('blocked storage still boots, greets, and accepts commands', async () => {
    const s = shell({ blocked: true, width: 640 });
    await s.api.boot();
    assert.match(s.html, /a journal that behaves like a terminal/);
    assert.match(s.html, /first time in the forest/);
    assert.ok(s.lines.some(line => line.className === 'line quick-chips'));
    assert.match(s.run('whatsnew'), /everything is new/);
    s.run('next');
    assert.equal(s.api.state.lastRead, name(0));
    assert.deepEqual(s.errors, []);
  });
});

describe('engine versions and release announcements', () => {
  test('version aliases and system information agree on the engine release', () => {
    const s = shell();
    assert.match(s.run('version'), /hermes-engine 2\.0\.0 \(nocturne\)/);
    assert.match(s.html, /hatched 2026-10-15/);
    assert.equal(s.api.COMMANDS.ver, s.api.COMMANDS.version);
    assert.equal(s.run('uname', ['-r']), '2.0.0-nocturne');
    assert.match(s.run('uname', ['-a']), /Owlcot 2\.0\.0-nocturne/);
    assert.match(s.run('neofetch'), /hermes-engine 2\.0\.0 \(nocturne\)/);
    assert.match(s.run('hermes'), /3 entries · 3 topics/);
    for (const flag of ['--version', '-v']) {
      assert.equal(s.run('hermes', [flag]), 'hermes-engine 2.0.0 (nocturne)');
    }
  });

  test('changelog lists releases newest first and accepts v-prefixed versions', () => {
    const s = shell();
    const all = s.run('changelog');
    assert.ok(all.indexOf('2.0.0') < all.indexOf('1.0.0'));
    for (const version of ['1.0.0', 'v1.0.0', 'V1.0.0']) {
      const result = s.run('changelog', [version]);
      assert.match(result, /darkforest/);
      assert.doesNotMatch(result, /nocturne|2\.0\.0/);
    }
    assert.equal(s.api.COMMANDS.releases, s.api.COMMANDS.changelog);
    assert.match(s.run('changelog', ['<bad>']), /no such release '&lt;bad&gt;'/);
    assert.match(s.html, /known releases: 2\.0\.0, 1\.0\.0/);
  });

  test('announces once per version, including an upgrade from an older release', () => {
    const s = shell({ stored: { owlcotEngine: '1.0.0' } });
    assert.equal(s.api.maybeAnnounceRelease(), true);
    assert.equal(s.storage.get('owlcotEngine'), '2.0.0');
    assert.equal(s.api.maybeAnnounceRelease(), false);
    assert.equal(s.lines.length, 1);
    assert.match(s.html, /hermes-engine v2\.0\.0/);
    assert.match(s.html, /type 'changelog' for the full notes/);
    assert.equal(s.writes.filter(k => k === 'owlcotEngine').length, 1);
  });

  test('an already seen release is silent but forest release can show it again', async () => {
    const s = shell({ stored: { owlcotEngine: '2.0.0' } });
    assert.equal(s.api.maybeAnnounceRelease(), false);
    assert.equal(s.lines.length, 0);
    await s.api.COMMANDS.forest(['release']);
    assert.match(s.html, /class="release-card"/);
    assert.equal(s.api.state.forest, true);
    assert.equal(s.writes.length, 0);
  });

  for (const reducedMotion of [true, false]) {
    test(`release card animation respects reduced motion ${reducedMotion}`, () => {
      const s = shell({ reducedMotion });
      s.api.printReleaseCard();
      assert.match(s.html, reducedMotion ? /class="release-card"/ : /class="release-card fade"/);
      assert.equal(s.delays.length, 0);
      assert.equal(s.api.CHANGELOG[0].version, s.api.ENGINE.version);
      assert.doesNotMatch(s.html, /easter eggs, buried in the roots/, 'card only includes the first three notes');
    });
  }
});

describe('new completion and fuzzy suggestions', () => {
  test('head and wc complete entry files in root and topic directories', () => {
    const s = shell();
    for (const command of ['head', 'wc']) {
      assert.ok(s.api.getCandidates('', false, command).includes(`entries/${name(0)}`));
    }
    s.run('cd', ['topics/memory']);
    assert.deepEqual(plain(s.api.getCandidates('', false, 'head')), [name(0), name(2)]);
    assert.deepEqual(plain(s.api.getCandidates('', false, 'wc')), [name(0), name(2)]);
  });

  test('new engine arguments and commands are offered for completion', () => {
    const s = shell();
    for (const command of ['changelog', 'releases']) {
      assert.deepEqual(plain(s.api.getCandidates('', false, command)), ['2.0.0', '1.0.0']);
    }
    assert.deepEqual(plain(s.api.getCandidates('', false, 'hermes')), ['--version', '--help']);
    assert.deepEqual(plain(s.api.getCandidates('', false, 'forest')), ['on', 'off', 'release']);
    const commands = s.api.getCandidates('', true, '');
    for (const command of ['head', 'wc', 'random', 'next', 'prev', 'stats', 'whatsnew', 'version', 'reset']) {
      assert.ok(commands.includes(command), command);
    }
  });

  for (const [a, b, distance] of [['', '', 0], ['', 'owl', 3], ['owl', '', 3],
    ['owl', 'owl', 0], ['cat', 'cart', 1], ['head', 'hed', 1], ['tsgs', 'tags', 1], ['owl', 'forest', 5]]) {
    test(`edit distance for ${JSON.stringify(a)} and ${JSON.stringify(b)}`, () => {
      const { levenshtein } = shell().api;
      assert.equal(levenshtein(a, b), distance);
      assert.equal(levenshtein(b, a), distance);
    });
  }

  test('unknown command suggestions are bounded and identify a one-letter typo', () => {
    const s = shell();
    s.api.submitCommand('tsgs');
    assert.match(s.html, /tsgs: command not found/);
    const suggestion = s.lines.find(line => line.innerHTML.includes('did you mean'))?.innerHTML;
    assert.match(suggestion, /`tags`/);
    assert.ok((suggestion.match(/`[^`]+`/g) || []).length <= 3);
    s.clear();
    s.api.submitCommand('zzzzzzzzzzzz');
    assert.doesNotMatch(s.html, /did you mean/);
  });

  test('unknown command and history preserve hostile text without raw HTML output', () => {
    const s = shell();
    const input = '<img/src=x/onerror=alert(1)>';
    s.api.submitCommand(input);
    assert.doesNotMatch(s.html, /<img/);
    assert.match(s.html, /&lt;img\/src=x\/onerror=alert\(1\)&gt;: command not found/);
    assert.deepEqual(JSON.parse(s.storage.get('owlcotHistory')), [input]);
    assert.deepEqual(s.errors, []);
  });
});

describe('missing or empty entry database', () => {
  for (const options of [{ noData: true }, { posts: [] }]) {
    for (const [command, args] of [['random', []], ['shuffle', []], ['latest', []], ['first', []],
      ['next', []], ['prev', []], ['grep', ['forest']], ['stats', []], ['tags', []],
      ['topics', []], ['calendar', []], ['cal', []], ['fortune', []], ['wc', []], ['whatsnew', []]]) {
      test(`${command} reports missing entries with ${options.noData ? 'no OWL_DATA' : 'an empty posts array'}`, () => {
        const s = shell(options);
        assert.match(s.run(command, args), /no entries mounted/);
        assert.equal(s.api.state.lastRead, null);
      });
    }
  }
});
