// The TUI gateway is the only door to a public PTY, so its auth is a sensor,
// not a comment. Every case here is one a real attacker would try.
//
// Run: node scripts/assert-tui-gateway.test.mjs
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { validateInitData, issueToken, verifyToken, tokenFor, configuredTokenBots, describeInitData, ttydFor, ttydPathFor, ttydRoutes, tokenRoutes, createGateway, COOKIE_NAME, TOKEN_ROUTES, withPhoneViewport, withFullscreenButton, FULLSCREEN_WIDGET_JS, LAYOUT_JS, TOUCH_SCROLL_JS, landingLocationFor, authorizeForgeAtGateway, isWebUiHost, webUiHost, webUiUpstream, webUiAuthHeader, webAuthShimJs, injectWebAuthShim, webUpstreamQuery, WEB_AUTH_STORAGE_KEY, refererToken, describeWebRefusal, isWebStatic, verifyWithRefererFallback, tgtgUpstream, tgtgHost, isTgtgHost, agendaUpstream, agendaHost, isAgendaHost } from './tui-gateway.mjs';

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

// 9b. Env-file whitespace must not break one bot's HMAC while the other works
//     (a75c75e). Refusal logs name the configured bots and describe the shape
//     of what arrived, so the class is visible instead of a bare mismatch.
{
  check('a padded per-bot token is trimmed', tokenFor('vm2', { TUI_BOT_TOKEN_VM2: 'x\n' }) === 'x');
  check('a padded shared token is trimmed', tokenFor('other', { TUI_BOT_TOKEN: '  shared\r\n' }) === 'shared');
  const paddedEnv = { TUI_BOT_TOKEN_VM: TOKEN, TUI_BOT_TOKEN_VM2: ` ${TOKEN} ` };
  const init = makeInitData(fresh());
  check('initData verifies against a padded vm2 token',
    validateInitData(init, tokenFor('vm2', paddedEnv), { now }).ok === true);
  const names = configuredTokenBots({ TUI_BOT_TOKEN_VM: 'a', TUI_BOT_TOKEN_VM2: 'b', TUI_BOT_TOKEN_EMPTY: '  ', OTHER: 'x' });
  check('configured bots are listed for refusal logs', JSON.stringify(names) === JSON.stringify(['vm', 'vm2']));
  const shaped = describeInitData(makeInitData(fresh()));
  const realHash = new URLSearchParams(makeInitData(fresh())).get('hash');
  check('refusal detail names keys, user and length',
    shaped.includes('keys=[auth_date,hash,query_id,user]') && shaped.includes('user=') && shaped.includes('len='));
  check('refusal detail never carries the hash or user content',
    !shaped.includes(realHash) && !shaped.includes('Cwah'));
  check('garbage initData still describes safely', describeInitData('%%%').length > 0);
}

