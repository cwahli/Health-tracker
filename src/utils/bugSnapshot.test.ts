import { describe, it, expect } from 'vitest';
import {
  sanitizePathSegment,
  bugTagR2Prefix,
  bugReportR2Prefix,
  bugShotKey,
  cleanBugLogText,
  budgetPayloadForDigest,
  buildBugTriageSystemPrompt,
  buildBugTriageUserPrompt,
  briefFromTag,
  parseDataUrl,
  bugArtifactUrl,
  evidencePhotoSrc,
  canFileBugForProfile,
  bugReportShotFields,
  bugShotExt,
  bugShotContentType,
  bugShotName,
  buildBugEvidenceText,
  originFromHeaders,
  BUG_SNAPSHOT_MAX_SHOTS,
} from './bugSnapshot';

describe('bugSnapshot', () => {
  it('builds stable R2 keys under bugs/', () => {
    expect(bugTagR2Prefix('foodcart', 'tag-1')).toBe('bugs/foodcart/tag-1');
    expect(bugReportR2Prefix('foodcart', 'tag-1', 'rep-2')).toContain('bugs/foodcart/tag-1/reports/rep-2');
    expect(bugShotKey('foodcart', 'tag-1', 'rep-2', 1)).toBe(
      'bugs/foodcart/tag-1/reports/rep-2/shot-01.jpg'
    );
    expect(sanitizePathSegment('a/b c!')).toMatch(/^a_b_c/);
  });

  it('evidence photos go through /api/bugs artifacts, not raw R2 keys', () => {
    const key = 'bugs/Home/tag-1/reports/rep-2/shot-01.jpg';
    expect(evidencePhotoSrc('tag-1', key)).toContain('/api/bugs/tag-1/artifacts');
    expect(evidencePhotoSrc('tag-1', key)).toContain('reportId=rep-2');
    expect(evidencePhotoSrc('tag-1', key)).toContain('key=bugs%2FHome');
    expect(bugArtifactUrl('tag-1', 'rep-2', 'payload.json')).toContain('name=payload.json');
  });

  it('caps shots constant', () => {
    expect(BUG_SNAPSHOT_MAX_SHOTS).toBeLessThanOrEqual(5);
  });

  it('cleanBugLogText collapses USDA candidates and caps size', () => {
    const lines = ['start', '=== VERIFIED DATABASE MATCHES ==='];
    for (let i = 0; i < 50; i++) lines.push(`- [USDA] item ${i}`);
    lines.push('after');
    const cleaned = cleanBugLogText(lines.join('\n'), 5000);
    expect(cleaned).toContain('candidates omitted');
    expect(cleaned).not.toContain('- [USDA] item 40');
    expect(cleaned).toContain('after');
  });

  it('budgetPayloadForDigest keeps macros and truncates', () => {
    const payload = {
      mode: 'review',
      pendingFoodLog: {
        name: 'Test meal',
        nutrients: { calories: 500, protein: 20, carbohydrates: 40 },
        itemsBreakdown: [{ originalName: 'rice', weightGrams: 100, calories: 130 }],
        receiptTable: [{ item: 'rice', source: 'USDA', notes: 'ok' }],
      },
      pipelineErrors: [{ message: 'boom' }],
    };
    const s = budgetPayloadForDigest(payload);
    expect(s).toContain('Test meal');
    expect(s).toContain('500');
    expect(s).toContain('rice');
    expect(s).toContain('pipelineErrors');
  });

  it('builds triage prompts with a11y-first for all agents', () => {
    const sys = buildBugTriageSystemPrompt();
    expect(sys).toContain('Symptom');
    expect(sys).toContain('Suspected layer');
    expect(sys).toMatch(/Accessibility tree|a11y/i);
    expect(sys).toMatch(/ALL models|all agents/i);
    const user = buildBugTriageUserPrompt({
      tagTitle: 'Wrong calories',
      category: 'foodcart',
      userSymptom: 'shows 0 kcal',
      logs: 'error line',
      a11yText: '- [dialog] "Food result"',
      domainPackJson: '{"domain":"food","food":{"nutrients":{"calories":0}}}',
    });
    expect(user).toContain('Wrong calories');
    expect(user).toContain('0 kcal');
    expect(user).toContain('PRIMARY structure');
    expect(user.indexOf('Accessibility')).toBeLessThan(user.indexOf('Logs'));
    expect(user).toContain('domain":"food"');
  });

  it('briefFromTag is small and stable', () => {
    const b = briefFromTag({
      id: 't1',
      title: 'Bug',
      category: 'biomarker',
      identified_problems: '## Symptom\nx',
      whats_still_open: 'fix UI',
      linked_count: 2,
    });
    expect(b.identified_problems).toContain('Symptom');
    expect(b.r2_prefix).toBe('bugs/biomarker/t1');
    expect(b.public_id).toBeTruthy();
    expect(b.queue).toBe('ready');
  });

  it('parseDataUrl', () => {
    const p = parseDataUrl('data:image/jpeg;base64,abc123');
    expect(p?.contentType).toBe('image/jpeg');
    expect(p?.base64).toBe('abc123');
    expect(parseDataUrl('nope')).toBeNull();
  });

  it('a Standard phone profile can file a bug — the gate is not the admin check', () => {
    expect(canFileBugForProfile({ userType: 'Standard' })).toBe(true);
    expect(canFileBugForProfile({ userType: 'Admin' })).toBe(true);
    expect(canFileBugForProfile({})).toBe(true);
  });

  it('a Demo profile and a signed-out session cannot file a bug', () => {
    expect(canFileBugForProfile({ userType: 'Demo' })).toBe(false);
    expect(canFileBugForProfile(null)).toBe(false);
    expect(canFileBugForProfile(undefined)).toBe(false);
  });

  it('an attached screenshot gets the exact fields the report reader looks for', () => {
    // GET /api/bugs/:tagId derives shot_count from `shot_count` and falls back to
    // `r2_shots.length`, and serves the image from r2_prefix + reportId. If an
    // intake path writes anything else the image is invisible on the ticket.
    const f = bugReportShotFields({
      category: 'foodcart',
      tagId: 'tag-1',
      reportId: 'iss-9',
      contentType: 'image/jpeg',
      shotKey: bugShotKey('foodcart', 'tag-1', 'iss-9', 1, 'jpg'),
      url: 'https://pub.example/bugs/foodcart/tag-1/reports/iss-9/shot-01.jpg',
      ok: true,
    });
    expect(f.reportId).toBe('iss-9');
    expect(f.r2_prefix).toBe('bugs/foodcart/tag-1/reports/iss-9');
    expect(f.shot_count).toBe(1);
    expect((f.r2_shots as any[])[0].key).toBe('bugs/foodcart/tag-1/reports/iss-9/shot-01.jpg');
  });

  it('a failed upload reports zero shots and says why — never a key that 404s', () => {
    const f = bugReportShotFields({
      category: 'foodcart',
      tagId: 'tag-1',
      reportId: 'iss-9',
      contentType: 'image/jpeg',
      shotKey: 'bugs/foodcart/tag-1/reports/iss-9/shot-01.jpg',
      ok: false,
      error: 'r2_credentials_missing',
    });
    // The reader falls back to shot_count ?? r2_shots.length ?? 0, so leaving
    // both unset is what makes an absent image read as absent.
    expect(f.shot_count).toBeUndefined();
    expect(f.r2_shots).toBeUndefined();
    expect(f.shot_upload_error).toBe('r2_credentials_missing');
    expect(f.r2_prefix).toBeTruthy();
  });

  it('bugShotExt normalises to png-or-jpg, matching what the artifacts route serves', () => {
    // The snapshot path has only ever written png/jpg and the artifacts route
    // only treats those as images — a webp name would fall through to the text
    // reader and hand binary bytes to a UTF-8 decode.
    expect(bugShotExt('image/jpeg')).toBe('jpg');
    expect(bugShotExt('image/png')).toBe('png');
    expect(bugShotExt('image/webp')).toBe('jpg');
    expect(bugShotExt('')).toBe('jpg');
    expect(bugShotContentType('png')).toBe('image/png');
    expect(bugShotContentType('jpg')).toBe('image/jpeg');
  });

  it('bugShotName pulls the exact stored filename out of an R2 key', () => {
    expect(bugShotName('bugs/foodcart/tag-1/reports/iss-9/shot-01.jpg')).toBe('shot-01.jpg');
    expect(bugShotName('bugs/foodcart/tag-1/reports/iss-9/shot-02.png')).toBe('shot-02.png');
    expect(bugShotName('shot-01.jpg')).toBe('shot-01.jpg');
  });

  it('the digest scrub removes BOTH screenshot fields, so a duplicate cannot leak', () => {    // FlagIssueModal used to send the same base64 as screenshot_data and
    // screenshot_url while the scrub only removed the first, so a full-size copy
    // always survived into the digest.
    const out = budgetPayloadForDigest({
      keep: 'me',
      screenshot_data: 'data:image/jpeg;base64,AAAA',
      screenshot_url: 'data:image/jpeg;base64,AAAA',
    });
    expect(out).toContain('keep');
    expect(out).not.toContain('screenshot_data');
    expect(out).not.toContain('screenshot_url');
    expect(out).not.toContain('base64');
  });
  it('the TEXT packet names its screenshots — this is what /resume prints', () => {
    // Regression shape: the text form carried no evidence at all, so a card with
    // a screenshot read as having none in every plain-text surface.
    const text = buildBugEvidenceText({
      tagId: 'tag-1',
      reports: [{ id: 'iss-9', reportId: 'iss-9', shot_count: 1 }],
    });
    expect(text).toContain('## Evidence');
    expect(text).toContain('Screenshots (1)');
    // Must be a fetchable artifacts URL, never a raw bugs/... R2 key.
    expect(text).toContain('/api/bugs/tag-1/artifacts?');
    expect(text).toContain('shot-01.jpg');
    expect(text).not.toMatch(/https?:\/\/[^\s]*r2\.dev\/bugs\//);
  });

  it('absolutises screenshot URLs when given an origin — a chat cannot resolve /api', () => {
    // Regression shape from #303: the text packet printed a relative
    // /api/bugs/... path, which is dead text in Telegram /resume and unusable
    // from any other host. Relative stays the default so the in-app browser
    // rendering is unchanged.
    const rel = buildBugEvidenceText({ tagId: 'tag-1', reports: [{ id: 'iss-9', reportId: 'iss-9', shot_count: 1 }] });
    expect(rel).toContain('/api/bugs/tag-1/artifacts?');
    expect(rel).not.toMatch(/shot 1: https?:\/\//);

    const abs = buildBugEvidenceText({
      tagId: 'tag-1',
      reports: [{ id: 'iss-9', reportId: 'iss-9', shot_count: 1 }],
      origin: 'https://health-tracker.co.uk',
    });
    expect(abs).toContain('https://health-tracker.co.uk/api/bugs/tag-1/artifacts?');
    expect(abs).toMatch(/shot 1: https:\/\/[^\s]+\/api\/bugs\//);
  });

  it('tolerates a trailing slash or blank origin without doubling it up', () => {
    for (const origin of ['https://h.example/', 'https://h.example', '', null, undefined]) {
      const t = buildBugEvidenceText({
        tagId: 't',
        reports: [{ id: 'i', reportId: 'i', shot_count: 1 }],
        origin: origin as any,
      });
      expect(t).not.toContain('//api');
      expect(t).toContain('/api/bugs/t/artifacts?');
    }
  });

  it('derives the link origin from the request, honouring the tunnel proxy', () => {
    // The deploy sits behind a cloudflared tunnel, so req.protocol alone reports
    // http and would hand out http links behind https. x-forwarded-proto wins.
    expect(originFromHeaders({ host: 'h.example' }, 'https')).toBe('https://h.example');
    expect(originFromHeaders({ host: 'h.example', 'x-forwarded-proto': 'https,http' }, 'http')).toBe('https://h.example');
    expect(originFromHeaders({ host: '127.0.0.1:3000' }, 'http')).toBe('http://127.0.0.1:3000');
    // An ephemeral quick-tunnel hostname changes per reconnect: nothing may be
    // hardcoded, so a missing Host yields no origin rather than a wrong one.
    expect(originFromHeaders({}, 'https')).toBeNull();
    expect(originFromHeaders(null, 'https')).toBeNull();
  });

  it('the text evidence block still reports a failed upload instead of hiding it', () => {
    const text = buildBugEvidenceText({
      tagId: 'tag-1',
      reports: [{ id: 'iss-9', reportId: 'iss-9', shot_count: 0, shot_upload_error: 'r2_credentials_missing' }],
    });
    expect(text).toContain('screenshot upload failed (r2_credentials_missing)');
    expect(text).not.toContain('Screenshots (');
  });

  it('the text evidence block carries job/photo/debug pointers and nothing when empty', () => {
    const text = buildBugEvidenceText({
      tagId: 'tag-1',
      currentEvidence: {
        job_id: 'job_1',
        photo_urls: ['https://pub.example/photos/a.jpg'],
        debug_url: 'https://pub.example/debug/job_1.json',
      },
    });
    expect(text).toContain('Job: job_1');
    expect(text).toContain('Photo: https://pub.example/photos/a.jpg');
    expect(text).toContain('Debug: https://pub.example/debug/job_1.json');
    expect(buildBugEvidenceText({ tagId: 'tag-1' })).toBe('');
  });
});
