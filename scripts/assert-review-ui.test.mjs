/**
 * assert-review-ui.test.mjs — the /review page's interaction contract, in a real
 * browser (the blink class of bug is invisible to a string assertion).
 *
 * WHY A BROWSER SENSOR
 * --------------------
 * The first build re-rendered the whole item with `innerHTML` on every tab tap.
 * The tap therefore rebuilt `<img src=...>`, and the proof shot blinked out and
 * back — a defect no `html.includes('...')` check can see, because the markup
 * was correct and only the *transition* was wrong. These checks drive the page
 * and assert on live DOM state:
 *
 *   1. the proof `<img>` node is the SAME node across a tab round-trip (no
 *      rebuild, so no reload blink)
 *   2. the image owns the majority of the screen (stage taller than the info card)
 *   3. exactly three one-word tabs, and no send button in the DOM
 *   4. Enter posts a comment; Shift+Enter only inserts a newline
 *   5. the target toggle decides which sheet column the comment goes to
 *   6. multiple shots per item: the counter tracks the swipe and each shot has
 *      its own fetch
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
const PAGE = path.join(ROOT, 'src', 'miniapp', 'review.html');

// A 1x1 PNG and a 2x1 PNG: different intrinsic sizes, so the fixture cannot
// pass by accident on one hardcoded dimension.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PNG_4x2 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNkYPj/n4GBgYGJAQoAHgQCAf6O8b8AAAAASUVORK5CYII=',
  'base64',
);

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
    answers: [
      {
        id: 'ans-0',
        name: 'human-review-20261004-091200-screen.png',
        mimeType: 'image/png',
        text: 'the mobile pane is blank in this shot',
        target: 'left',
        at: '2026-10-04T09:12:00.000Z',
      },
    ],
  },
  {
    row: 3,
    key: 'req:test-b',
    ref: 'R-2',
    originalRequest: 'Other work',
    workDone: 'Working',
    whatsLeft: 'one more pass',
    owner: 'agent-b',
    status: 'review',
    proof: '',
    gate: '',
    lastActivity: '12:05 - 2 oct (UK)',
    proofs: [],
    answers: [],
  },
];

/** Boot the real gateway + the real page with only the Google seam stubbed. */
async function withPage(fn) {
  const env = { TUI_GATEWAY_SECRET: 'ui-sensor-secret', TUI_BOT_TOKEN_VM: 'x', REVIEW_TEST_AUTH: '1' };
  const server = http.createServer(createGateway({ env, log: () => {} }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    server.close();
    return null; // playwright absent — the string-level sensor still covers the markup
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const posts = [];
  const answers = [];
  const proofFetches = [];
  await page.route('**/review/api/state**', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, google: true, items: QUEUE }),
  }));
  await page.route('**/review/api/proof*', (r) => {
    const id = new URL(r.request().url()).searchParams.get('file') || '';
    proofFetches.push(id);
    return r.fulfill({ status: 200, contentType: 'image/png', body: id === 'file-0' ? PNG_1x1 : PNG_4x2 });
  });
  await page.route('**/review/api/comment*', (route) => {
    posts.push(JSON.parse(route.request().postData() || '{}'));
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, key: QUEUE[0].key, target: posts[posts.length - 1].target, stamped: '[human 3 Oct] ' + posts[posts.length - 1].text }),
    });
  });
  await page.route('**/review/api/approve*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }),
  }));
  await page.route('**/review/api/answer*', (route) => {
    const sent = JSON.parse(route.request().postData() || '{}');
    answers.push(sent);
    const name = `human-review-20261004-101010-${(sent.image && sent.image.name) || 'picture'}.png`;
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true, key: sent.key, target: sent.target, uploaded: name,
        stamped: `[human 4 Oct] ${sent.text || ''} — see ${name}`,
      }),
    });
  });

  try {
    await page.goto(`${base}/review/app?token=x`);
    await page.waitForSelector('.stage img');
    return await fn({ page, base, posts, answers, proofFetches });
  } finally {
    await browser.close();
    server.close();
  }
}

test('tab taps do not rebuild the image node (the blink)', async (t) => {
  const ran = await withPage(async ({ page }) => {
    const kept = await page.evaluate(async () => {
      const img = document.querySelector('.stage img');
      for (const name of ['request', 'todo', 'info', 'request', 'info']) {
        document.querySelector(`#tabs button[data-tab="${name}"]`).click();
        await new Promise((r) => setTimeout(r, 60));
      }
      return document.querySelector('.stage img') === img;
    });
    assert.equal(kept, true, 'the same <img> node must survive every tab tap');
  });
  if (ran === null) t.skip('playwright not installed');
});

