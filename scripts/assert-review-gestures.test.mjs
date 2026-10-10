/**
 * assert-review-gestures.test.mjs — the picture is browsed with fingers, and
 * Info folds away so the picture gets the whole area.
 *
 * WHY A TOUCH SENSOR
 * ------------------
 * Pinch, pan, swipe and a collapse toggle are all "does it feel right" claims
 * that no markup assertion can judge. These drive the real page in real
 * Chromium with real touch events (CDP `Input.dispatchTouchEvent`), because a
 * one-pointer swipe and a two-pointer pinch take different code paths and only
 * the second one is the point of this file.
 *
 * WHAT IT ASSERTS
 *   0. Request lands first: the request text with the result screenshot
 *      directly below it — the point of truth every review starts from.
 *   1. tapping Info shows the card over the stage; tapping it again folds
 *      it and the picture takes the WHOLE panel area
 *      (stage height == panel height)
 *   2. one finger on an un-zoomed picture swipes to the next shot (counter)
 *   3. two fingers pinch the picture larger (the <img> transform scale grows)
 *   4. once zoomed, one finger pans instead of swiping (offset changes, the
 *      slide does not change) and the offset is clamped to the picture
 *   5. a double tap zooms in on the point and back out
 *   6. the Info toggle never rebuilds the picture node (the blink stays fixed)
 *
 * The gateway is mounted with REVIEW_TEST_AUTH and the Google seam is stubbed at
 * the HTTP boundary, so nothing here touches the real sheet or Drive.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGateway } from './tui-gateway.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
void ROOT;

/**
 * Real-sized PNGs, built here rather than committed as binaries: a proof
 * screenshot is hundreds of pixels wide, and a 4x2 fixture has no pannable
 * area, so it would pass a pan test that the real page cannot satisfy (the
 * clamp correctly pins a picture that is smaller than its frame).
 */
function png(width, height, rgb) {
  const zlib = require$('node:zlib');
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const i = rowStart + 1 + x * 3;
      raw[i] = (rgb[0] + x) % 256;
      raw[i + 1] = (rgb[1] + y) % 256;
      raw[i + 2] = rgb[2];
    }
  }
  const crcTable = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

import { createRequire } from 'node:module';
const require$ = createRequire(import.meta.url);

// A tall phone-sized shot (fits the frame at scale 1) and a wider one.
const PNG_TALL = png(300, 700, [10, 20, 30]);
const PNG_WIDE = png(700, 300, [40, 50, 60]);

const QUEUE = [
  {
    row: 2,
    key: 'req:test-a',
    ref: 'R-1',
    originalRequest: 'Build the thing',
    workDone: 'Built it, sensor green',
    whatsLeft: '',
    owner: 'agent-a',
    status: 'review',
    proof: 'p',
    gate: 'sensor green + screenshot',
    lastActivity: '12:00 - 2 oct (UK)',
    proofs: [
      { id: 'file-0', name: 'shot-one.png', mimeType: 'image/png' },
      { id: 'file-1', name: 'shot-two.png', mimeType: 'image/png' },
      { id: 'file-2', name: 'shot-three.png', mimeType: 'image/png' },
    ],
  },
];

