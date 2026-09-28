// The TUI gateway is the only door to a public PTY, so its auth is a sensor,
// not a comment. Every case here is one a real attacker would try.
//
// Run: node scripts/assert-tui-gateway.test.mjs
import crypto from 'node:crypto';
import http from 'node:http';
import assert from 'node:assert/strict';
import { validateInitData, issueToken, verifyToken, tokenFor, ttydFor, ttydPathFor, createGateway, COOKIE_NAME, TOKEN_ROUTES, withPhoneViewport, withFullscreenButton, FULLSCREEN_WIDGET_JS, LAYOUT_JS, TOUCH_SCROLL_JS, landingLocationFor } from './tui-gateway.mjs';

let passed = 0;
let failed = 0;
const check = (name, cond) => {
  if (cond) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.error(`  FAIL  ${name}`);
    failed++;
  }
};

const TOKEN = '123456:TEST-TOKEN-NOT-REAL';
const SECRET = 'server-secret-for-tests';

/**
 * Build initData the way Telegram does.
 *
 * The wire form is percent-encoded `k=v` joined by `&`. The signed
 * `data_check_string` is the DECODED pairs sorted by key and joined by "\n".
 * Building one from the other by hand is easy to get backwards, and a helper
 * that is wrong makes every "valid" case fail for the wrong reason.
 */
