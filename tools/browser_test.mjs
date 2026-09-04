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
    if (t === 'error') errors.push(`[console.error] ${m.text()}`);
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
check('open latest opens newest URL', await page.evaluate(() => window.__opened.some(u => u.includes('018-the-present-tense'))));

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
  check('entry: og:image remote URL', og.includes('upload.wikimedia.org'), og.slice(0, 60));
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