/** Real Chromium, real touch; only the Google seam is stubbed. */
async function withPage(fn) {
  const env = { TUI_GATEWAY_SECRET: 'gesture-secret', TUI_BOT_TOKEN_VM: 'x', REVIEW_TEST_AUTH: '1' };
  const server = http.createServer(createGateway({ env, log: () => {} }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    server.close();
    return null;
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 420, height: 900 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  await page.route('**/review/api/state**', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, google: true, items: QUEUE }),
  }));
  await page.route('**/review/api/proof**', (route) => {
    const id = new URL(route.request().url()).searchParams.get('file') || '';
    return route.fulfill({ status: 200, contentType: 'image/png', body: id === 'file-0' ? PNG_TALL : PNG_WIDE });
  });
  await page.route('**/review/api/comment**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, key: QUEUE[0].key, target: 'left', stamped: '[human 3 Oct] hi' }),
  }));
  await page.route('**/review/api/approve**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }),
  }));

  /** One finger: down → moves → up. */
  async function swipe(from, to, steps = 8) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from.x, y: from.y, id: 1 }],
    });
    for (let i = 1; i <= steps; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps, id: 1 }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  /** Two fingers: pinch from `from` spacing to `to` spacing. */
  async function pinch(cx, cy, fromGap, toGap, steps = 8) {
    const at = (gap, i) => {
      const half = gap / 2;
      return [
        { x: cx - half, y: cy, id: 1 },
        { x: cx + half, y: cy, id: i },
      ];
    };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(fromGap, 2) });
    for (let i = 1; i <= steps; i += 1) {
      const gap = fromGap + ((toGap - fromGap) * i) / steps;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(gap, 2) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  async function doubleTap(x, y) {
    for (let k = 0; k < 2; k += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      if (k === 0) await page.waitForTimeout(60);
    }
  }

  /** The ON-SCREEN picture's own transform, read as scale + offset. */
  const shot = () => page.evaluate(() => {
    const track = document.getElementById('track');
    const slide = track.querySelectorAll('.slide')[Number(track.dataset.slide || 0)];
    const m = new DOMMatrixReadOnly(getComputedStyle(slide.querySelector('img')).transform);
    return { scale: m.a, x: m.e, y: m.f };
  });

  const heights = () => page.evaluate(() => {
    const panel = document.getElementById('panel');
    const info = document.querySelector('.view[data-view="info"]');
    const stage = document.querySelector('.stage');
    return {
      panel: Math.round(panel.getBoundingClientRect().height),
      info: info && !info.hidden ? Math.round(info.getBoundingClientRect().height) : 0,
      stage: stage ? Math.round(stage.getBoundingClientRect().height) : 0,
    };
  });

  try {
    await page.goto(`${base}/review/app?token=x`);
    // Landing contract: the Request tab opens first (request text with the
    // result screenshot below it). The swipeable stage is two Info taps
    // away: open the card over it, fold it back, picture full-bleed.
    await page.waitForSelector('.view[data-view="request"].on');
    await page.waitForTimeout(200);
    async function fullBleed() {
      await page.click('#tabs button[data-tab="info"]');
      await page.waitForTimeout(80);
      await page.click('#tabs button[data-tab="info"]');
      await page.waitForTimeout(80);
    }
    return await fn({ page, swipe, pinch, doubleTap, shot, heights, cdp, fullBleed });
  } finally {
    await browser.close();
    server.close();
  }
}

test('Request lands first with the result below; Info folds the card over the picture', async (t) => {
  const ran = await withPage(async ({ page, heights }) => {
    const requestOn = await page.$eval('.view[data-view="request"]', (v) => v.classList.contains('on'));
    assert.equal(requestOn, true, 'the Request tab opens first');
    const resultSrc = await page.$eval('.view[data-view="request"] .result img', (img) => img.getAttribute('src') || '');
    assert.match(resultSrc, /\/review\/api\/proof/, 'the result screenshot rides below the request');
    const landed = await heights();
    assert.equal(landed.info, 0, 'no card open on landing');

    await page.click('#tabs button[data-tab="info"]');
    await page.waitForTimeout(80);
    const open = await heights();
    assert.ok(open.info > 0, 'one tap opens the card over the stage');
    assert.ok(open.stage < open.panel, 'and the picture gives up the room it needs');

    await page.click('#tabs button[data-tab="info"]');
    await page.waitForTimeout(80);
    const closed = await heights();
    assert.equal(closed.info, 0, 'a second tap folds it again');
    assert.equal(closed.stage, closed.panel, 'the picture takes the whole area back');

    // And the tab read as off once folded, so a reader can see the state.
    const on = await page.$$eval('#tabs button', (bs) => bs.filter((b) => b.classList.contains('on')).length);
    assert.equal(on, 0);
  });
  if (ran === null) t.skip('playwright not installed');
});

test('one finger swipes between shots; two fingers pinch to zoom', async (t) => {
  const ran = await withPage(async ({ page, swipe, pinch, shot, fullBleed }) => {
    await fullBleed();
    // 1. Swipe left → next shot.
    assert.equal(await page.textContent('#imgcount'), '1/3');
    await swipe({ x: 340, y: 430 }, { x: 60, y: 430 });
    await page.waitForTimeout(320);
    assert.equal(await page.textContent('#imgcount'), '2/3', 'a one-finger swipe changes shot');

    // 2. Pinch out → the picture grows.
    const before = await shot();
    await pinch(210, 430, 80, 320);
    await page.waitForTimeout(120);
    const after = await shot();
    assert.ok(after.scale > before.scale + 0.2, `pinch must zoom in: ${before.scale} -> ${after.scale}`);

    // 3. Pinch in → back toward fit.
    await pinch(210, 430, 320, 60);
    await page.waitForTimeout(120);
    const back = await shot();
    assert.ok(back.scale < after.scale, `pinch must zoom out: ${after.scale} -> ${back.scale}`);
  });
  if (ran === null) t.skip('playwright not installed');
});

