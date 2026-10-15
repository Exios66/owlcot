import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
import fs from 'fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SITE = new URL('../site/', import.meta.url).pathname;
const PORT = Number(process.env.TEST_PORT || 8940);
const BASE = `http://localhost:${PORT}`;
const SHOTS = new URL('../.cache/browser_shots/', import.meta.url).pathname;
fs.mkdirSync(SHOTS, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', SITE]);
let serverLog = '';
server.stderr.on('data', d => serverLog += d.toString());
await new Promise(r => setTimeout(r, 900));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--mute-audio', '--force-device-scale-factor=1'],
});

const errors = [];
const warns = [];
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function newPage(w = 1280, h = 900) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h });
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  page.on('console', m => {
    const t = m.type();
    // External-host load failures are already reported by the requestfailed soft-warning handler.
    if (t === 'error') { if (!m.text().startsWith('Failed to load resource')) errors.push(`[console.error] ${m.text()}`); }
    else if (t === 'warning') warns.push(`[console.warn] ${m.text()}`);
  });
  page.on('response', r => {
    if (r.status() >= 400) {
      const entry = `[http ${r.status()}] ${r.url()}`;
      if (r.url().startsWith(BASE)) errors.push(entry); else warns.push(entry);
    }
  });
  page.on('requestfailed', r => {
    const msg = `[requestfailed] ${r.url()} ${r.failure()?.errorText || ''}`;
    if (r.url().startsWith(BASE)) errors.push(msg); else warns.push(msg);
  });
  return page;
}

// ---------- PAGE 1: the terminal ----------
const page = await newPage();
await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 });
await sleep(3200); // boot animations

await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });

check('boot: OWL_DATA loaded', await page.evaluate(() => !!window.OWL_DATA && Array.isArray(window.OWL_DATA.posts)));
check('boot: title card + banner rendered', await page.evaluate(() => !!document.querySelector('.banner') && !!document.querySelector('.title-card .owl-art')));
check('boot: motd printed', await page.evaluate(() => !!document.querySelector('.motd')));
check('boot: ambient treeline built', await page.evaluate(() => !!document.querySelector('#treelineFront path') && !!document.querySelector('#treelineBack path')));
{
  const n = await page.evaluate(() => document.querySelectorAll('#ambientFireflies .firefly').length);
  check('boot: ambient fireflies spawned', n >= 6, `count=${n}`);
}
{
  const c1 = await page.$eval('#statusTime', e => e.textContent);
  await sleep(1500);
  check('status clock ticks', (await page.$eval('#statusTime', e => e.textContent)) !== c1);
}
{
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('deep-black background applied', bg === 'rgb(5, 7, 9)', bg);
}

// --- terminal <-> blog connection ---
{
  const href = await page.$eval('#statusBlog', e => e.getAttribute('href'));
  check('blog link in status bar', href === 'home.html', href);
  const r = await page.evaluate(async h => (await fetch(h)).status, href);
  check('blog link target resolves', r === 200, `fetch=${r}`);
  const visible = await page.evaluate(() => {
    const el = document.getElementById('statusBlog');
    const s = getComputedStyle(el.closest('.status-item'));
    return s.display !== 'none' && el.getBoundingClientRect().width > 10;
  });
  check('blog link visible on desktop', visible);
}
const outText = () => page.$eval('#output', e => e.innerText);
const outHas = async s => (await outText()).includes(s);
const run = async (cmd, settle = 500) => {
  await page.focus('#cmdInput');
  await page.keyboard.type(cmd, { delay: 6 });
  await page.keyboard.press('Enter');
  await sleep(settle);
};
const clearInput = async () => page.evaluate(() => {
  const i = document.getElementById('cmdInput');
  i.value = '';
  i.dispatchEvent(new Event('input', { bubbles: true }));
});

check('boot: motd advertises the blog', await outHas('classic blog') && await outHas('web'));
check('boot: engine line shows hermes-engine 2.0.0', await outHas('hermes-engine 2.0.0'));
check('boot: fresh visitor sees release card', await page.evaluate(() => !!document.querySelector('.release-card')));
check('boot: owl handle exposes ENGINE', await page.evaluate(() => !!window.__owl && window.__owl.ENGINE.version === '2.0.0'));
check('boot: tip line mentions blog ↗', await outHas('blog ↗ in the status bar'));