function makeInitData(fields, { secretKey = null, hash = null } = {}) {
  const keys = Object.keys(fields).sort();
  const dataCheckString = keys.map((k) => `${k}=${fields[k]}`).join('\n');
  const wire = keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(fields[k])}`).join('&');
  const key = secretKey || crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const h = hash || crypto.createHmac('sha256', key).update(dataCheckString).digest('hex');
  return `${wire}&hash=${h}`;
}

// Fetch the real page through the real handler, with a stub ttyd, so the page
// under test is the one a browser would be handed.
async function ttydPageThroughGateway() {
  let upstream = '';
  const ttyd = http.createServer((rq, rs) => {
    const page = '<!doctype html><html><head><title>t</title></head><body>'
      + '<script>console.log("hello");</script></body></html>';
    upstream = page;
    rs.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    rs.end(page);
  });
  await new Promise((r) => ttyd.listen(0, '127.0.0.1', r));
  const port = ttyd.address().port;
  const env = {
    TUI_GATEWAY_SECRET: SECRET,
    TUI_BOT_TOKEN_VM: TOKEN,
    TUI_TTYD_URL: `http://127.0.0.1:${port}`,
    TUI_TTYD_CREDENTIAL: Buffer.from('tui:x').toString('base64'),
  };
  const token = issueToken({ botId: 'vm', chatId: '6218257274', secret: SECRET, ttlSec: 900 });
  const handle = createGateway({ env, log: () => {} });
  const html = await new Promise((resolve, reject) => {
    const res = {
      writeHead: () => {},
      end: (body) => resolve(String(body || '')),
    };
    handle({
      method: 'GET',
      url: '/tty/',
      headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` },
    }, res).catch(reject);
    setTimeout(() => reject(new Error('the page handler never answered')), 5000).unref?.();
  });
  ttyd.close();
  return { html, upstream };
}

// The bootstrap is what a cold WebView gets, with no initData in the URL.
async function bootstrapThroughGateway() {
  const env = { TUI_GATEWAY_SECRET: SECRET, TUI_BOT_TOKEN_VM: TOKEN };
  const handle = createGateway({ env, log: () => {} });
  return new Promise((resolve, reject) => {
    const res = { writeHead: () => {}, end: (b) => resolve(String(b || '')) };
    handle({ method: 'GET', url: '/', headers: {} }, res).catch(reject);
    setTimeout(() => reject(new Error('the bootstrap handler never answered')), 5000).unref?.();
  });
}

const now = Date.now();
const fresh = (extra = {}) => ({
  auth_date: String(Math.floor(now / 1000)),
  query_id: 'AAH_test',
  user: JSON.stringify({ id: 6218257274, first_name: 'Cwah' }),
  ...extra,
});

console.log('assert-tui-gateway:');

// 1. A well-formed initData signed with this bot's token is admitted.
{
  const v = validateInitData(makeInitData(fresh()), TOKEN, { now });
  check('valid initData is admitted', v.ok === true);
  check('the chat is bound from the user', String(v.chatId) === '6218257274');
}

// 2. A different bot's token must not open this bot.
{
  const init = makeInitData(fresh());
  const v = validateInitData(init, '999:OTHER-BOT-TOKEN', { now });
  check('another bot token is refused', v.ok === false);
  check('the refusal says the hash did not match', /hash mismatch/.test(v.reason));
}

// 3. A tampered field invalidates the signature.
{
  const init = makeInitData(fresh());
  const tampered = init.replace('6218257274', '9999999999');
  const v = validateInitData(tampered, TOKEN, { now });
  check('a tampered user id is refused', v.ok === false);
}

// 4. Replay: the same string an hour later is refused.
{
  const init = makeInitData(fresh({ auth_date: String(Math.floor(now / 1000) - 3600) }));
  check('an hour-old initData is refused', validateInitData(init, TOKEN, { now }).ok === false);
}

// 5. Clock skew is allowed forward, refused far forward.
{
  const ahead = makeInitData(fresh({ auth_date: String(Math.floor(now / 1000) + 30) }));
  check('30s of forward skew is allowed', validateInitData(ahead, TOKEN, { now }).ok === true);
  const way = makeInitData(fresh({ auth_date: String(Math.floor(now / 1000) + 600) }));
  check('10 minutes of forward skew is refused', validateInitData(way, TOKEN, { now }).ok === false);
}

// 6. Missing pieces are refused rather than crashing.
{
  check('empty initData is refused', validateInitData('', TOKEN, { now }).ok === false);
  check('a missing token is refused', validateInitData(makeInitData(fresh()), '', { now }).ok === false);
  check('initData with no hash is refused', validateInitData('auth_date=1&user=%7B%7D', TOKEN, { now }).ok === false);
  check('a non-numeric auth_date is refused',
    validateInitData(makeInitData(fresh({ auth_date: 'soon' })), TOKEN, { now }).ok === false);
}

// 7. Session tokens: signature, binding, expiry.
{
  const t = issueToken({ botId: 'vm', chatId: '6218257274', secret: SECRET, ttlSec: 900, now });
  const v = verifyToken(t, SECRET, { now });
  check('a fresh session token verifies', v.ok === true);
  check('it is bound to the bot', v.botId === 'vm');
  check('it is bound to the chat', v.chatId === '6218257274');
  check('a token signed with another secret is refused',
    verifyToken(t, 'other-secret', { now }).ok === false);
  check('an expired token is refused',
    verifyToken(issueToken({ botId: 'vm', chatId: '1', secret: SECRET, ttlSec: 1, now: now - 5000 }), SECRET, { now }).ok === false);
  check('a tampered token is refused', verifyToken(`${t}x`, SECRET, { now }).ok === false);
  check('garbage is refused, not thrown on', verifyToken('nonsense', SECRET, { now }).ok === false);
  check('an empty token is refused', verifyToken('', SECRET, { now }).ok === false);
}

// 8. A token minted for one chat must not open another. The signature covers
//    the chat, so re-pointing the body breaks it.
{
  const t = issueToken({ botId: 'vm', chatId: '6218257274', secret: SECRET, ttlSec: 900, now });
  const [body, mac] = t.split('.');
  const swapped = Buffer.from('vm|9999999999|' + body.split('|')[2] + '|' + body.split('|')[3]).toString('base64url');
  check('a token re-pointed at another chat is refused',
    verifyToken(`${swapped}.${mac}`, SECRET, { now }).ok === false);
}

// 9. The per-bot token lookup must not fall through to a shared token.
{
  const env = { TUI_BOT_TOKEN_VM: 'vm-token', TUI_BOT_TOKEN: 'shared' };
  check('a per-bot token is preferred', tokenFor('vm', env) === 'vm-token');
  check('an unlisted bot falls back to the shared token', tokenFor('other', env) === 'shared');
  check('a bot id with punctuation still maps', tokenFor('vm2', { TUI_BOT_TOKEN_VM2: 'x' }) === 'x');
}

// 10. The session binds to the CHAT when Telegram sends one. Binding to the
//     user alone meant the same person in two chats shared a session, while the
//     field was named chatId and the comments claimed a chat binding.
{
  const withChat = (chatId) => makeInitData(fresh({
    chat: JSON.stringify({ id: chatId, type: 'group', title: 't' }),
  }));
  const a = validateInitData(withChat(-1001), TOKEN, { now });
  const b = validateInitData(withChat(-1002), TOKEN, { now });
  check('a group initData binds to the chat', a.ok && a.boundBy === 'chat' && String(a.chatId) === '-1001');
  check('the same user in two chats gets two bindings', a.chatId !== b.chatId);
  const ta = issueToken({ botId: 'vm', chatId: String(a.chatId), secret: SECRET, ttlSec: 900, now });
  const tb = issueToken({ botId: 'vm', chatId: String(b.chatId), secret: SECRET, ttlSec: 900, now });
  check("chat A's token does not verify as chat B",
    verifyToken(ta, SECRET, { now }).chatId !== verifyToken(tb, SECRET, { now }).chatId);
  const priv = validateInitData(makeInitData(fresh()), TOKEN, { now });
  check('a private Mini App falls back to the user', priv.ok && priv.boundBy === 'user' && String(priv.chatId) === '6218257274');
  check('a malformed chat field is refused, not ignored',
    validateInitData(makeInitData(fresh({ chat: '{not json' })), TOKEN, { now }).ok === false);
}

// 11. The cookie is hardened. A terminal behind a public hostname whose
//     session cookie can travel in plaintext is a session that can be stolen.
{
  check('the cookie name carries the __Host- prefix', COOKIE_NAME.startsWith('__Host-'));
  const env = { TUI_GATEWAY_SECRET: SECRET, TUI_BOT_TOKEN_VM: TOKEN };
  const handle = createGateway({ env, log: () => {} });
  // The cookie is issued on the EXCHANGE, so the request has to carry valid
  // initData. Hitting '/' with nothing only proves the bootstrap is served.
  const initData = makeInitData(fresh());
  const headers = await new Promise((resolve) => {
    const res = {
      writeHead: (code, h) => resolve({ code, h: h || {} }),
      end: () => resolve({ code: 0, h: {} }),
    };
    handle({ method: 'GET', url: `/?bot=vm&initData=${encodeURIComponent(initData)}`, headers: {} }, res);
  });
  check('the exchange is a redirect to the page', headers.code === 302);
  const cookie = String(headers.h?.['set-cookie'] || '');
  check('the landing sets a cookie', /__Host-tui_session=/.test(cookie));
  check('the cookie is HttpOnly', /HttpOnly/.test(cookie));
  check('the cookie is Secure', /Secure/.test(cookie));
  check('the cookie is SameSite=Strict', /SameSite=Strict/.test(cookie));
  check('the cookie is Path=/', /Path=\//.test(cookie));
  check('the cookie carries no Domain (required by __Host-)', !/Domain=/.test(cookie));
}

// 12. The pages the browser actually gets.
//     A script error on these fires on every page load and only a browser ever
//     sees it, so both are executed here rather than parsed. Parsing is not
//     enough: `new RegExp("/ws(?|$)")` parses fine and throws when it runs,
//     which is exactly the bug that shipped.
{
  // 12a. ttyd's page arrives with a phone viewport injected and nothing else:
  //      without a viewport meta a phone WebView lays out at ~980px and
  //      shrinks the terminal into a framed box (2026-09-28). CSS + meta
  //      only — a previous JS shim threw on every load, so script count
  //      must not change.
  const { html, upstream } = await ttydPageThroughGateway();
  check('the page is html', /<html/i.test(html));
  check('the served page has a phone viewport', /<meta[^>]*viewport[^>]*width=device-width/i.test(html));
  check('the served page zeroes the body frame', /html,body\{[^}]*margin:0/i.test(html));
  check('the served page full-bleeds the terminal container', /#terminal-container\{[^}]*width:100%/i.test(html));
  check('the upstream body survives the injection', html.includes('console.log("hello")'));
  check('the fullscreen button ships with the page', html.includes('tui-fsbtn'));
  check('exactly our widget scripts are added, nothing else',
    (html.match(/<script/gi) || []).length === (upstream.match(/<script/gi) || []).length + 5
    && html.includes('requestFullscreen'));
  check('the page is not gzip bytes labelled as html', !html.startsWith('\u001f\u008b'));
  check('no credential is embedded in the page', !/tui_session=/.test(html) && !/var TOKEN =/.test(html));

  // 12a2. The injection itself: head, no-head, already-present.
  check('tags go inside an existing head',
    withPhoneViewport('<html><head><title>t</title></head><body>x</body></html>')
      .includes('<head><meta name="viewport"'));
  check('tags prepend when there is no head',
    withPhoneViewport('<html><body>x</body></html>').startsWith('<meta name="viewport"'));
  check('a page with a viewport passes through untouched',
    withPhoneViewport('<html><head><meta name="viewport" content="x"></head></html>')
      === '<html><head><meta name="viewport" content="x"></head></html>');

  // 12a3. The fullscreen widget: idempotent, body-anchored, and executable.
  //       Page JS burned us before (a shim SyntaxError on every load), so the
  //       snippet runs here against stubs, like the bootstrap section does.
  check('the widget anchors before </body>',
    /id="tui-fsbtn"[\s\S]*<\/button>/.test(
      withFullscreenButton('<html><body>x</body></html>')));
  check('the widget is idempotent',
    withFullscreenButton(withFullscreenButton('<html><body>x</body></html>'))
      .split('tui-fsbtn').length === 3);
  {
    const calls = { fullscreen: 0, exited: 0, expanded: 0, swipesOff: 0, resized: 0, viewportHook: null };
    const btn = { style: {}, addEventListener: (ev, fn) => { btn[ev] = fn; } };
    const tg = {
      ready: () => {},
      isFullscreen: false,
      requestFullscreen: () => { calls.fullscreen++; },
      exitFullscreen: () => { calls.exited++; },
      expand: () => { calls.expanded++; },
      disableVerticalSwipes: () => { calls.swipesOff++; },
      onEvent: (ev, fn) => { calls.viewportHook = ev; btn.viewportFn = fn; },
    };
    const stubWindow = {
      Telegram: { WebApp: tg },
      dispatchEvent: (e) => { if (e && e.type === 'resize') calls.resized++; },
    };
    const stubDoc = {
      getElementById: (id) => (id === 'tui-fsbtn' ? btn : (id === 'terminal-container' ? { clientWidth: 500 } : null)),
    };
    let threw = '';
    try {
      // eslint-disable-next-line no-new-func
      new Function('window', 'document', 'location', 'Telegram', 'Event', FULLSCREEN_WIDGET_JS)(
        stubWindow, stubDoc, { search: '' }, undefined, function Event(t) { this.type = t; },
      );
    } catch (e) { threw = String(e.message); }
    check(`the widget runs without throwing${threw ? ` — ${threw}` : ''}`, threw === '');
    check('the app expands on load', calls.expanded >= 1);
    check('vertical swipes are handed to the terminal', calls.swipesOff === 1);
    btn.click();
    check('tapping the button requests fullscreen', calls.fullscreen === 1);
    tg.isFullscreen = true;
    btn.click();
    check('tapping again in fullscreen exits it', calls.exited === 1);
    btn.viewportFn();
    check('a Telegram viewport change refits the terminal', calls.resized >= 1);
    check('the widget hooks viewportChanged', calls.viewportHook === 'viewportChanged');
    check('fullscreen is requested on load, not only on tap', calls.fullscreen >= 1);
    const btn2 = { style: {}, addEventListener: () => {} };
    new Function('window', 'document', 'location', 'Telegram', 'Event', FULLSCREEN_WIDGET_JS)(
      { dispatchEvent: () => {} }, { getElementById: () => btn2 }, { search: '' }, undefined,
      function Event(t) { this.type = t; },
    );
    check('without Telegram the button hides itself', btn2.style.display === 'none');
  }

  // 12a4. The LAYOUT pass must not depend on Telegram, and it must fill
  //       whatever the viewport actually is — no device is special-cased.
  {
    let observed = null; let fits = 0;
    const listeners = {};
    const container = { clientWidth: 0, style: { props: {}, setProperty(k, v) { this.props[k] = v; } } };
    const screen = { clientWidth: 0, style: {} };
    const win = {
      innerWidth: 500,
      visualViewport: { width: 390, scale: 1, addEventListener: (e, f) => { listeners[e] = f; } },
      dispatchEvent: (e) => { if (e && e.type === 'resize') fits++; },
      addEventListener: (e, f) => { listeners[e] = f; },
      ResizeObserver: class { constructor(fn) { this.fn = fn; } observe(el) { observed = el; } },
    };
    const doc = {
      getElementById: (id) => (id === 'terminal-container' ? container : null),
      querySelector: (s) => (s === '.xterm-screen' ? screen : null),
      documentElement: { clientWidth: 500 },
    };
    const tick = () => { for (const t of docTimers) t.fn(); };
    const docTimers = [];
    let threw = '';
    try {
      // eslint-disable-next-line no-new-func
      new Function('window', 'document', 'setTimeout', LAYOUT_JS)(win, doc, (fn, ms) => {
        docTimers.push({ fn, ms });
        return docTimers.length;
      });
      tick();
    } catch (e) { threw = String(e.message); }
    check(`the layout pass runs without Telegram${threw ? ` — ${threw}` : ''}`, threw === '');
    check('the layout pass watches the terminal container', observed === container);
    check('the container is widened to the visual viewport, not the inset',
      container.style.props.width === '390px' && container.style.props['max-width'] === 'none');
    check('a viewport change refits again', typeof listeners.resize === 'function' && fits >= 1);

    // The leftover-cell absorb: grid 300 in a 390-wide container = 23% slack.
    screen.clientWidth = 300;
    container.clientWidth = 390;
    docTimers[docTimers.length - 1].fn();
    check('the grid is stretched to the full width',
      /scaleX\(1\.3\)/.test(screen.style.transform || ''));
    // A 1% leftover is left alone: sub-percent stretching only blurs text.
    screen.clientWidth = 387;
    docTimers[docTimers.length - 1].fn();
    check('a sub-percent leftover is left alone',
      (screen.style.transform || '') === '');
  }

  // 12a6. Touch drag must become the app's own scroll keys. Measured facts
  //       this pins: opencode IGNORES SGR wheel (view did not move when
  //       ESC[65/66 were sent straight to it) and DOES move on PageUp/PageDown,
  //       and xterm encodes keyCode 33/34 to ESC[5~/ESC[6~ on its textarea.
  {
    const handlers = {}; const keys = [];
    const screenEl = {
      clientWidth: 360, clientHeight: 700,
      addEventListener: (ev, fn) => { handlers[ev] = fn; },
    };
    const textarea = { dispatchEvent: (e) => { keys.push(e); return true; } };
    const doc = {
      querySelector: (s) => (s === '.xterm-screen' ? screenEl
        : (s === '.xterm-helper-textarea' ? textarea : null)),
    };
    let prevented = 0;
    let threw = '';
    try {
      // eslint-disable-next-line no-new-func
      new Function('window', 'document', 'KeyboardEvent', 'performance', TOUCH_SCROLL_JS)(
        {},
        doc,
        function KeyboardEvent(type, init) { this.type = type; Object.assign(this, init); },
        { now: () => 1000 },
      );
    } catch (e) { threw = String(e.message); }
    check(`the touch bridge installs${threw ? ` — ${threw}` : ''}`, threw === '');
    check('the bridge listens on the terminal', !!handlers.touchstart && !!handlers.touchmove && !!handlers.touchend);

    // step() = 700/3 = 233px, so a tap and a small nudge must not scroll.
    handlers.touchstart({ touches: [{ clientY: 600 }] });
    handlers.touchmove({ touches: [{ clientY: 580 }], preventDefault() { prevented++; } });
    check('a small nudge does not page',
      keys.filter((k) => k.type === 'keydown').length === 0);
    check('a nudge is not taken off the page', prevented === 0);

    // Dragging UP shows later content: PageDown (keyCode 34).
    const up0 = keys.length;
    handlers.touchstart({ touches: [{ clientY: 600 }] });
    handlers.touchmove({ touches: [{ clientY: 300 }], preventDefault() { prevented++; } });
    const upKeys = keys.slice(up0);
    check('an upward drag pages down (keyCode 34)',
      upKeys.some((k) => k.type === 'keydown' && k.keyCode === 34));
    check('the key is released too', upKeys.some((k) => k.type === 'keyup' && k.keyCode === 34));
    check('the drag is taken off the page once scrolling', prevented >= 1);

    // Dragging DOWN shows earlier content: PageUp (keyCode 33).
    const before = keys.length;
    handlers.touchstart({ touches: [{ clientY: 300 }] });
    handlers.touchmove({ touches: [{ clientY: 600 }], preventDefault() { prevented++; } });
    check('a downward drag pages up (keyCode 33)',
      keys.slice(before).some((k) => k.keyCode === 33 && k.type === 'keydown'));

    // One long drag pages once per third of the screen, not per pixel.
    const b2 = keys.length;
    handlers.touchstart({ touches: [{ clientY: 700 }] });
    for (let y = 700; y >= 0; y -= 20) {
      handlers.touchmove({ touches: [{ clientY: y }], preventDefault() { prevented++; } });
    }
    const downs = keys.slice(b2).filter((k) => k.type === 'keydown').length;
    check('a full-screen drag pages about three times, not dozens', downs >= 2 && downs <= 4);

    // Multi-touch is ignored so pinch-zoom is not hijacked.
    handlers.touchend({});
    const b3 = keys.length;
    handlers.touchstart({ touches: [{ clientY: 100 }, { clientY: 200 }] });
    handlers.touchmove({ touches: [{ clientY: 0 }, { clientY: 300 }], preventDefault() { prevented++; } });
    check('multi-touch is left alone', keys.length === b3);

    // A fast flick adds at most one page.
    handlers.touchend({});
    const b4 = keys.length;
    handlers.touchstart({ touches: [{ clientY: 600 }] });
    handlers.touchmove({ touches: [{ clientY: 560 }], preventDefault() { prevented++; } });
    handlers.touchend({});
    check('a flick adds at most one page',
      keys.slice(b4).filter((k) => k.type === 'keydown').length <= 1);
  }

  // 12a5. TEMP-DEBUG: the geometry readout rides on the landing redirect only
  //        when TUI_PAGE_DEBUG=1, and never otherwise.
  check('the landing redirect carries no readout flag by default',
    landingLocationFor('vm2', 'TOK', {}).indexOf('tui_measure') === -1);
  check('TUI_PAGE_DEBUG=1 turns the readout on',
    landingLocationFor('vm2', 'TOK', { TUI_PAGE_DEBUG: '1' }).indexOf('tui_measure=1') !== -1);
  check('the readout flag keeps the session token first',
    landingLocationFor('vm2', 'TOK', { TUI_PAGE_DEBUG: '1' }) === '/tty2/?token=TOK&tui_measure=1');

  // 12b. The bootstrap we do serve is ours, so it is executed with stubs.
  const boot = await bootstrapThroughGateway();
  const scripts = [...boot.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  check('the bootstrap has a script', scripts.length > 0);
  let broke = 0;
  let firstError = '';
  for (const body of scripts) {
    const stubWindow = {};
    const stubDoc = { getElementById: () => ({ set textContent(v) {}, onclick: null }) };
    try {
      // eslint-disable-next-line no-new-func
      new Function('window', 'document', 'location', 'Telegram', body)(
        stubWindow, stubDoc, { search: '', replace() {} }, undefined,
      );
    } catch (e) {
      broke++;
      if (!firstError) firstError = String(e.message);
    }
  }
  check(`the bootstrap runs without throwing${broke ? ` — ${firstError}` : ''}`, broke === 0);
}

// 13. Two bots, two terminals. Each bot's sessions map is its own, so sharing
//     one ttyd would attach every vm2 chat to a vm conversation. The gateway
//     routes each bot to its own ttyd and refuses a token on the other bot's
//     page — the page equivalent of the socket's cross-bot refusal.
{
  check('vm keeps the shared ttyd', ttydFor('vm', {}) === 'http://127.0.0.1:8896');
  check('an unknown bot falls back to the shared ttyd',
    ttydFor('nosuchbot', {}) === 'http://127.0.0.1:8896');
  check('a per-bot URL wins for that bot',
    ttydFor('vm2', { TUI_TTYD_URL_VM2: 'http://127.0.0.1:8899' }) === 'http://127.0.0.1:8899');
  check('the per-bot URL does not leak to the other bot',
    ttydFor('vm', { TUI_TTYD_URL_VM2: 'http://127.0.0.1:8899' }) === 'http://127.0.0.1:8896');
  check('the landing sends vm to /tty/', ttydPathFor('vm') === '/tty/');
  check('the landing sends vm2 to /tty2/', ttydPathFor('vm2') === '/tty2/');
  check('an unknown bot lands on /tty/', ttydPathFor('nosuchbot') === '/tty/');
}

// 14. The page door is per-bot. A vm token on /tty2/ (and vice versa) is
//     refused even though the token itself is valid — otherwise the sessions
//     map the attach script reads would belong to the wrong bot.
{
  const serve = async (bot, path) => {
    let upstreamPort = 0;
    const ttyd = http.createServer((rq, rs) => {
      rs.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      rs.end(`<html><body>${bot}</body></html>`);
    });
    await new Promise((r) => ttyd.listen(0, '127.0.0.1', r));
    upstreamPort = ttyd.address().port;
    const env = {
      TUI_GATEWAY_SECRET: SECRET,
      TUI_BOT_TOKEN_VM: TOKEN,
      TUI_BOT_TOKEN_VM2: TOKEN,
      TUI_TTYD_URL: `http://127.0.0.1:${upstreamPort}`,
      TUI_TTYD_URL_VM2: `http://127.0.0.1:${upstreamPort}`,
      TUI_TTYD_CREDENTIAL: Buffer.from('tui:x').toString('base64'),
    };
    const token = issueToken({ botId: bot, chatId: '6218257274', secret: SECRET, ttlSec: 900 });
    const handle = createGateway({ env, log: () => {} });
    const code = await new Promise((resolve, reject) => {
      const res = { writeHead: (c) => resolve(c), end: () => {} };
      handle({ method: 'GET', url: path,
        headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` } }, res).catch(reject);
    });
    ttyd.close();
    return code;
  };
  check('a vm token opens the vm page', await serve('vm', '/tty/') === 200);
  check('a vm2 token opens the vm2 page', await serve('vm2', '/tty2/') === 200);
  check("a vm token is refused on the vm2 page", await serve('vm', '/tty2/') === 401);
  check("a vm2 token is refused on the vm page", await serve('vm2', '/tty/') === 401);
}

// The socket AuthToken the served page fetches as ./token. On 2026-09-28 the
// gateway 404'd it, so every socket opened with a missing token and ttyd
// killed it silently (POLICY_VIOLATION, no warning) — the reconnect loop.
{
  check('both token paths are routed', TOKEN_ROUTES['/tty/token'] === 'vm' && TOKEN_ROUTES['/tty2/token'] === 'vm2');
  const CRED = Buffer.from('tui:x').toString('base64');
  const serveToken = async (bot, path, withCookie = true) => {
    const env = {
      TUI_GATEWAY_SECRET: SECRET,
      TUI_BOT_TOKEN_VM: TOKEN,
      TUI_BOT_TOKEN_VM2: TOKEN,
      TUI_TTYD_CREDENTIAL: CRED,
    };
    const token = issueToken({ botId: bot, chatId: '6218257274', secret: SECRET, ttlSec: 900 });
    const handle = createGateway({ env, log: () => {} });
    return new Promise((resolve, reject) => {
      let code = 0; let body = '';
      const res = { writeHead: (c) => { code = c; }, end: (b) => { body = String(b || ''); resolve({ code, body }); } };
      const headers = withCookie ? { cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` } : {};
      handle({ method: 'GET', url: path, headers }, res).catch(reject);
    });
  };
  const vmTok = await serveToken('vm', '/tty/token');
  check('a vm token gets the vm socket token', vmTok.code === 200 && JSON.parse(vmTok.body).token === CRED);
  const vm2Tok = await serveToken('vm2', '/tty2/token');
  check('a vm2 token gets the vm2 socket token', vm2Tok.code === 200 && JSON.parse(vm2Tok.body).token === CRED);
  check('a vm token is refused the vm2 socket token', (await serveToken('vm', '/tty2/token')).code === 401);
  check('a vm2 token is refused the vm socket token', (await serveToken('vm2', '/tty/token')).code === 401);
  check('no cookie gets no socket token', (await serveToken('vm', '/tty/token', false)).code === 401);
}

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