test('the image owns the majority of the screen on every tab', async (t) => {
  const ran = await withPage(async ({ page }) => {
    for (const name of ['info', 'request', 'todo']) {
      await page.click(`#tabs button[data-tab="${name}"]`);
      await page.waitForTimeout(80);
      const h = await page.evaluate(() => {
        const info = document.querySelector('.view[data-view="info"]');
        const stage = document.querySelector('.stage');
        return {
          info: info ? info.getBoundingClientRect().height : 0,
          stage: stage ? stage.getBoundingClientRect().height : 0,
          viewport: window.innerHeight,
        };
      });
      if (name === 'info') {
        assert.ok(h.stage > h.viewport * 0.4, `info: stage ${h.stage} should be >40% of ${h.viewport}`);
        assert.ok(h.stage > h.info, 'image stage must be taller than the info card');
      } else {
        // Text tabs replace the stage with a full-height scrollable pane.
        const textH = await page.evaluate(() => {
          const v = document.querySelector('.view[data-view="request"].on, .view[data-view="todo"].on');
          return v ? Math.round(v.getBoundingClientRect().height) : 0;
        });
        assert.ok(textH > h.viewport * 0.6, `${name}: text view ${textH} should fill >60% of ${h.viewport}`);
      }
    }
  });
  if (ran === null) t.skip('playwright not installed');
});

test('four one-word tabs (Info/Request/To do/Answer), a heart, and no send button', async (t) => {
  const ran = await withPage(async ({ page }) => {
    const tabs = await page.$$eval('#tabs button', (bs) => bs.map((b) => ({
      label: (b.textContent || '').replace(/[\u00a0\s]+/g, ' ').trim(),
      tab: b.getAttribute('data-tab'),
    })));
    // Answer sits next to To do: the reader's own verdict belongs beside the
    // work list it is a verdict on.
    assert.deepEqual(tabs.map((x) => x.tab), ['info', 'request', 'todo', 'answer']);
    for (const x of tabs) assert.match(x.label, /^[\w ]+$/, `tab label is one word: ${x.label}`);
    assert.ok(await page.$('.heart'), 'heart button present');
    assert.equal(await page.$('.btn-send'), null, 'no send button');
  });
  if (ran === null) t.skip('playwright not installed');
});

test('To do shows the Whats-left column and names it; Request shows the request column', async (t) => {
  const ran = await withPage(async ({ page }) => {
    await page.click('#tabs button[data-tab="todo"]');
    await page.waitForTimeout(80);
    const todo = await page.textContent('.view[data-view="todo"]');
    assert.match(todo, /What\u2019s left to do/, 'the tab names the column it shows');
    // Item 2 of the queue is the one with a What's-left value.
    await page.click('#btn-next');
    await page.click('#tabs button[data-tab="todo"]');
    await page.waitForTimeout(80);
    const todo2 = await page.textContent('.view[data-view="todo"]');
    assert.match(todo2, /one more pass/, 'the column content is on screen');
    await page.click('#tabs button[data-tab="request"]');
    await page.waitForTimeout(80);
    const req = await page.textContent('.view[data-view="request"]');
    assert.match(req, /Original request/);
    assert.match(req, /Other work/);
  });
  if (ran === null) t.skip('playwright not installed');
});

test('Answer shows the picture with the words the human wrote', async (t) => {
  const ran = await withPage(async ({ page, proofFetches }) => {
    await page.click('#tabs button[data-tab="answer"]');
    await page.waitForTimeout(120);
    const card = await page.textContent('.answers');
    assert.match(card, /the mobile pane is blank in this shot/, 'the note rides with the picture');
    assert.match(card, /What\u2019s left to do/, 'and says which column it went to');
    assert.ok(proofFetches.includes('ans-0'), 'the answer image is fetched through the guarded proof route');
    assert.equal(await page.$$eval('.answers img', (i) => i.length), 1);

    // An item with nothing sent back says so instead of showing nothing.
    await page.click('#btn-next');
    await page.click('#tabs button[data-tab="answer"]');
    await page.waitForTimeout(120);
    const none = await page.textContent('.answers');
    assert.match(none, /Nothing sent back yet/);
  });
  if (ran === null) t.skip('playwright not installed');
});