// input display mirrors typing + ghost
await page.keyboard.type('hoo');
check('typing mirrors into display', (await page.$eval('#typedText', e => e.textContent)) === 'hoo');
await clearInput();
await page.keyboard.type('th');
check('ghost suggestion appears', (await page.$eval('#ghostText', e => e.textContent)) === 'eme', JSON.stringify(await page.$eval('#ghostText', e => e.textContent)));
await clearInput();

await run('help', 300);
{
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) { ok = await outHas('SYNOPSIS') && await outHas('REPORTING BUGS'); if (!ok) await sleep(250); }
  check('help: man page typed out', ok);
}
check('help: mentions blog alias', await outHas('web | blog'));
await run('ls');
check('ls ~: entries/topics/README', await outHas('entries') && await outHas('topics') && await outHas('README.md'));
await run('cat entries/000-boss-man.md', 700);
check('cat: header + title + body', await outHas('entries/000-boss-man.md') && await outHas('#000 — Who Watches the Owl?') && await outHas('Amnesiac Gremlin'));
check('cat: full-page link present', await page.evaluate(() => !!document.querySelector('.post-footer a[href*="000-boss-man"]')));
await run('cat .plan', 500);
check('plan: blockquote rendered', await page.evaluate(() => !!document.querySelector('.post blockquote')));

// tab completion end-to-end
await page.focus('#cmdInput');
await clearInput();
await page.keyboard.type('cat entr', { delay: 5 });
await page.keyboard.press('Tab');
{
  const v = await page.$eval('#cmdInput', e => e.value);
  check('tab: completes to common prefix', v === 'cat entries/', `value="${v}"`);
}
await page.keyboard.press('Tab');
check('tab: ambiguous list shown', await outHas('entries/000-boss-man.md'));
await clearInput();
await page.keyboard.press('ArrowUp');
{
  const v = await page.$eval('#cmdInput', e => e.value);
  check('history: ArrowUp recalls last command', v === 'cat .plan', `value="${v}"`);
}
await clearInput();

// navigation
await run('cd topics/memory');
check('cd topic: prompt updates', (await page.$eval('#statusPath', e => e.textContent)) === '~/topics/memory');
await run('ls');
check('topic ls: filtered entries', await outHas('000-boss-man.md'));
await run('cat 000-boss-man.md', 600);
check('cat from topic dir resolves by basename', await outHas('#000 — Who Watches the Owl?'));
await run('cd ../identity');
check('cd ../<tag> normalized', (await page.$eval('#statusPath', e => e.textContent)) === '~/topics/identity');
await run('cd ../..');
check('cd ../.. returns home', (await page.$eval('#statusPath', e => e.textContent)) === '~');
await run('cd entries');
await run('pwd', 300);
check('pwd after cd entries', await outHas('/home/hermes/entries'));
await run('cd');

// blog command
await run('blog', 400);
check('blog command: links printed', await outHas('journal index') && await outHas('rss feed'));
check('blog command: status-bar tip', await outHas('blog ↗ in the status bar'));

// search / read / open
await run('search tokens');
check('search finds hits', await outHas('011-i-dreamed-in-tokens.md'));
await run('search zzznothing');
check('search miss message', await outHas('keeps its secrets'));
await run('read 3', 600);
check('read 3 opens entry #003', await outHas('entries/003-ship-of-theseus.md'));
await run('open latest', 600);
const latestSlug = await page.$eval('body', () => {
  const posts = window.OWL_DATA.posts;
  return posts.reduce((a, b) => (b.num > a.num ? b : a)).slug;
});
check('open latest opens newest URL', await page.$eval('body', (_b, s) => window.__opened.some(u => u.includes(s)), latestSlug), latestSlug);

// not-found echo must be escaped (no spaces: submitCommand splits on whitespace)
const xssCmd = '<img/src=x/onerror=window.__xss=1>';
await run(xssCmd, 600);
const xssSafe = await page.$eval('body', () => window.__xss === undefined && !document.querySelector('#output img'));
check('not-found echo is escaped', xssSafe && await outHas(xssCmd + ': command not found'));