// 9c. Both Telegram client generations must verify (9ce3990): newer clients
//     include `signature` in the signed check string, older ones have no such
//     field. A tampered signature still fails both.
{
  check('initData with a signed signature field verifies',
    validateInitData(makeInitData({ ...fresh(), signature: 'AAAABBBB' }), TOKEN, { now }).ok === true);
  check('initData with an unsigned trailing signature still verifies',
    validateInitData(`${makeInitData(fresh())}&signature=AAAABBBB`, TOKEN, { now }).ok === true);
  check('a tampered signature is refused',
    validateInitData(makeInitData({ ...fresh(), signature: 'AAAABBBB' }).replace('AAAABBBB', 'XXXXYYYY'), TOKEN, { now }).ok === false);
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

  // 12a6. Touch drag -> transcript scroll keys both lanes honour. The terminal
  //       is per-lane (opencode OR cline, scripts/lib/tui-surface.mjs) and the
  //       two lanes scroll on different modified keys:
  //         opencode: messages_page_up = PageUp / ctrl+alt+b,
  //                   messages_page_down = PageDown / ctrl+alt+f
  //                   (docs: https://opencode.ai/docs/nb/keybinds/)
  //         cline:    messages_page_up = PageUp / ctrl+meta+b,
  //                   messages_page_down = PageDown / ctrl+meta+f,
  //                   half page = ctrl+meta+u / ctrl+meta+d
  //                   (TRANSCRIPT_KEYBINDS in
  //                   sdk/apps/cli/src/tui/hooks/transcript-keybinds.ts)
  //       So the bridge sends BARE PageUp / PageDown: the one binding both
  //       lanes share. A ctrl+alt bridge scrolls opencode and is dead on a
  //       cline lane (cline wants meta, not alt) — the "scrolls on VM2, dead
  //       on VM" shape. Both directions are paced: a page key jumps a full
  //       page, so an unpaced burst would skip screens per touchmove.
  {
    const handlers = {}; const keys = [];
    let mounted = false;
    let clock = 1000;
    const screenEl = {
      clientWidth: 360, clientHeight: 700,
      addEventListener: (ev, fn) => { handlers[ev] = fn; },
      removeEventListener: () => {},
    };
    const textarea = { dispatchEvent: (e) => { keys.push(e); return true; }, focus: () => {} };
    const doc = {
      querySelector: (s) => (s === '.xterm-screen' ? (mounted ? screenEl : null)
        : (s === '.xterm-helper-textarea' ? textarea : null)),
    };
    // ttyd mounts xterm AFTER this file runs, so the document starts without
    // it - that ordering is the bug, not an edge case.
    let prevented = 0;
    let threw = '';
    const intervals = [];
    try {
      // eslint-disable-next-line no-new-func
      new Function('window', 'document', 'KeyboardEvent', 'performance', 'setInterval', 'clearInterval', 'requestAnimationFrame', TOUCH_SCROLL_JS)(
        { addEventListener: () => {} },
        doc,
        function KeyboardEvent(type, init) { this.type = type; Object.assign(this, init); },
        { now: () => clock },
        (fn) => { intervals.push(fn); return intervals.length; },
        () => {},
        () => 1,
      );
    } catch (e) { threw = String(e.message); }
    check(`the touch bridge installs${threw ? ` — ${threw}` : ''}`, threw === '');
    check('nothing is bound before the terminal mounts', Object.keys(handlers).length === 0);
    mounted = true;
    for (const t of intervals) t();
    check('the bridge binds once the terminal mounts',
      !!handlers.touchstart && !!handlers.touchmove && !!handlers.touchend);

    const down = (c) => keys.filter((k) => k.type === 'keydown' && k.keyCode === c);
    const up = (c) => keys.filter((k) => k.type === 'keydown' && k.keyCode === c);
    const reset = () => { handlers.touchend({}); clock += 1000; };
    const drag = (from, to, steps = 1) => {
      handlers.touchstart({ touches: [{ clientY: from }] });
      for (let i = 1; i <= steps; i += 1) {
        handlers.touchmove({ touches: [{ clientY: from + (to - from) * (i / steps) }], preventDefault() { prevented += 1; } });
        clock += 5;
      }
    };

    // A tap must not scroll and must not swallow the tap.
    const t0 = keys.length;
    handlers.touchstart({ touches: [{ clientY: 600 }] });
    handlers.touchmove({ touches: [{ clientY: 594 }], preventDefault() { prevented += 1; } });
    check('a small nudge does not scroll', keys.length === t0);
    check('a nudge is not taken off the page', prevented === 0);

    // Fine granularity: a LINE of travel emits the line keys, not a page key.
    // A page key is a WHOLE screen, so keying on pagePx made any drag feel
    // like a few full-screen jumps however far the finger travelled. linePx is
    // 18px, so a 300px drag crosses ~16 lines (capped at MAX_LINE_KEYS per
    // touchmove, paced to LINE_COOLDOWN_MS).
    reset();
    let b = keys.length;
    drag(600, 300, 6);
    const fineDown = keys.slice(b).filter((k) => k.type === 'keydown');
    // Per gesture step the bridge sends BOTH lanes' finest keys, because the
    // two binding sets are disjoint (opencode ctrl+alt, cline ctrl+meta) and
    // the bridge cannot know which lane is behind the terminal.
    const lineKeys = fineDown.filter((k) => k.key === 'e');
    const halfKeys = fineDown.filter((k) => k.key === 'd');
    check('an upward drag sends the opencode LINE key (ctrl+alt+e)',
      lineKeys.length >= 1 && lineKeys.every((k) => k.ctrlKey === true && k.altKey === true));
    check('...and the cline half-page key (ctrl+meta+d), since the bridge',
      halfKeys.length >= 1 && halfKeys.every((k) => k.ctrlKey === true && k.metaKey === true));
    check('the two lanes never both fire on one binding (disjoint modifiers)',
      lineKeys.every((k) => k.metaKey === false) && halfKeys.every((k) => k.altKey === false));
    check('a drag emits more steps than the old one-page-per-drag bridge',
      lineKeys.length >= 3, `only ${lineKeys.length} line keys`);
    check('one touchmove never floods (MAX_LINE_KEYS per move)',
      lineKeys.length <= 6 * 6);
    check('a key is released as well as pressed',
      keys.slice(b).some((k) => k.type === 'keyup' && k.key === 'e'));
    check('the drag is taken off the page once scrolling', prevented >= 1);
    check('NO bare page key is sent while the fine path works',
      fineDown.every((k) => k.key !== 'PageDown' && k.key !== 'PageUp'));

    // A tap smaller than one line must not scroll: a tap still types.
    // reset() first: drag() never sends touchend, so without it this gesture
    // inherits the previous one's y0 and reads as a huge jump.
    reset();
    const t1 = keys.length;
    handlers.touchstart({ touches: [{ clientY: 600 }] });
    handlers.touchmove({ touches: [{ clientY: 594 }], preventDefault() { prevented += 1; } });
    check('a sub-line nudge does not scroll', keys.length === t1);

    // Up: the opposite direction sends y / u, not e / d.
    reset();
    b = keys.length;
    drag(300, 600, 6);
    const fineUp = keys.slice(b).filter((k) => k.type === 'keydown');
    check('a downward drag sends the opencode line key (ctrl+alt+y)',
      fineUp.some((k) => k.key === 'y' && k.ctrlKey === true && k.altKey === true));
    check('...and the cline half-page key (ctrl+meta+u)',
      fineUp.some((k) => k.key === 'u' && k.ctrlKey === true && k.metaKey === true));

    // Multi-touch is left alone so pinch-zoom survives.
    reset();
    b = keys.length;
    handlers.touchstart({ touches: [{ clientY: 100 }, { clientY: 200 }] });
    handlers.touchmove({ touches: [{ clientY: 0 }, { clientY: 300 }], preventDefault() { prevented += 1; } });
    check('multi-touch is left alone', keys.length === b);

    // A flick adds momentum, capped.
    reset();
    b = keys.length;
    handlers.touchstart({ touches: [{ clientY: 600 }] });
    handlers.touchmove({ touches: [{ clientY: 560 }], preventDefault() { prevented += 1; } });
    handlers.touchend({});
    check('a flick adds momentum, capped at six steps',
      keys.slice(b).filter((k) => k.type === 'keydown').length <= 6);
  }

  // 12a7. The bridge binds on EVERY renderer, and there is a reason it is
  //       worth stating because getting it wrong cost a phone its scrolling.
  //
  //       A previous pass added a stand-down: "on a DOM-rendered terminal the
  //       browser scrolls natively, so unbind". That reasoning was WRONG.
  //       opencode runs in ALT-SCREEN mode — the TUI owns the screen and
  //       repaints in place — so there is no document flow and no scrollback to
  //       scroll. Measured live: viewport scrollHeight == clientHeight, body
  //       overflow hidden, wheel and PageUp change nothing. The DOM renderer
  //       changes how text is PAINTED, not what is scrollable, and the bridge
  //       is not competing with native scroll: it IS the scroll.
  //
  //       So this now pins the opposite: both renderers must keep the bridge.
  //       If someone re-adds a renderer-conditional unbind, this goes red.
  {
    const runShim = (renderer) => {
      const bound = {};
      const rows = { children: [1, 2, 3] };
      const screenEl = {
        clientWidth: 360, clientHeight: 700,
        querySelector: (sel) => (sel === 'canvas'
          ? (renderer === 'canvas' ? {} : null)
          : (sel === '.xterm-rows' ? rows : null)),
        addEventListener: (ev, fn) => { bound[ev] = fn; },
        removeEventListener: () => {},
      };
      const doc = { querySelector: (s) => (s === '.xterm-screen' ? screenEl : null) };
      const timers = [];
      new Function('window', 'document', 'KeyboardEvent', 'performance', 'setInterval', 'clearInterval', 'requestAnimationFrame', TOUCH_SCROLL_JS)(
        { addEventListener: () => {} }, doc,
        function KeyboardEvent(type, init) { this.type = type; Object.assign(this, init); },
        { now: () => 1000 },
        (fn) => { timers.push(fn); return timers.length; }, () => {}, () => 1,
      );
      for (const t of timers) t();
      return bound;
    };
    check('a canvas-rendered terminal gets the drag bridge', !!runShim('canvas').touchmove);
    check('a DOM-rendered terminal STILL gets it (alt-screen has no native scroll)',
      !!runShim('dom').touchmove);
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

  // A third agent (the standalone Grok TG router) opens the same door, so the
  // route table is extensible from the deployment env instead of hardcoded. A
  // typo must register nothing rather than proxy somewhere unexpected.
  const THIRD = { TUI_ROUTE_GROK_TG_PATH: '/ttyg/' };
  check('a registered bot gets its own page route',
    ttydRoutes(THIRD)['/ttyg/']?.bot === 'grok_tg' && ttydRoutes(THIRD)['/ttyg']?.bot === 'grok_tg');
  check('a registered bot lands on its own path', ttydPathFor('grok_tg', THIRD) === '/ttyg/');
  check('its socket-token route is derived, not hand-kept',
    tokenRoutes(THIRD)['/ttyg/token'] === 'grok_tg');
  check('the built-ins survive the extension',
    ttydRoutes(THIRD)['/tty/']?.bot === 'vm' && tokenRoutes(THIRD)['/tty2/token'] === 'vm2');
  check('a path with no leading slash registers nothing',
    !Object.values(ttydRoutes({ TUI_ROUTE_X_PATH: 'ttyx/' })).some((r) => r.bot === 'x'));
  check('the bare root is refused',
    !Object.values(ttydRoutes({ TUI_ROUTE_X_PATH: '/' })).some((r) => r.bot === 'x'));
}

// 14. The page door is per-bot. A vm token on /tty2/ (and vice versa) is
//     refused even though the token itself is valid — otherwise the sessions
//     map the attach script reads would belong to the wrong bot. The same
//     check runs for a bot registered from the env: its own page opens, an
//     unregistered path does not, and the built-ins are untouched.
{
  const serveRegistered = async (path, env, bot) => {
    const ttyd = http.createServer((rq, rs) => {
      rs.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      rs.end('<html><body>registered</body></html>');
    });
    await new Promise((r) => ttyd.listen(0, '127.0.0.1', r));
    const full = {
      ...env,
      TUI_GATEWAY_SECRET: SECRET,
      TUI_BOT_TOKEN_GROK_TG: TOKEN,
      TUI_BOT_TOKEN_VM: TOKEN,
      TUI_TTYD_URL: `http://127.0.0.1:${ttyd.address().port}`,
      TUI_TTYD_URL_GROK_TG: `http://127.0.0.1:${ttyd.address().port}`,
      TUI_TTYD_CREDENTIAL: Buffer.from('tui:x').toString('base64'),
    };
    const token = issueToken({ botId: bot, chatId: '6218257274', secret: SECRET, ttlSec: 900 });
    const handle = createGateway({ env: full, log: () => {} });
    const code = await new Promise((resolve, reject) => {
      const res = { writeHead: (c) => resolve(c), end: () => {} };
      handle({ method: 'GET', url: path,
        headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` } }, res).catch(reject);
    });
    ttyd.close();
    return code;
  };
  const ENV = { TUI_ROUTE_GROK_TG_PATH: '/ttyg/' };
  check('a registered bot opens its own page', await serveRegistered('/ttyg/', ENV, 'grok_tg') === 200);
  check('a registered bot gets its socket-token route', await serveRegistered('/ttyg/token', ENV, 'grok_tg') === 200);
  check('the unregistered twin path is still 404', await serveRegistered('/ttyg2/', {}, 'grok_tg') === 404);
  // Registering a bot must not change what the built-ins already served.
  check('the vm page still opens', await serveRegistered('/tty/', ENV, 'vm') === 200);
}

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

// Cookieless browser TUI: a plain browser holds no gateway cookie, and the
// ttyd client's ./token fetch carries no query token of its own — but every
// request carries the landed page URL as same-host Referer, and a verified
// ?token= on the TUI root deep-links to its own terminal path (live
// 2026-10-05: headless cookieless page loaded, socket died on a 401 ./token).
{
  const CRED = Buffer.from('tui:x').toString('base64');
  const env = {
    TUI_GATEWAY_SECRET: SECRET,
    TUI_BOT_ID: 'vm',
    TUI_BOT_TOKEN_VM: TOKEN,
    TUI_BOT_TOKEN_VM2: TOKEN,
    TUI_TTYD_URL: 'http://127.0.0.1:1',
    TUI_TTYD_CREDENTIAL: CRED,
  };
  const token = issueToken({ botId: 'vm', chatId: '6218257274', secret: SECRET, ttlSec: 900 });
  const refOf = `https://t.example/?token=${encodeURIComponent(token)}`;
  const call = (url, headers) => new Promise((resolve, reject) => {
    let code = 0; let hh = {};
    const res = {
      writeHead: (c, h) => { code = c; hh = h || {}; },
      write: () => true,
      end: () => resolve({ code, h: hh }),
    };
    createGateway({ env, log: () => {} })(
      { method: 'GET', url, headers, [Symbol.asyncIterator]: async function* () {} }, res).catch(reject);
    setTimeout(() => resolve({ code: -2 }), 5000).unref?.();
  });
  const noCookie = { host: 't.example', referer: refOf };
  check('a cookieless socket token with a page referer is admitted',
    (await call('/tty/token', noCookie)).code === 200);
  check('a foreign referer gets no socket token',
    (await call('/tty/token', { host: 't.example', referer: `https://evil.test/?token=${encodeURIComponent(token)}` })).code === 401);
  check('authz stays strict by design (Caddy consumes the response, not the browser)',
    (await call('/authz', noCookie)).code === 401);
  check('authz still admits the socket query token Caddy forwards',
    (await call(`/authz?token=${encodeURIComponent(token)}`, { host: 't.example' })).code === 204);
  check('an expired page referer renews the socket token within grace',
    await (async () => {
      const old = issueToken({ botId: 'vm', chatId: '6218257274', secret: SECRET, ttlSec: 900, now: Date.now() - 1020000 });
      const r = await call('/tty/token', { host: 't.example', referer: `https://t.example/?token=${encodeURIComponent(old)}` });
      return r.code === 200 && String(r.h['set-cookie'] || '').includes(COOKIE_NAME);
    })());
  check('a tokened TUI root deep-links to the terminal path, never the bootstrap',
    await (async () => {
      const r = await call(`/?token=${encodeURIComponent(token)}`, { host: 't.example' });
      return r.code === 302 && String(r.h.location || '').startsWith('/tty/')
        && String(r.h['set-cookie'] || '').includes(COOKIE_NAME);
    })());
  check('a bare TUI root still gets the cold bootstrap',
    await (async () => {
      const chunks = [];
      const code = await new Promise((resolve, reject) => {
        const res = { writeHead: (c) => resolve(c), write: (c) => { chunks.push(Buffer.from(c)); return true; }, end: () => {} };
        createGateway({ env, log: () => {} })(
          { method: 'GET', url: '/', headers: { host: 't.example' }, [Symbol.asyncIterator]: async function* () {} }, res).catch(reject);
        setTimeout(() => resolve(-2), 5000).unref?.();
      });
      return code === 200;
    })());
  check('the fallback prefers direct tokens and otherwise needs the referer',
    verifyWithRefererFallback({ headers: { host: 't.example', cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` } }, new URL('http://x/'), SECRET).ok === true
    && verifyWithRefererFallback({ headers: { host: 't.example', referer: refOf } }, new URL('http://x/'), SECRET).ok === true
    && verifyWithRefererFallback({ headers: { host: 't.example' } }, new URL('http://x/'), SECRET).ok === false);
}

// 12. The bot forge mounted under /forge: the gateway owns the hostname and the
// door, and the creation is the injected handler — the gateway never learns how
// to create a bot, so there is still one creation path.
{
  const seen = [];
  const forge = async (rq, rs) => {
    seen.push(rq.url);
    rs.writeHead(200, { 'content-type': 'application/json' });
    rs.end(JSON.stringify({ ok: true, mounted: true }));
    return true;
  };
  const handle = createGateway({ env: { TUI_GATEWAY_SECRET: SECRET }, log: () => {}, forge });
  const forged = await new Promise((resolve) => {
    const rs = { writeHead: (code, h) => resolve({ code, h: h || {} }), end: () => resolve({ code: 0, h: {} }) };
    handle({ method: 'POST', url: '/forge/api/forge', headers: {} }, rs).catch(() => {});
    setTimeout(() => resolve({ code: 0, h: {} }), 2000).unref?.();
  });
  check('the forge handler is reached under /forge', seen.length === 1 && seen[0] === '/forge/api/forge');
  check('the mounted forge answers', forged.code === 200);

  const handledPaths = seen.length;
  const other = await new Promise((resolve) => {
    const rs = { writeHead: (code) => resolve({ code }), end: () => resolve({ code: 0 }) };
    handle({ method: 'GET', url: '/nope', headers: {} }, rs).catch(() => {});
    setTimeout(() => resolve({ code: 0 }), 2000).unref?.();
  });
  check('the forge does not shadow non-forge paths', seen.length === handledPaths && other.code === 404);

  const bare = createGateway({ env: { TUI_GATEWAY_SECRET: SECRET }, log: () => {} });
  const noForge = await new Promise((resolve) => {
    const rs = { writeHead: (code) => resolve({ code }), end: () => resolve({ code: 0 }) };
    bare({ method: 'GET', url: '/forge', headers: {} }, rs).catch(() => {});
    setTimeout(() => resolve({ code: 0 }), 2000).unref?.();
  });
  check('no forge on this host is a 404, not a crash', noForge.code === 404);
}

// 13. The forge door is THIS gateway's door: initData against its own token set.
{
  const env = { TUI_BOT_TOKEN_VM: TOKEN };
  const good = authorizeForgeAtGateway({ initData: makeInitData(fresh()), env, now });
  check('the forge door admits a fleet bot initData', good.ok === true && /^initData:vm$/.test(good.via));
  check('the forge door refuses no initData', authorizeForgeAtGateway({ initData: '', env, now }).ok === false);
  const forged = `${makeInitData(fresh()).split('&hash=')[0]}&hash=${'0'.repeat(64)}`;
  check('the forge door refuses a forged hash', authorizeForgeAtGateway({ initData: forged, env, now }).ok === false);
  const otherKey = crypto.createHmac('sha256', 'WebAppData').update('987654:OTHER-BOT-TOKEN').digest();
  check('the forge door refuses a token this gateway does not hold', authorizeForgeAtGateway({ initData: makeInitData(fresh(), { secretKey: otherKey }), env, now }).ok === false);
}

// 14. The opencode web UI host (split solution): the whole host past the
//     Telegram door proxies to serve with the serve credential substituted,
//     so a browser never holds it. Live 2026-10-04: the first wiring proxied
//     Caddy straight at serve, whose door answered {"ok":false,"error":"bad
//     token"} with no way to ever log in — the gateway must own the exchange.
{
  const hostOf = (h) => ({ host: h });
  check('the web host matches, case-insensitively, port stripped',
    isWebUiHost({ headers: hostOf('Web.Test:443') }, { OPENCODE_WEB_HOST: 'web.test' }) === true);
  check('the tui host is not the web host',
    isWebUiHost({ headers: hostOf('tui.health-tracker.co.uk') }, { OPENCODE_WEB_HOST: 'web.test' }) === false);
  check('no host header is not the web host',
    isWebUiHost({ headers: {} }, {}) === false);
  check('the default web host is the served one',
    webUiHost({}) === 'web.health-tracker.co.uk');
  check('the serve credential is composed as Basic, never bare',
    webUiAuthHeader({ OPENCODE_WEB_PASSWORD: 'pw' }) === `Basic ${Buffer.from('opencode:pw').toString('base64')}`
    && !webUiAuthHeader({ OPENCODE_WEB_PASSWORD: 'pw' }).includes('pw:'));
  check('no serve password means no header (503 downstream, never anonymous)',
    webUiAuthHeader({}) === '');

  // Through the handler against a stub serve: the stub records what the
  // gateway sent upstream, so the credential substitution is proven, not
  // asserted from source.
  const seen = [];
  const serve = http.createServer((rq, rs) => {
    let body = '';
    rq.on('data', (c) => { body += c; });
    rq.on('end', () => {
      seen.push({ url: rq.url, auth: rq.headers.authorization || '' });
      if (String(rq.url || '').startsWith('/api/session')) {
        rs.writeHead(200, { 'content-type': 'application/json' });
        return rs.end('[{"id":"ses_test"}]');
      }
      rs.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      rs.end('<html><body>serve index</body></html>');
    });
  });
  await new Promise((r) => serve.listen(0, '127.0.0.1', r));
  const sport = serve.address().port;
  const wenv = {
    TUI_GATEWAY_SECRET: SECRET,
    TUI_BOT_TOKEN_VM: TOKEN,
    OPENCODE_WEB_HOST: 'web.test',
    OPENCODE_WEB_UPSTREAM: `http://127.0.0.1:${sport}`,
    OPENCODE_WEB_PASSWORD: 'servepw',
  };
  const whandle = createGateway({ env: wenv, log: () => {} });
  const call = (url, headers) => new Promise((resolve) => {
    // proxyPass iterates the request body, so the stub must be async-iterable.
    const req = {
      method: 'GET', url, headers: headers || {},
      [Symbol.asyncIterator]: async function* () {},
    };
    const res = {};
    // capture writeHead+end together: stash code, resolve on end.
    // proxyPass streams via res.write with byte chunks, so the stub decodes.
    let code = 0; let hh = {}; const chunks = [];
    res.writeHead = (c, h) => { code = c; hh = h || {}; };
    res.write = (c) => { chunks.push(Buffer.from(c)); return true; };
    res.end = (body) => { if (body) chunks.push(Buffer.from(body)); resolve({ code, h: hh, body: Buffer.concat(chunks).toString('utf8') }); };
    whandle(req, res).catch(() => resolve({ code: -1 }));
    setTimeout(() => resolve({ code: -2 }), 5000).unref?.();
  });
  const wtoken = issueToken({ botId: 'vm', chatId: '6218257274', secret: SECRET, ttlSec: 900 });
  const wcookie = { host: 'web.test', cookie: `${COOKIE_NAME}=${encodeURIComponent(wtoken)}` };

  const refused = await call('/api/session', { host: 'web.test' });
  check('the web host without a token is refused, not proxied',
    refused.code === 401 && refused.body.includes('bad token') && seen.length === 0);

  const page = await call('/', wcookie);
  check('a cookied token on the web host reaches serve, not the bootstrap',
    page.code === 200 && page.body.includes('serve index'));

  const api = await call('/api/session?directory=/x', { host: 'web.test', cookie: `${COOKIE_NAME}=${encodeURIComponent(wtoken)}` });
  check('the api path and query survive the proxy',
    api.code === 200 && api.body.includes('ses_test') && seen.some((s) => s.url === '/api/session?directory=/x'));
  check('serve sees Basic, never the gateway token or nothing',
    seen.filter((s) => s.url.startsWith('/api')).every((s) => s.auth === `Basic ${Buffer.from('opencode:servepw').toString('base64')}`));

  const exch = await new Promise((resolve) => {
    const res = { writeHead: (c, h) => resolve({ code: c, h: h || {} }), end: () => {} };
    const initData = makeInitData(fresh());
    whandle({ method: 'GET', url: `/?bot=vm&initData=${encodeURIComponent(initData)}`, headers: { host: 'web.test' } }, res)
      .catch(() => resolve({ code: -1 }));
    setTimeout(() => resolve({ code: -2 }), 5000).unref?.();
  });
  check('the web exchange lands back on / with a token, never on a ttyd path',
    exch.code === 302 && String(exch.h.location || '').startsWith('/?token='));

  const tuiRoot = await call('/', { host: 'tui.health-tracker.co.uk', cookie: `${COOKIE_NAME}=${encodeURIComponent(wtoken)}` });
  check('a tokened TUI root deep-links to its own terminal path (bot isolation kept)',
    tuiRoot.code === 302 && String(tuiRoot.h.location || '').startsWith('/tty/')
    && !tuiRoot.body.includes('serve index'));

  // Cookie planting: subresource requests carry no token of their own, so a
  // token-authed proxy plants the presented token as the cookie — otherwise
  // every asset 401s one by one (live 2026-10-05: the whole SPA failed to
  // boot in a cookie-swallowing WebView).
  const planted = await (() => new Promise((resolve) => {
    const res = {};
    let code = 0; let hh = {}; const chunks = [];
    res.writeHead = (c, h) => { code = c; hh = h || {}; };
    res.write = (c) => { chunks.push(Buffer.from(c)); return true; };
    res.end = (body) => { if (body) chunks.push(Buffer.from(body)); resolve({ code, h: hh, body: Buffer.concat(chunks).toString('utf8') }); };
    const req = {
      method: 'GET', url: `/?token=${encodeURIComponent(wtoken)}`,
      headers: { host: 'web.test' },
      [Symbol.asyncIterator]: async function* () {},
    };
    whandle(req, res).catch(() => resolve({ code: -1 }));
    setTimeout(() => resolve({ code: -2 }), 5000).unref?.();
  }))();
  check('a token-authed page plants the cookie for subresources',
    planted.code === 200 && String(planted.h['set-cookie'] || '').includes(encodeURIComponent(wtoken)));
  check('an already-cookied proxy does not replant',
    await (async () => {
      let setCookie = null;
      await new Promise((resolve) => {
        const res = {};
        res.writeHead = (c, h) => { setCookie = h?.['set-cookie'] || null; };
        res.write = () => true;
        res.end = () => resolve();
        const req = {
          method: 'GET', url: `/?token=${encodeURIComponent(wtoken)}`,
          headers: { host: 'web.test', cookie: `${COOKIE_NAME}=${encodeURIComponent(wtoken)}` },
          [Symbol.asyncIterator]: async function* () {},
        };
        whandle(req, res).catch(() => resolve());
        setTimeout(resolve, 5000).unref?.();
      });
      return setCookie === null;
    })());
  // Cookieless shim (live 2026-10-05: shell rendered "home" but stuck
  // loading — WebViews swallow Set-Cookie entirely, so /api/* 401s forever).
  // The gateway token authenticates AT the gateway; serve must never see it.
  check('the gateway token is stripped before reaching serve',
    seen.some((s) => s.url === '/') && !seen.some((s) => s.url.includes(encodeURIComponent(wtoken).slice(0, 12))));
  check('a directory query survives while the token is stripped',
    await (async () => {
      seen.length = 0;
      const r = await call(`/api/session?directory=/x&token=${encodeURIComponent(wtoken)}`, { host: 'web.test' });
      return r.code === 200 && seen.some((s) => s.url === '/api/session?directory=/x');
    })());
  check('a query-tokened api call passes without any cookie (the shim path)',
    await (async () => {
      const r = await call(`/api/session?token=${encodeURIComponent(wtoken)}`, { host: 'web.test' });
      return r.code === 200 && r.body.includes('ses_test');
    })());
  check('the shim persists the token and re-attaches it same-origin only',
    webAuthShimJs().includes(WEB_AUTH_STORAGE_KEY)
    && webAuthShimJs().includes('sessionStorage')
    && webAuthShimJs().includes('EventSource')
    && webAuthShimJs().includes('location.origin')
    && !webAuthShimJs().includes('telegram.org'));
  check('web/token renews a live token with a fresh cookie',
    await (async () => {
      const r = await call(`/web/token?token=${encodeURIComponent(wtoken)}`, { host: 'web.test' });
      const body = JSON.parse(r.body);
      return r.code === 200 && body.ok === true && typeof body.token === 'string'
        && body.token !== wtoken && String(r.h['set-cookie'] || '').includes(COOKIE_NAME);
    })());
  check('web/token refuses a garbage token',
    await (async () => {
      const r = await call('/web/token?token=garbage', { host: 'web.test' });
      return r.code === 401;
    })());
  check('the shim renews proactively on a timer',
    webAuthShimJs().includes('/web/token')
    && webAuthShimJs().includes('setInterval')
    && webAuthShimJs().includes('setTimeout'));
  check('the served html carries the shim before the bundle',
    planted.body.includes(WEB_AUTH_STORAGE_KEY)
    && planted.body.indexOf(WEB_AUTH_STORAGE_KEY) < planted.body.indexOf('serve index'));
  check('shim injection prefers head, falls back without one',
    injectWebAuthShim('<html><head><title>t</title></head><body>x</body></html>').includes(`<head>${webAuthShimJs()}`)
    && injectWebAuthShim('<html><body>x</body></html>').includes('<head>')
    && injectWebAuthShim('plain').startsWith('<script>'));
  check('upstream query keeps other params and drops only the token',
    webUpstreamQuery('?directory=/x&token=abc') === '?directory=/x'
    && webUpstreamQuery('?token=abc') === ''
    && webUpstreamQuery('') === ''
    && webUpstreamQuery('?directory=/x') === '?directory=/x');
  // Referer fallback (live 2026-10-05: cookieless phone polls /api/event
  // with no token anywhere the shim can attach — the parser-fired bundle
  // and worker clients only carry the page URL as Referer).
  const refOf = (token) => `https://web.test/?token=${encodeURIComponent(token)}`;
  check('a cookieless asset with a same-host referer token is admitted',
    await (async () => {
      const r = await call('/_assets/index-x.js', { host: 'web.test', referer: refOf(wtoken) });
      return r.code === 200;
    })());
  check('a cross-host referer token is refused, never proxied',
    await (async () => {
      const n = seen.length;
      const r = await call(`/api/session?x=1`, { host: 'web.test', referer: `https://evil.test/?token=${encodeURIComponent(wtoken)}` });
      return r.code === 401 && seen.length === n;
    })());
  check('a same-host referer without a token is refused',
    await (async () => {
      const r = await call('/api/session', { host: 'web.test', referer: 'https://web.test/?foo=1' });
      return r.code === 401;
    })());
  check('refererToken takes the page token same-host only, never values',
    refererToken({ headers: { host: 'web.test', referer: refOf(wtoken) } }) === wtoken
    && refererToken({ headers: { host: 'web.test', referer: 'https://evil.test/?token=abc' } }) === ''
    && refererToken({ headers: { host: 'web.test', referer: 'https://web.test/' } }) === ''
    && refererToken({ headers: { host: 'web.test' } }) === ''
    && refererToken({ headers: { host: 'web.test', referer: 'not a url' } }) === '');
  check('refusal shapes name channels, never values',
    describeWebRefusal({ headers: {} }, new URL('http://x/api/info')) === 'nocookie noreferer noquerytoken uastd'
    && describeWebRefusal({ headers: { 'user-agent': 'HeadlessChrome/120' } }, new URL('http://x/api/info')).includes('uaheadless')
    && describeWebRefusal({ headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120 Mobile Safari/537.36; wv)' } }, new URL('http://x/api/info')).includes('uawv')
    && describeWebRefusal({ headers: { host: 'web.test', referer: refOf(wtoken) } }, new URL('http://x/api/info')).includes('referertoken')
    && describeWebRefusal({ headers: { host: 'web.test', referer: 'https://evil.test/?token=abc' } }, new URL('http://x/api/info')).includes('refererforeign')
    && !describeWebRefusal({ headers: { host: 'web.test', referer: refOf(wtoken) } }, new URL('http://x/api/info')).includes(wtoken.slice(0, 8)));
  // Shim beacon: unauthenticated 204 that logs booleans only, plus the
  // request's own shape (proves whether the patched fetch attached).
  check('the diag beacon answers without auth and logs booleans only',
    await (async () => {
      let logged = '';
      const h = createGateway({ env: wenv, log: (m) => { logged += m + '\n'; } });
      const r = await new Promise((resolve) => {
        const res = {};
        res.writeHead = (c, hh) => { res.code = c; };
        res.end = () => resolve(res);
        const req = { method: 'GET', url: '/__shim_diag?u=1&s=0&p=1', headers: { host: 'web.test' }, [Symbol.asyncIterator]: async function* () {} };
        h(req, res).catch(() => resolve({ code: -1 }));
        setTimeout(() => resolve({ code: -2 }), 5000).unref?.();
      });
      return r.code === 204 && /shim-diag u=1 s=0 p=1/.test(logged) && !logged.includes(wtoken.slice(0, 8));
    })());
  check('the shim phones home once unpatched and once through the patch',
    webAuthShimJs().includes('/__shim_diag?u=') && webAuthShimJs().includes('&p=1') && webAuthShimJs().includes('keepalive'));
  check('the shim unregisters stale service workers',
    webAuthShimJs().includes('getRegistrations') && webAuthShimJs().includes('unregister'));
  // Static bypass (live 2026-10-05: parser-fired bundle + worker install run
  // outside every page patch, so gating public build output bricks the app).
  check('static build output is public code, data routes are not',
    isWebStatic('/_assets/index-x.js') && isWebStatic('/sw.js')
    && isWebStatic('/site.webmanifest') && isWebStatic('/favicon.ico')
    && isWebStatic('/icons/prod/favicon.ico')
    && !isWebStatic('/') && !isWebStatic('/api/session')
    && !isWebStatic('/api/event') && !isWebStatic('/__shim_diag'));
  check('dot-segment escape still lands behind the door',
    await (async () => {
      const n = seen.length;
      const r = await call('/_assets/../api/session', { host: 'web.test' });
      return r.code === 401 && seen.length === n;
    })());
  check('a credential-less bundle fetch reaches serve, stripped and Basic-only',
    await (async () => {
      seen.length = 0;
      const r = await call('/_assets/index-x.js', { host: 'web.test' });
      return r.code === 200 && seen.some((s) => s.url === '/_assets/index-x.js')
        && seen.every((s) => s.auth === `Basic ${Buffer.from('opencode:servepw').toString('base64')}`);
    })());
  check('proxied html clears site caches so no stale shell survives',
    planted.h['clear-site-data'] === '"cache"');
  serve.close();
}

// 15. The bag-audit host (META-1 P3.4): the whole host proxies to the
//     standalone :8892 app behind the shared door — never a sub-path,
//     because the app's /api/* paths are absolute and a sub-path mount
//     would break every call. Upstream auth (?k=/cookie/tgauth) untouched.
{
  const hostOf = (h) => ({ host: h });
  check('the tgtg host matches, case-insensitively, port stripped',
    isTgtgHost({ headers: hostOf('TGTG.Test:443') }, { TGTG_HOST: 'tgtg.test' }) === true);
  check('the tui host is not the tgtg host',
    isTgtgHost({ headers: hostOf('tui.health-tracker.co.uk') }, { TGTG_HOST: 'tgtg.test' }) === false);
  check('no host header is not the tgtg host',
    isTgtgHost({ headers: {} }, {}) === false);
  check('the default tgtg host is the served one',
    tgtgHost({}) === 'tgtg.health-tracker.co.uk');
  check('the default upstream is the same-box bag service',
    tgtgUpstream({}) === 'http://127.0.0.1:8892');

  // Through the handler against a stub bag app: the stub records the exact
  // URL it received, so passthrough (not rewriting) is proven.
  const seen = [];
  const bags = http.createServer((rq, rs) => {
    let body = '';
    rq.on('data', (c) => { body += c; });
    rq.on('end', () => {
      seen.push({ url: rq.url, cookie: rq.headers.cookie || '' });
      rs.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      rs.end('{"ok":true,"bags":[]}');
    });
  });
  await new Promise((r) => bags.listen(0, '127.0.0.1', r));
  const bport = bags.address().port;
  const benv = {
    TUI_GATEWAY_SECRET: SECRET,
    TUI_BOT_TOKEN_VM: TOKEN,
    TGTG_HOST: 'tgtg.test',
    TGTG_UPSTREAM: `http://127.0.0.1:${bport}`,
  };
  const bhandle = createGateway({ env: benv, log: () => {} });
  const call = (url, headers) => new Promise((resolve) => {
    const req = {
      method: 'GET', url, headers: headers || {},
      [Symbol.asyncIterator]: async function* () {},
    };
    const res = {};
    let code = 0; let hh = {}; const chunks = [];
    res.writeHead = (c, h) => { code = c; hh = h || {}; };
    res.write = (c) => { chunks.push(Buffer.from(c)); return true; };
    res.end = (body) => { if (body) chunks.push(Buffer.from(body)); resolve({ code, h: hh, body: Buffer.concat(chunks).toString('utf8') }); };
    bhandle(req, res).catch(() => resolve({ code: -1 }));
    setTimeout(() => resolve({ code: -2 }), 5000).unref?.();
  });
  const btoken = issueToken({ botId: 'vm', chatId: '6218257274', secret: SECRET, ttlSec: 900 });

  const refused = await call('/api/bags', { host: 'tgtg.test' });
  check('the tgtg host without a token is refused, never proxied',
    refused.code === 401 && seen.length === 0);

  const page = await call('/?k=abc123', { host: 'tgtg.test', cookie: `${COOKIE_NAME}=${encodeURIComponent(btoken)}` });
  check('a cookied token on the tgtg host reaches the bag app',
    page.code === 200 && page.body.includes('"bags"'));
  check('the viewer key passes through untouched (upstream auth owns it)',
    seen.some((s) => s.url === '/?k=abc123'));

  const api = await call(`/api/bags?token=${encodeURIComponent(btoken)}`, { host: 'tgtg.test' });
  check('absolute api paths survive the proxy with a query token',
    api.code === 200 && seen.some((s) => s.url === `/api/bags?token=${encodeURIComponent(btoken)}`));

  const n = seen.length;
  await call('/api/bags', { host: 'tui.health-tracker.co.uk', cookie: `${COOKIE_NAME}=${encodeURIComponent(btoken)}` });
  check('the same path on the tui host never reaches the bag app',
    seen.length === n);
  bags.close();
}

// 16. The agenda host (META-1 P3.5: calendar/agenda/stays): same whole-host
//     pattern. The app has no auth of its own, so the door is the only gate.
{
  const hostOf = (h) => ({ host: h });
  check('the agenda host matches, case-insensitively, port stripped',
    isAgendaHost({ headers: hostOf('Agenda.Test:443') }, { AGENDA_HOST: 'agenda.test' }) === true);
  check('the tui host is not the agenda host',
    isAgendaHost({ headers: hostOf('tui.health-tracker.co.uk') }, { AGENDA_HOST: 'agenda.test' }) === false);
  check('the tgtg host is not the agenda host',
    isAgendaHost({ headers: hostOf('tgtg.health-tracker.co.uk') }, { AGENDA_HOST: 'agenda.test', TGTG_HOST: 'tgtg.health-tracker.co.uk' }) === false);
  check('no host header is not the agenda host',
    isAgendaHost({ headers: {} }, {}) === false);
  check('the default agenda host is the served one',
    agendaHost({}) === 'agenda.health-tracker.co.uk');
  check('the default upstream is the same-box agenda service',
    agendaUpstream({}) === 'http://127.0.0.1:8895');

  const aseen = [];
  const agenda = http.createServer((rq, rs) => {
    let body = '';
    rq.on('data', (c) => { body += c; });
    rq.on('end', () => {
      aseen.push({ url: rq.url });
      rs.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      rs.end('{"ok":true,"events":[]}');
    });
  });
  await new Promise((r) => agenda.listen(0, '127.0.0.1', r));
  const aport = agenda.address().port;
  const aenv = {
    TUI_GATEWAY_SECRET: SECRET,
    TUI_BOT_TOKEN_VM: TOKEN,
    AGENDA_HOST: 'agenda.test',
    AGENDA_UPSTREAM: `http://127.0.0.1:${aport}`,
  };
  const ahandle = createGateway({ env: aenv, log: () => {} });
  const acall = (url, headers) => new Promise((resolve) => {
    const req = {
      method: 'GET', url, headers: headers || {},
      [Symbol.asyncIterator]: async function* () {},
    };
    const res = {};
    let code = 0; let hh = {}; const chunks = [];
    res.writeHead = (c, h) => { code = c; hh = h || {}; };
    res.write = (c) => { chunks.push(Buffer.from(c)); return true; };
    res.end = (body) => { if (body) chunks.push(Buffer.from(body)); resolve({ code, h: hh, body: Buffer.concat(chunks).toString('utf8') }); };
    ahandle(req, res).catch(() => resolve({ code: -1 }));
    setTimeout(() => resolve({ code: -2 }), 5000).unref?.();
  });
  const atoken = issueToken({ botId: 'vm', chatId: '6218257274', secret: SECRET, ttlSec: 900 });

  const arefused = await acall('/api/agenda', { host: 'agenda.test' });
  check('the agenda host without a token is refused, never proxied',
    arefused.code === 401 && aseen.length === 0);

  const agendaPage = await acall('/api/agenda', { host: 'agenda.test', cookie: `${COOKIE_NAME}=${encodeURIComponent(atoken)}` });
  check('a cookied token on the agenda host reaches the agenda app',
    agendaPage.code === 200 && agendaPage.body.includes('"events"') && aseen.some((s) => s.url === '/api/agenda'));

  const an = aseen.length;
  await acall('/api/agenda', { host: 'tgtg.test', cookie: `${COOKIE_NAME}=${encodeURIComponent(atoken)}` });
  check('the agenda api on the tgtg host stays on its own branch',
    aseen.length === an);
  agenda.close();
}

// 17. The TUI session browser (META-1 P3.6): read-only list plus the one
//     snapshot write, both bot-bound. Fixture state root — no tmux, no VPS.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-sessions-'));
  const now = Date.now();
  const vm = path.join(tmp, 'vm');
  fs.mkdirSync(vm, { recursive: true });
  fs.writeFileSync(path.join(vm, 'sessions.json'), JSON.stringify({
    '111': 'ses_AAA',
    '222': 'WS\u0000ses_BBB',
  }));
  fs.writeFileSync(path.join(vm, 'cline-sessions.json'), JSON.stringify({ '333': '1700000000_ab12' }));
  fs.writeFileSync(path.join(vm, 'prefs.json'), JSON.stringify({
    '111': { model: 'opencode/m1' },
    '333': { model: 'cline:cline-free/m2' },
  }));
  fs.writeFileSync(path.join(vm, 'leases.json'), JSON.stringify({ '111': { startedAt: now } }));
  fs.writeFileSync(path.join(vm, 'tui-open.json'), JSON.stringify({
    chatId: '222', surface: 'opencode', model: 'opencode/m1',
    sessionId: 'ses_BBB', workspace: 'WS', at: new Date(now).toISOString(),
  }));
  fs.writeFileSync(path.join(vm, 'tui-lease.json'), JSON.stringify({
    session: 'ses_AAA', heartbeat: now, pane: 'VM-tui', bot: 'vm', clients: 1, since: 0,
  }));

  const senv = { TUI_GATEWAY_SECRET: SECRET, TUI_BOT_TOKEN_VM: TOKEN, TUI_STATE_ROOT: tmp };
  const shandle = createGateway({ env: senv, log: () => {} });
  const server = http.createServer(shandle);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const sbase = `http://127.0.0.1:${server.address().port}`;
  const stoken = issueToken({ botId: 'vm', chatId: '111', secret: SECRET, ttlSec: 900 });
  const scookie = `${COOKIE_NAME}=${encodeURIComponent(stoken)}`;
  try {
    const list = await (await fetch(`${sbase}/tui/api/sessions?bot=vm`, { headers: { cookie: scookie } })).json();
    check('the list admits a same-bot token and shows every lane',
      list.ok === true && Array.isArray(list.chats) && list.chats.length === 3);
    const byId = Object.fromEntries((list.chats || []).map((c) => [c.chatId, c]));
    check('an opencode row carries its session and a held lease',
      byId['111']?.surface === 'opencode' && byId['111']?.sessionId === 'ses_AAA' && byId['111']?.leaseHeld === true);
    check('a workspace-scoped row splits workspace from session',
      byId['222']?.sessionId === 'ses_BBB' && byId['222']?.workspace === 'WS');
    check('a cline row follows the live lane, not the snapshot',
      byId['333']?.surface === 'cline' && byId['333']?.sessionId === '1700000000_ab12');
    check('a fresh heartbeat reads as open now',
      list.openNow?.pane === 'VM-tui');

    const open = await (await fetch(`${sbase}/tui/api/open?bot=vm`, {
      method: 'POST', headers: { cookie: scookie, 'content-type': 'application/json' },
      body: JSON.stringify({ chat: '111' }),
    })).json();
    check('open snapshots the chat the map resolves',
      open.ok === true && open.chatId === '111' && open.sessionId === 'ses_AAA');
    const written = JSON.parse(fs.readFileSync(path.join(vm, 'tui-open.json'), 'utf8'));
    check('the snapshot lands on disk in the /tui shape',
      written.chatId === '111' && written.surface === 'opencode' && typeof written.at === 'string');

    const miss = await fetch(`${sbase}/tui/api/open?bot=vm`, {
      method: 'POST', headers: { cookie: scookie, 'content-type': 'application/json' },
      body: JSON.stringify({ chat: '999' }),
    });
    check('a sessionless opencode chat refuses instead of a blank row',
      miss.status === 409);

    const cross = await fetch(`${sbase}/tui/api/sessions?bot=vm2`, { headers: { cookie: scookie } });
    check('a token bound to another bot cannot read this map',
      cross.status === 401);
    const anon = await fetch(`${sbase}/tui/api/sessions?bot=vm`);
    check('the list refuses without a token',
      anon.status === 401);
    const nobot = await fetch(`${sbase}/tui/api/sessions`, { headers: { cookie: scookie } });
    check('the list requires the bot',
      nobot.status === 400);

    const page = await fetch(`${sbase}/tui/sessions`, { headers: { cookie: scookie } });
    check('the browser page serves behind the door',
      page.status === 200 && (await page.text()).includes('Terminal sessions'));
    const pageAnon = await fetch(`${sbase}/tui/sessions`);
    check('the browser page refuses without a token',
      pageAnon.status === 401);
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 18. The meta shell landing (META-1 P4): bot-agnostic exchange into
//     /app/app, served from the app upstream build. No bot default —
//     without ?bot= the bootstrap says so instead of guessing.
{
  const botToken = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
  const secret = 'gateway-test-secret-12345';
  const env = { TUI_GATEWAY_SECRET: secret, TUI_BOT_TOKEN_VM: botToken };
  const handle = createGateway({ env });
  const server = http.createServer(handle);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const bare = await fetch(`${base}/app/`, { redirect: 'manual' });
    assert.equal(bare.status, 200);
    assert.ok((await bare.text()).includes('opening the mini app'));

    const botKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const validInitData = makeInitData(fresh(), { secretKey: botKey });
    const good = await fetch(`${base}/app/?bot=vm&initData=${encodeURIComponent(validInitData)}`, { redirect: 'manual' });
    assert.equal(good.status, 302);
    assert.ok((good.headers.get('location') || '').startsWith('/app/app?token='));

    const badInitData = validInitData.replace(/hash=[a-f0-9]{10}/, 'hash=deadbeef00');
    const bad = await fetch(`${base}/app/?bot=vm&initData=${encodeURIComponent(badInitData)}`, { redirect: 'manual' });
    assert.equal(bad.status, 401);

    const noapp = await fetch(`${base}/app/app`);
    assert.equal(noapp.status, 401);
  } finally {
    server.close();
  }
}

// 19. Browser Firebase exchange (META-1): missing body is 400, a bogus
//     token is 401 without reaching Google (fails local decode). The live
//     verify path is exercised on VPS throwaway with a real session.
{
  const secret = 'gateway-test-secret-12345';
  const env = { TUI_GATEWAY_SECRET: secret, TUI_BOT_TOKEN_VM: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ' };
  const handle = createGateway({ env });
  const server = http.createServer(handle);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const empty = await fetch(`${base}/app/auth/firebase`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(empty.status, 400);

    const bogus = await fetch(`${base}/app/auth/firebase`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: 'garbage' }),
    });
    assert.equal(bogus.status, 401);
    assert.equal((await bogus.json()).ok, false);
  } finally {
    server.close();
  }
}

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