test('a picture attaches and Enter sends it as an answer with the note', async (t) => {
  const ran = await withPage(async ({ page, answers, posts }) => {
    // 1. No picture, no words: nothing is sent.
    await page.click('#comment');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    assert.equal(answers.length, 0);
    assert.equal(posts.length, 0);

    // 2. A picture alone is a valid answer (pointing at the shot is the message).
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNkYPj/n4GBgYGJAQoAHgQCAf6O8b8AAAAASUVORK5CYII=',
      'base64',
    );
    await page.setInputFiles('#file', { name: 'mobile pane.png', mimeType: 'image/png', buffer: png });
    await page.waitForFunction(() => !document.getElementById('attachment').hidden, null, { timeout: 5000 });
    assert.equal(await page.isVisible('#attachment'), true, 'the attachment is previewed before sending');
    assert.match(await page.textContent('#attach-name'), /mobile pane/);
    await page.click('#comment');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/review/api/answer'), { timeout: 5000 }),
      page.keyboard.press('Enter'),
    ]);
    await page.waitForFunction(() => document.getElementById('attachment').hidden, null, { timeout: 5000 });
    assert.equal(answers.length, 1, 'the picture went to the answer endpoint');
    assert.equal(answers[0].key, 'req:test-a');
    assert.equal(answers[0].target, 'left');
    assert.ok(answers[0].image && answers[0].image.data, 'the bytes rode along');
    assert.match(answers[0].image.data, /^[A-Za-z0-9+/=]+$/, 'base64, not a data: prefix');
    assert.equal(await page.isVisible('#attachment'), false, 'the preview clears after a send');

    // 3. It shows up in the Answer tab immediately, without a page reload.
    await page.click('#tabs button[data-tab="answer"]');
    await page.waitForTimeout(120);
    const card = await page.textContent('.answers');
    assert.match(card, /Your answers/);
    assert.equal(await page.$$eval('.answers img', (i) => i.length), 2, 'the new picture is there too');
  });
  if (ran === null) t.skip('playwright not installed');
});

test('a non-picture or an oversize picture is refused before any send', async (t) => {
  const ran = await withPage(async ({ page, answers }) => {
    await page.setInputFiles('#file', {
      name: 'notes.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4'),
    });
    await page.waitForTimeout(250);
    assert.equal(await page.isVisible('#attachment'), false, 'a PDF is not an answer picture');
    assert.match(await page.textContent('.toast'), /Only a picture/);
    assert.equal(answers.length, 0);
  });
  if (ran === null) t.skip('playwright not installed');
});

test('Enter posts, Shift+Enter only breaks the line, and the target picks the column', async (t) => {
  const ran = await withPage(async ({ page, posts }) => {
    await page.click('#comment');
    await page.keyboard.type('proof shows the old text');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].target, 'left', 'default target is What-is-left');
    assert.equal(posts[0].key, 'req:test-a');

    // The sent line lands in the pane it was aimed at, without a rebuild.
    const inTodo = await page.evaluate(() => (document.getElementById('pane-todo') || {}).textContent || '');
    assert.match(inTodo, /proof shows the old text/);

    // Shift+Enter is a newline, not a send.
    await page.click('#comment');
    await page.keyboard.type('line one');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('line two');
    assert.equal(posts.length, 1, 'Shift+Enter must not post');
    const value = await page.inputValue('#comment');
    assert.match(value, /line one\nline two/);

    // Toggle to Original request and send again — the toggle must hand the
    // keyboard back, or the Enter lands on the pill and nothing is sent.
    await page.click('#target button[data-target="original"]');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    assert.equal(posts.length, 2);
    assert.equal(posts[1].target, 'original');
    const inRequest = await page.evaluate(() => (document.getElementById('pane-request') || {}).textContent || '');
    assert.match(inRequest, /line one\nline two/);

    // An empty composer does not post.
    await page.click('#comment');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    assert.equal(posts.length, 2, 'empty Enter must not post');
  });
  if (ran === null) t.skip('playwright not installed');
});

test('multiple shots per item: one fetch each, and the counter follows the swipe', async (t) => {
  const ran = await withPage(async ({ page, proofFetches }) => {
    const count = await page.textContent('#imgcount');
    assert.equal(count, '1/3');
    assert.equal(await page.$$eval('.stage img', (i) => i.length), 3, 'all three shots are in the DOM');
    assert.ok(proofFetches.includes('file-0'), 'shot 1 fetched');
    assert.ok(proofFetches.includes('file-2'), 'shot 3 fetched');

    // Swiping between shots is no longer native scrolling (the track is
    // transformed and every gesture is ours), so it is driven by real touch
    // in scripts/assert-review-gestures.test.mjs — which also proves the
    // counter moves. What is unique here is the fetch-per-shot and the copy.
    assert.equal(await page.textContent('#imgcount'), '1/3', 'the counter reads 1/N at rest');

    // A single-shot item shows no fraction.
    await page.click('#btn-next');
    await page.waitForTimeout(150);
    assert.match(await page.textContent('.count, .noproof') || '', /no proof|1 shot/i);
  });
  if (ran === null) t.skip('playwright not installed');
});

test('the heart confirms once, then archives', async (t) => {
  const ran = await withPage(async ({ page }) => {
    let approves = 0;
    await page.route('**/review/api/approve*', (route) => {
      approves += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    // On the landing (image) view the heart is the one-tap done action.
    assert.equal(await page.textContent('#pos'), '1/2', 'two items to start');
    await page.click('#heart');
    await page.waitForTimeout(250);
    assert.equal(approves, 1, 'one tap on the image view archives');
    assert.equal(await page.textContent('#pos'), '1/1', 'the archived item left the queue');
    const shown = await page.textContent('.kv .key');
    assert.match(shown, /req:test-b/, 'the next item is now showing');
  });
  if (ran === null) t.skip('playwright not installed');
});