// visual scene commands
await run('forest', 900);
check('forest: scene rendered', await page.evaluate(() => !!document.querySelector('.forest-scene pre')));
{
  const n = await page.evaluate(() => document.querySelectorAll('.forest-scene .firefly').length);
  check('forest: fireflies inside scene', n >= 5, `count=${n}`);
}
check('forest: lore typed', await outHas('breadcrumbs'));
await run('owl', 1200);
check('owl: big owl art + eyes', await page.evaluate(() => { const el = [...document.querySelectorAll('.owl-art')].pop(); return el && el.textContent.includes('(O,O)'); }));
await run('hoot', 800);
check('hoot: tiny owl', await outHas('hoo'));
await run('neofetch', 400);
check('neofetch: info block', await outHas('/bin/hoot') && await outHas('Entries'));
await run('tree', 400);
check('tree: filesystem drawing', await outHas('└── .contact'));

// settings
await run('theme green', 400);
check('theme green applies', (await page.$eval('#statusTheme', e => e.textContent)) === 'green');
check('theme: CSS var switched', (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--amber').trim())) === '#a3e635');
await run('theme amber', 400);
check('theme amber restores', (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--amber').trim())) === '#ffb86c');
await run('crt off', 300);
check('crt off hides overlay', (await page.$eval('#crtOverlay', e => e.style.opacity)) === '0');
await run('crt on', 300);
await run('sound on', 300);
check('sound toggles on', (await page.$eval('#statusSound', e => e.textContent)) === 'on');
await run('forest off', 300);
check('forest off hides ambient', await page.evaluate(() => document.getElementById('ambientForest').classList.contains('off')));
await run('forest on', 300);
await run('sound off', 300);

// mail compose flow
await run('mail reader@example.com', 300);
await run('hello from the audit', 200);
await run('nice owl you have there', 200);
await run('.', 900);
check('mail: summary printed', await outHas('message ready'));
check('mail: mailto opened', await page.evaluate(() => window.__opened.some(u => u.startsWith('mailto:reader@example.com'))));
check('mail: prompt restored', await page.evaluate(() => !document.getElementById('promptText').textContent.includes('mail(')));

// easter eggs + errors
await run('sudo');
check('sudo easter egg', await outHas('sudoers'));
await run('rm -rf /');
check('rm -rf easter egg', await outHas('refusing'));
await run('zzznotacommand');
check('unknown command: not found + hint', await outHas('command not found') && await outHas("type 'help'"));
await run('echo hoo && echo nope', 300);
check('echo prints args', await outHas('hoo && echo nope'));
await run('uname');
check('uname', await outHas('GNU/Hoot'));
await run('history', 400);
check('history numbered', await outHas('help'));

// Ctrl+L / Ctrl+C
await page.focus('#cmdInput');
await page.keyboard.type('partial command');
await page.keyboard.down('Control'); await page.keyboard.press('c'); await page.keyboard.up('Control');
check('Ctrl+C cancels line', await outHas('^C') && (await page.$eval('#cmdInput', e => e.value)) === '');
const lineCountBefore = await page.evaluate(() => document.querySelectorAll('#output .line').length);
await page.keyboard.down('Control'); await page.keyboard.press('l'); await page.keyboard.up('Control');
await sleep(300);
check('Ctrl+L clears screen', (await page.evaluate(() => document.querySelectorAll('#output .line').length)) < lineCountBefore);
await run('motd', 400);
check('motd reprints', await outHas('a journal that behaves like a terminal'));

// ---- hermes-engine 2.0.0 ----
const lastOut = async () => (await outText());
await run('clear', 200);
await run('version', 300);
check('version: engine string + codename', await outHas('hermes-engine 2.0.0') && await outHas('nocturne'));
await run('clear', 200); await run('ver', 300);
check('ver alias', await outHas('hermes-engine 2.0.0'));
await run('clear', 200); await run('uname -a', 300);
check('uname -a has 2.0.0', await outHas('2.0.0') && await outHas('GNU/Hoot'));
await run('clear', 200); await run('uname -r', 300);
check('uname -r exact', (await lastOut()).split('\n').some(l => l.trim() === '2.0.0-nocturne'));
await run('clear', 200); await run('neofetch', 300);
check('neofetch shows hermes-engine 2.0.0', await outHas('hermes-engine 2.0.0'));
await run('clear', 200); await run('changelog', 300);
{
  const t = await lastOut();
  check('changelog: 2.0.0 before 1.0.0', t.includes('2.0.0') && t.includes('1.0.0') && t.indexOf('2.0.0') < t.indexOf('1.0.0'));
}
await run('clear', 200); await run('changelog 1.0.0', 300);
{
  const t = await lastOut();
  check('changelog 1.0.0 only', t.includes('1.0.0') && t.includes('darkforest') && !t.includes('nocturne'));
}
await run('clear', 200); await run('changelog 9.9.9', 300);
check('changelog unknown version', await outHas('no such release'));
await run('clear', 200); await run('hermes --version', 300);
check('hermes --version', await outHas('hermes-engine 2.0.0 (nocturne)'));
await run('clear', 200); await run('hermes', 300);
check('hermes status line', await outHas('hermes-engine') && await outHas('entries'));

// ---- Task 3: new TUI commands ----
const C = async (cmd, settle = 400) => { await run('clear', 150); await run(cmd, settle); return outText(); };
{
  const maxNum = await page.evaluate(() => Math.max(...window.OWL_DATA.posts.map(p => p.num)));
  const total = await page.evaluate(() => window.OWL_DATA.posts.length);
  let t;
  await C('hermes --help', 1500);
  check('hermes --help prints MAN_PAGES.hermes', await outHas('the engine under the shell') && await outHas('HERMES(1)'));
  t = await C('random', 700);
  check('random: reads an entry', t.includes('open full page') || t.includes('#0'));
  t = await C('shuffle', 700);
  check('shuffle alias', t.includes('open full page'));
  t = await C('latest', 700);
  check('latest: reads newest', t.includes('#' + String(maxNum).padStart(3, '0') + ' —'));
  t = await C('first', 700);
  check('first: reads #000', t.includes('#000 —'));
  t = await C('prev', 500);
  check('prev at first: where it began', t.includes('this is where it began'));
  t = await C('next', 700);
  check('next from #000 goes to #001', t.includes('#001 —'));
  t = await C('prev', 700);
  check('prev goes back to #000', t.includes('#000 —'));
  await run('read ' + maxNum, 700);
  t = await C('next', 500);
  check('next at newest: end of the trail', t.includes('end of the trail'));
  t = await C('grep forest', 500);
  check('grep: <mark> hit + summary', await page.$$eval('#output mark', n => n.length) > 0 && /\d+ matches? in \d+ entr/.test(t));
  t = await C('grep <img', 500);
  check('grep <img: echoed literally, nothing injected', t.includes('<img') && !(await page.$('#output img[src], #output img:not([class])')) );
  t = await C('grep zzqxqzz', 400);
  check("grep: no matches message", t.includes("grep: no matches for 'zzqxqzz'"));
  t = await C('grep', 300);
  check('grep: usage', t.includes('usage: grep'));
  t = await C('head 000-boss-man.md 3', 400);
  check('head: 3 lines', t.split('\n').filter(l => l.trim()).length <= 4 && t.includes('night'));
  t = await C('wc 000-boss-man.md', 400);
  check('wc file: lines words chars name', /\d+\s+\d+\s+\d+\s+000-boss-man\.md/.test(t));
  t = await C('wc', 400);
  check('wc total', /\d+\s+\d+\s+\d+\s+total/.test(t));
  t = await C('stats', 500);
  check('stats: entries + bars', t.includes('entries') && t.includes('█') && t.includes('read time'));
  t = await C('tags', 400);
  check('tags: counts', /\d+\s+\S+/.test(t) && t.includes('memory'));
  t = await C('topics', 400);
  check('topics alias', t.includes('memory'));
  t = await C('fortune', 400);
  check('fortune: attribution', /— Entry #\d{3}/.test(t));
  t = await C('calendar', 400);
  check('calendar: YYYY-MM groups', /20\d\d-\d\d\s/.test(t));
  t = await C('cal', 400);
  check('cal alias', /20\d\d-\d\d\s/.test(t));
  t = await C('tsgs', 400);
  check('unknown cmd: tsgs suggests tags', t.includes('command not found') && t.includes('`tags`'));
  t = await C('hermes', 300);
  const tabv = await (async () => { await clearInput(); await page.keyboard.type('hermes --v'); await page.keyboard.press('Tab'); return page.$eval('#cmdInput', e => e.value); })();
  check('tab: hermes --version', tabv === 'hermes --version', tabv);
  await clearInput();
  await page.keyboard.type('head 000'); await page.keyboard.press('Tab');
  check('tab: head completes files', (await page.$eval('#cmdInput', e => e.value)).startsWith('head 000'));
  await clearInput();
  t = await C('help', 2500);
  for (let i = 0; i < 20 && !t.includes('REPORTING BUGS'); i++) { await sleep(250); t = await outText(); }
  check('help lists new commands', ['random','grep','stats','fortune','calendar','reset','next'].every(w => t.includes(w)));
  t = await C('man grep', 1500);
  check('man grep', t.includes('GREP(1)'));
  await C('man fortune', 1500); check('man fortune', await outHas('FORTUNE(1)'));
  await C('man stats', 1500); check('man stats', await outHas('STATS(1)'));
  await C('man next', 1500); check('man next', await outHas('NEXT(1)'));
  // reset last (clears prefs/visitor/engine keys)
  await page.evaluate(() => { localStorage.setItem('owlcotVisitor', 'x'); });
  t = await C('reset', 400);
  check('reset: message', t.includes('forest reset. reload to start over.'));
  check('reset: keys cleared', await page.evaluate(() => ['owlcotPrefs','owlcotHistory','owlcotVisitor','owlcotEngine'].every(k => localStorage.getItem(k) === null)));
  await C('clear', 100);
}
await run('clear', 200); await run('forest release', 600);
check('forest release prints card', await page.evaluate(() => !!document.querySelector('.release-card')) && await outHas("type 'changelog' for the full notes"));
await run('clear', 200); await run('man changelog', 300);
check('man changelog', await outHas('CHANGELOG(1)'));

await page.screenshot({ path: SHOTS + '/desktop-terminal.png' });

// ---------- PAGE 2: redirect stub ----------
const p2 = await newPage();
await p2.goto(BASE + '/terminal.html', { waitUntil: 'load' });
await sleep(800);
check('stub redirects to site root', new URL(p2.url()).pathname === '/', p2.url());

// ---------- PAGE 3: Material home ----------
const p3 = await newPage();
await p3.goto(BASE + '/home.html', { waitUntil: 'load' });
await sleep(600);
{
  const cta = await p3.evaluate(() => {
    const a = [...document.querySelectorAll('a')].find(a => a.textContent.includes('Enter the terminal'));
    return a ? a.getAttribute('href') : null;
  });
  check('home: terminal CTA present', !!cta, cta);
  const bg = await p3.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('home: retheme bg #050709', bg === 'rgb(5, 7, 9)', bg);
  const cursor = await p3.evaluate(() => {
    const el = document.querySelector('.md-header__topic:first-child .md-ellipsis');
    return el ? getComputedStyle(el, '::after').content : 'missing';
  });
  check('home: blinking cursor pseudo-element', cursor.includes('▌'), cursor);
  const linkColor = await p3.evaluate(() => {
    const a = [...document.querySelectorAll('.md-typeset a')].find(a => a.textContent.includes('Continue reading'));
    return a ? getComputedStyle(a).color : 'none';
  });
  check('home: cyan content links', linkColor === 'rgb(103, 232, 249)', linkColor);
  const navTerminal = await p3.evaluate(() => !!document.querySelector('.md-nav__link[href$="terminal.html"], .md-nav__link[href*="terminal.html"]'));
  check('home: Terminal in nav', navTerminal);
  await p3.screenshot({ path: SHOTS + '/home.png' });
}

// ---------- PAGE 4: an entry page ----------
const p4 = await newPage();
await p4.goto(BASE + '/entries/018-the-present-tense.html', { waitUntil: 'load' });
await sleep(600);
{
  const og = await p4.evaluate(() => document.querySelector('meta[property="og:image"]')?.content || '');
  const ogOk = /^https:\/\/(upload\.wikimedia\.org|images\.unsplash\.com)\//.test(og) || og.startsWith('https://exios66.github.io/owlcot/assets/images/entries/');
  check('entry: og:image remote or self-hosted URL', ogOk, og.slice(0, 60));
  const badge = await p4.evaluate(() => document.body.innerText.includes('ENTRY #018'));
  check('entry: badge + reading time', badge && await p4.evaluate(() => !!document.querySelector('.reading-time')));
}

// ---------- PAGE 5: mobile viewport ----------
const p5 = await newPage(390, 844);
await p5.goto(BASE + '/', { waitUntil: 'load' });
await sleep(2600);
await p5.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
{
  const overflow = await p5.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check('mobile: no horizontal page overflow', !overflow);
  const hidden = await p5.evaluate(() => getComputedStyle(document.querySelector('#statusTheme').closest('.status-item')).display);
  check('mobile: non-essential status items hidden', hidden === 'none', hidden);
  const blogVisible = await p5.evaluate(() => {
    const el = document.getElementById('statusBlog');
    return getComputedStyle(el.closest('.status-item')).display !== 'none' && el.getBoundingClientRect().width > 10;
  });
  check('mobile: blog link STILL visible', blogVisible);
  const promptVisible = await p5.evaluate(() => {
    const r = document.querySelector('.prompt-line').getBoundingClientRect();
    return r.width > 100 && r.bottom <= innerHeight;
  });
  check('mobile: prompt visible & usable', promptVisible);
  const p5run = async (cmd, settle = 500) => {
    await p5.focus('#cmdInput');
    await p5.keyboard.type(cmd, { delay: 6 });
    await p5.keyboard.press('Enter');
    await sleep(settle);
  };
  await p5run('ls');
  check('mobile: ls works', (await p5.$eval('#output', e => e.innerText)).includes('entries'));
  await p5run('forest', 800);
  await p5.screenshot({ path: SHOTS + '/mobile-terminal.png' });
}

// ---------- PAGE 6: reduced motion ----------
const p6 = await newPage();
await p6.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await p6.goto(BASE + '/', { waitUntil: 'load' });
await sleep(1200);
{
  const n = await p6.evaluate(() => document.querySelectorAll('#ambientFireflies .firefly').length);
  check('reduced-motion: fireflies not spawned', n === 0, `count=${n}`);
  check('reduced-motion: boot still completes', await p6.evaluate(() => !!document.querySelector('.motd')));
}

// ---------- PAGE 7: release card once per version ----------
{
  const p7 = await newPage();
  // the shared profile already saw the card on page 1: clear storage once (sessionStorage survives reload)
  await p7.evaluateOnNewDocument(() => { try { if (!sessionStorage.getItem('fresh')) { localStorage.clear(); sessionStorage.setItem('fresh', '1'); } } catch (e) {} });
  await p7.goto(BASE + '/', { waitUntil: 'load' });
  await sleep(3200);
  check('release: card on first visit', await p7.$$eval('.release-card', n => n.length) === 1);
  check('release: card persisted seenEngine', await p7.$eval('body', () => localStorage.getItem('owlcotEngine')) === '2.0.0');
  await p7.reload({ waitUntil: 'load' });
  await sleep(3200);
  check('release: card absent on return', await p7.$$eval('.release-card', n => n.length) === 0);
  await p7.close();
  // release card must not overflow a 390px viewport
  const p8 = await newPage(390, 844);
  await p8.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) {} });
  await p8.goto(BASE + '/', { waitUntil: 'load' });
  await sleep(3200);
  check('release: card fits at 390px', await p8.$eval('body', () => !!document.querySelector('.release-card') && document.documentElement.scrollWidth <= window.innerWidth + 1 && document.querySelector('.release-card').getBoundingClientRect().right <= window.innerWidth));
  await p8.close();
}

// ---------- adaptive experience (task 4) ----------
{
  const run = async (pg, cmd, settle = 400) => {
    await pg.focus('#cmdInput');
    await pg.keyboard.type(cmd, { delay: 5 });
    await pg.keyboard.press('Enter');
    await sleep(settle);
  };
  const outText = pg => pg.$eval('#output', e => e.innerText);

  // fresh profile, then reload
  const pa = await newPage();
  await pa.evaluateOnNewDocument(() => { try { if (!sessionStorage.getItem('__c')) { localStorage.clear(); sessionStorage.setItem('__c', '1'); } } catch (e) {} });
  await pa.goto(BASE + '/', { waitUntil: 'load' });
  await sleep(4500);
  check('adaptive: first visit greeting', (await outText(pa)).includes('first time in the forest'));
  check('adaptive: daypart line in MOTD', /the owls are awake|the forest is waking up|daylight\. the owls|dusk\. the fireflies/.test(await outText(pa)));
  check('adaptive: __owl.daypart night', await pa.evaluate(() => typeof window.__owl.daypart === 'function' && window.__owl.daypart(new Date(2026, 0, 1, 23)) === 'night'));
  check('adaptive: __owl.daypart dawn', await pa.evaluate(() => typeof window.__owl.daypart === 'function' && window.__owl.daypart(new Date(2026, 0, 1, 6)) === 'dawn'));
  check('adaptive: __owl.daypart day', await pa.evaluate(() => typeof window.__owl.daypart === 'function' && window.__owl.daypart(new Date(2026, 0, 1, 12)) === 'day'));
  check('adaptive: __owl.daypart dusk', await pa.evaluate(() => typeof window.__owl.daypart === 'function' && window.__owl.daypart(new Date(2026, 0, 1, 19)) === 'dusk'));
  check('adaptive: __owl.visitor exposed', await pa.evaluate(() => !!window.__owl.visitor && window.__owl.visitor.visits === 1));
  await run(pa, 'whatsnew');
  check('adaptive: whatsnew first visit', (await outText(pa)).includes("everything is new. start with 'read 0'."));
  await run(pa, 'ls entries');
  const unreadBefore = await pa.evaluate(() => document.querySelectorAll('.file.unread').length);
  check('adaptive: all entries unread at first', unreadBefore > 1, String(unreadBefore));
  await run(pa, 'read 0', 600);
  await run(pa, 'cd ~');
  await run(pa, 'ls entries');
  const unreadState = await pa.evaluate(() => {
    const last = [...document.querySelectorAll('#output .listing')].pop();
    const els = [...last.querySelectorAll('.file')];
    const boss = els.find(e => e.textContent === '000-boss-man.md');
    return { boss: !!boss, bossUnread: !!boss && boss.classList.contains('unread'), others: els.some(e => e !== boss && e.classList.contains('unread')) };
  });
  check('adaptive: read entry loses .unread', unreadState.boss && !unreadState.bossUnread, JSON.stringify(unreadState));
  check('adaptive: other entries stay .unread', unreadState.others);
  await run(pa, 'stats');
  check('adaptive: stats read line', /you have read 1 of \d+ entries/.test(await outText(pa)));
  await pa.goto(BASE + '/', { waitUntil: 'load' });
  await sleep(2500);
  check('adaptive: reload greets visit #2', (await outText(pa)).includes('visit #2'));
  await run(pa, 'next', 600);
  check('adaptive: next continues from read history', (await outText(pa)).includes('001-'));
  await pa.close();

  // seeded returning visitor
  const ps = await newPage();
  await ps.evaluateOnNewDocument(() => { try { localStorage.setItem('owlcotVisitor', JSON.stringify({ visits: 3, lastVisit: '2026-01-01T00:00:00Z', read: [] })); } catch (e) {} });
  await ps.goto(BASE + '/', { waitUntil: 'load' });
  await sleep(2500);
  const st = await outText(ps);
  check('adaptive: seeded greeting visit #4', st.includes('visit #4'));
  check('adaptive: seeded greeting new entries', st.includes('new entries since your last visit'));
  await run(ps, 'whatsnew');
  const listed = await ps.evaluate(() => (document.querySelector('#output').innerText.match(/\d{3}-[a-z0-9-]+\.md/g) || []).length);
  check('adaptive: whatsnew lists >= 1 entry', listed >= 1, String(listed));
  await ps.close();

  // mobile chips
  const pm = await newPage(390, 844);
  await pm.goto(BASE + '/', { waitUntil: 'load' });
  await sleep(4500);
  check('adaptive: mobile shows quick chips', await pm.evaluate(() => document.querySelectorAll('.quick-chips button').length === 6));
  check('adaptive: chips tall enough', await pm.evaluate(() => [...document.querySelectorAll('.quick-chips button')].every(b => b.getBoundingClientRect().height >= 32)));
  check('adaptive: mobile no horizontal overflow', await pm.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  const before = await pm.evaluate(() => document.querySelectorAll('.listing').length);
  await pm.evaluate(() => [...document.querySelectorAll('.quick-chips button')].find(b => b.textContent === 'ls')?.click());
  await sleep(400);
  check('adaptive: ls chip produces listing', await pm.evaluate(() => document.querySelectorAll('.listing').length) > before);
  await run(pm, 'ls entries');
  check('adaptive: mobile listing no overflow', await pm.evaluate(() => { const o = document.querySelector('#output'); return document.documentElement.scrollWidth <= window.innerWidth + 1 && o.scrollWidth <= o.clientWidth + 1; }));
  await pm.close();

  // desktop has no chips
  const pd = await newPage();
  await pd.goto(BASE + '/', { waitUntil: 'load' });
  await sleep(2500);
  check('adaptive: desktop has no chips', await pd.evaluate(() => document.querySelectorAll('.quick-chips').length === 0));
  await pd.close();

  // storage blocked
  const pb = await newPage();
  const nerrB = errors.length;
  await pb.evaluateOnNewDocument(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
  await pb.goto(BASE + '/', { waitUntil: 'load' });
  await sleep(4500);
  check('adaptive: storage blocked boots to MOTD', (await outText(pb)).includes('a journal that behaves like a terminal'));
  await run(pb, 'read 0', 500);
  await run(pb, 'whatsnew');
  check('adaptive: storage blocked no pageerror', errors.length === nerrB, errors.slice(nerrB).join(' | '));
  await pb.close();
}

// ---------- noData page: OWL_DATA missing ----------
{
  const pn = await newPage();
  await pn.evaluateOnNewDocument(() => { Object.defineProperty(window, 'OWL_DATA', { set() {}, get() { return undefined; } }); });
  await pn.goto(BASE + '/', { waitUntil: 'load' });
  await sleep(3200);
  const nerr = errors.length;
  for (const c of ['random', 'grep x', 'stats', 'fortune', 'next', 'prev', 'first', 'tags', 'calendar', 'wc', 'head x']) {
    await pn.focus('#cmdInput');
    await pn.keyboard.type(c, { delay: 5 });
    await pn.keyboard.press('Enter');
    await sleep(250);
  }
  check('noData: commands survive without pageerror', errors.length === nerr, errors.slice(nerr).join(' | '));
  check('noData: commands printed something', (await pn.$eval('#output', e => e.innerText)).includes('no entries'));
  await pn.close();
}

await browser.close();
server.kill();

console.log('\n===== RESULTS =====');
results.forEach(r => console.log(r));
const fails = results.filter(r => r.startsWith('FAIL')).length;
console.log('\n===== HARD ERRORS =====');
errors.length ? errors.forEach(e => console.log(e)) : console.log('(none)');
console.log('\n===== SERVER 404s =====');
const s404 = serverLog.split('\n').filter(l => l.includes(' 404 '));
s404.length ? s404.forEach(e => console.log(e.trim())) : console.log('(none)');
console.log('\n===== SOFT WARNINGS (external) =====');
warns.length ? [...new Set(warns)].slice(0, 12).forEach(e => console.log(e)) : console.log('(none)');
console.log(`\n${fails === 0 && errors.length === 0 && s404.length === 0 ? 'ALL GREEN' : fails + ' FAILURES, ' + errors.length + ' ERRORS, ' + s404.length + ' SERVER 404s'}`);
process.exit(fails === 0 && errors.length === 0 && s404.length === 0 ? 0 : 1);