test('zoomed in, one finger pans instead of swiping, and stays clamped', async (t) => {
  const ran = await withPage(async ({ page, swipe, pinch, shot, fullBleed }) => {
    await fullBleed();
    await pinch(210, 430, 80, 340);
    await page.waitForTimeout(120);
    const zoomed = await shot();
    assert.ok(zoomed.scale > 1.2, 'zoomed first');

    // A swipe attempt while zoomed must NOT change the shot.
    const countBefore = await page.textContent('#imgcount');
    await swipe({ x: 340, y: 430 }, { x: 40, y: 430 });
    await page.waitForTimeout(320);
    assert.equal(await page.textContent('#imgcount'), countBefore, 'a pan must not swipe');

    // Drag the other way and the offset must change, then stay in bounds.
    await swipe({ x: 80, y: 430 }, { x: 300, y: 430 });
    await page.waitForTimeout(120);
    const panned = await shot();
    assert.notEqual(Math.round(panned.x), Math.round(zoomed.x), 'the picture moved');

    // Far past any sane offset: clamped, so it cannot leave its own frame.
    for (let i = 0; i < 6; i += 1) await swipe({ x: 300, y: 430 }, { x: 30, y: 430 }, 4);
    await page.waitForTimeout(150);
    const far = await shot();
    const bounds = await page.evaluate(() => {
      const track = document.getElementById('track');
      const box = track.querySelectorAll('.slide')[Number(track.dataset.slide || 0)];
      const img = box.querySelector('img');
      return { maxX: Math.abs(img.offsetWidth * 0 + (img.offsetWidth - box.clientWidth) / 2),
        maxY: Math.abs((img.offsetHeight - box.clientHeight) / 2), w: img.offsetWidth, h: img.offsetHeight, vw: box.clientWidth, vh: box.clientHeight };
    });
    const maxX = Math.max(0, (bounds.w * far.scale - bounds.vw) / 2) + 1;
    const maxY = Math.max(0, (bounds.h * far.scale - bounds.vh) / 2) + 1;
    assert.ok(Math.abs(far.x) <= maxX + 1, `x offset ${far.x} must stay within ${maxX}`);
    assert.ok(Math.abs(far.y) <= maxY + 1, `y offset ${far.y} must stay within ${maxY}`);
    void bounds;
  });
  if (ran === null) t.skip('playwright not installed');
});

test('a double tap zooms on that point and a second double tap returns to fit', async (t) => {
  const ran = await withPage(async ({ page, doubleTap, shot, fullBleed }) => {
    await fullBleed();
    const fit = await shot();
    await doubleTap(120, 300);
    await page.waitForTimeout(140);
    const inZoom = await shot();
    assert.ok(inZoom.scale > fit.scale + 0.5, `double tap zooms: ${fit.scale} -> ${inZoom.scale}`);

    await doubleTap(120, 300);
    await page.waitForTimeout(140);
    const out = await shot();
    assert.ok(Math.abs(out.scale - 1) < 0.05, `double tap again returns to fit, got ${out.scale}`);
  });
  if (ran === null) t.skip('playwright not installed');
});

test('zooming never rebuilds the picture node (the blink stays fixed)', async (t) => {
  const ran = await withPage(async ({ page, pinch, doubleTap, fullBleed }) => {
    await fullBleed();
    const kept = await page.evaluate(async () => {
      const img = document.querySelector('.slide img');
      document.querySelector('#tabs button[data-tab="info"]').click();
      await new Promise((r) => setTimeout(r, 120));
      document.querySelector('#tabs button[data-tab="info"]').click();
      await new Promise((r) => setTimeout(r, 120));
      return document.querySelector('.slide img') === img;
    });
    assert.equal(kept, true, 'the Info toggle must not rebuild the image');
    await pinch(210, 430, 80, 300);
    await page.waitForTimeout(120);
    await doubleTap(210, 430);
    await page.waitForTimeout(120);
    const nodes = await page.evaluate(() => document.querySelectorAll('.slide img').length);
    assert.equal(nodes, 3, 'all three shots stay in the DOM across gestures');
  });
  if (ran === null) t.skip('playwright not installed');
});