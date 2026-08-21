import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  RemainingBugRow,
  AutoSpotList,
  FoodTapePanel,
  HomeStatePanel,
  HealthLogsPanel,
  BugSnapRemainingSection,
  FoodDetailTabs,
  computeBoardProgress,
} from '../index';
import type { AutoSpotHit } from '../../../utils/bugAutoSpot';

describe('RemainingBugRow component (G0-1)', () => {
  it('renders text, checked state, class label, comment, and pin shot action', () => {
    const html = renderToStaticMarkup(
      <RemainingBugRow
        id="bug-1"
        text="Chicken wrap mismatch"
        checked={false}
        photos={['https://example.com/shot-01.jpg']}
        comment="Check FDC ID"
        source="user"
        classLabel="FALSE_FRIEND"
        onPinShot={() => {}}
      />
    );

    expect(html).toContain('Chicken wrap mismatch');
    expect(html).toContain('FALSE_FRIEND');
    expect(html).toContain('Check FDC ID');
    expect(html).toContain('Pin shot');
  });

  it('renders parked meta when parked is true', () => {
    const html = renderToStaticMarkup(
      <RemainingBugRow
        id="bug-2"
        text="Wrap scaled 827 -> 450 kcal"
        checked={false}
        photos={[]}
        comment=""
        source="auto"
        parked={true}
      />
    );

    expect(html).toContain('Wrap scaled 827 -&gt; 450 kcal');
    expect(html).toContain('parked (off) · not your named series');
  });
});

describe('AutoSpotList component (G0-2)', () => {
  it('renders list of hits with heading and drops any hit with "Scouted only"', () => {
    const hits: AutoSpotHit[] = [
      {
        id: 'hit-1',
        code: 'BRAND_LEAK',
        surface: 'food',
        text: 'Co-op granola on fruit cup',
        class: 'BRAND_LEAK',
      },
      {
        id: 'hit-2',
        code: 'JOURNEY_NO_MATCH',
        surface: 'food',
        text: 'Scouted only: fresh blueberries', // MUST BE DROPPED
      },
      {
        id: 'hit-3',
        code: 'LEDGER_SILENT_REPAIR',
        surface: 'food',
        text: 'Wrap scaled 827 -> 450 kcal',
        class: 'SILENT_REPAIR',
        parked: true,
      },
    ];

    const html = renderToStaticMarkup(<AutoSpotList hits={hits} />);

    // Heading must exist
    expect(html).toContain('Also spotted on tape — uncheck to drop');

    // Hit 1 rendered
    expect(html).toContain('Co-op granola on fruit cup');

    // Hit 2 MUST NOT be rendered
    expect(html).not.toContain('Scouted only');
    expect(html).not.toContain('fresh blueberries');

    // Hit 3 rendered and parked meta shown
    expect(html).toContain('Wrap scaled 827 -&gt; 450 kcal');
    expect(html).toContain('parked (off) · not your named series');
  });

  it('returns empty/null when all hits match "Scouted only"', () => {
    const hits: AutoSpotHit[] = [
      {
        id: 'hit-drop',
        code: 'JOURNEY_NO_MATCH',
        surface: 'food',
        text: 'scouted only item',
      },
    ];

    const html = renderToStaticMarkup(<AutoSpotList hits={hits} />);
    expect(html).toBe('');
  });
});

describe('Pack Shells show/hide by surface (G0-3)', () => {
  it('FoodTapePanel renders on surface="food" and hides on other surfaces', () => {
    const foodHtml = renderToStaticMarkup(
      <FoodTapePanel
        surface="food"
        dishes={[{ name: 'Cobb Salad', kcal: 505, weightGrams: 400 }]}
        identity={[
          {
            dish: 'Cobb Salad',
            components: [{ name: 'feta cheese', matchType: 'catalog' }],
          },
        ]}
      />
    );

    expect(foodHtml).toContain('data-testid="food-tape-panel"');
    expect(foodHtml).toContain('Cobb Salad');
    expect(foodHtml).toContain('feta cheese');

    // On surface="home" -> should hide
    const homeHtml = renderToStaticMarkup(
      <FoodTapePanel
        surface="home"
        dishes={[{ name: 'Cobb Salad', kcal: 505 }]}
      />
    );
    expect(homeHtml).toBe('');
  });

  it('HomeStatePanel renders on surface="home" and hides on surface="food"', () => {
    const homeHtml = renderToStaticMarkup(
      <HomeStatePanel
        surface="home"
        tiles={[{ key: 'bmi', label: 'BMI', value: 22.4 }]}
        tombstones={{ bmi_kg_m2: 1787078671969 }}
      />
    );

    expect(homeHtml).toContain('data-testid="home-state-panel"');
    expect(homeHtml).toContain('BMI');
    expect(homeHtml).toContain('bmi_kg_m2');

    const foodHtml = renderToStaticMarkup(
      <HomeStatePanel
        surface="food"
        tiles={[{ key: 'bmi', label: 'BMI', value: 22.4 }]}
      />
    );
    expect(foodHtml).toBe('');
  });

  it('HealthLogsPanel renders on surface="health" and hides on surface="food"', () => {
    const healthHtml = renderToStaticMarkup(
      <HealthLogsPanel
        surface="health"
        keys={['glucose', 'hba1c']}
        historyCount={42}
      />
    );

    expect(healthHtml).toContain('data-testid="health-logs-panel"');
    expect(healthHtml).toContain('glucose');
    expect(healthHtml).toContain('42');

    const foodHtml = renderToStaticMarkup(
      <HealthLogsPanel
        surface="food"
        keys={['glucose']}
      />
    );
    expect(foodHtml).toBe('');
  });
});

describe('BugSnapRemainingSection component (G1-1, G1-2)', () => {
  it('renders toolbar buttons, user bug rows, and auto-spotted hits', () => {
    const rows = [
      {
        id: 'r1',
        text: 'Croissant quantity 2 vs 6',
        comment: 'Check Scout breakdown',
        photos: ['blob:shot1'],
        checked: true,
        source: 'user' as const,
      },
    ];
    const hits: AutoSpotHit[] = [
      {
        id: 'h1',
        code: 'BRAND_LEAK',
        surface: 'food',
        text: 'Co-op Granola label leak',
      },
    ];

    const html = renderToStaticMarkup(
      <BugSnapRemainingSection
        rows={rows}
        selectedRowId="r1"
        selectedShotUrl="blob:shot1"
        autoSpotHits={hits}
        checkedAutoSpotIds={new Set(['h1'])}
        onSelectRow={() => {}}
        onAddRow={() => {}}
        onToggleRow={() => {}}
        onTextChange={() => {}}
        onCommentChange={() => {}}
        onPinShot={() => {}}
        onClearPhoto={() => {}}
        onToggleAutoSpot={() => {}}
      />
    );

    expect(html).toContain('data-testid="bug-snap-remaining-section"');
    expect(html).toContain('Add bug');
    expect(html).toContain('Pin selected shot to bug');
    expect(html).toContain('Clear photo');
    expect(html).toContain('Croissant quantity 2 vs 6');
    expect(html).toContain('Co-op Granola label leak');
  });
});

describe('FoodDetailTabs component (G1-4)', () => {
  it('renders 5 tabs: Checks, Dishes, Scout identity, Balance, History', () => {
    const html = renderToStaticMarkup(
      <FoodDetailTabs
        activeTab="checks"
        onTabChange={() => {}}
        board={{
          invariants: [{ id: 'inv-1', label: 'wrap kcal within bounds', status: 'pass' }],
        }}
      />
    );

    expect(html).toContain('data-testid="food-detail-tabs"');
    expect(html).toContain('Checks');
    expect(html).toContain('Dishes');
    expect(html).toContain('Scout identity');
    expect(html).toContain('Balance');
    expect(html).toContain('History');
    expect(html).toContain('wrap kcal within bounds');
  });

  it('treats GoldenInvariant.pass boolean as a pass (not only status)', () => {
    const html = renderToStaticMarkup(
      <FoodDetailTabs
        activeTab="checks"
        onTabChange={() => {}}
        board={{
          invariants: [{ id: 'id_label', label: 'printed kcal locked', pass: true }],
        }}
      />
    );
    expect(html).toContain('printed kcal locked');
    expect(html).toContain('pass');
  });

  it('renders dishes pane when activeTab="dishes"', () => {
    const html = renderToStaticMarkup(
      <FoodDetailTabs
        activeTab="dishes"
        onTabChange={() => {}}
        goldenLines={[{ name: 'Poached Eggs', calories: 180, weightGrams: 100, protein: 12, scored: true }]}
      />
    );

    expect(html).toContain('Poached Eggs');
    expect(html).toContain('180');
  });

  it('renders scout identity pane when activeTab="scout"', () => {
    const html = renderToStaticMarkup(
      <FoodDetailTabs
        activeTab="scout"
        onTabChange={() => {}}
        board={{
          journey: [
            {
              id: 'j1',
              dish: 'Avocado Toast',
              query: 'sourdough bread',
              phase: 'scout',
              identityPass: true,
            },
          ],
        }}
      />
    );

    expect(html).toContain('Avocado Toast');
    expect(html).toContain('sourdough bread');
  });

  it('renders balance pane when activeTab="balance"', () => {
    const html = renderToStaticMarkup(
      <FoodDetailTabs
        activeTab="balance"
        onTabChange={() => {}}
        board={{
          ledger: {
            compiler: 'green',
            books: [{ id: 'b1', label: 'Scout Foundation', kcal: 450 }],
            imbalances: [],
          },
        }}
      />
    );

    expect(html).toContain('Meal Journey / Trial Balance');
    expect(html).toContain('balanced');
    expect(html).toContain('450 kcal');
  });

  it('renders green/red outcome progress bar and Replay log button (G2-1, G2-2, G2-3)', () => {
    const previewBoard = {
      jobId: 'job-12345678',
      invariants: [
        { id: 'inv-1', label: 'Calories within bounds', pass: true },
        { id: 'inv-2', label: 'Identity matched', pass: true },
        { id: 'inv-3', label: 'Weight non-zero', pass: false, status: 'fail' },
      ],
      journey: [
        { id: 'j1', dish: 'Wrap', query: 'chicken', phase: 'scout', identityPass: true },
      ],
    };

    const html = renderToStaticMarkup(
      <FoodDetailTabs
        activeTab="checks"
        onTabChange={() => {}}
        board={previewBoard}
        onReplayLog={() => {}}
      />
    );

    expect(html).toContain('data-testid="board-progress-bar"');
    expect(html).toContain('2 pass');
    expect(html).toContain('1 fail');
    expect(html).toContain('Replay log');
    expect(html).toContain('job job-1234');
  });

  it('renders Replay catalog and Re-analyze on food #n without claiming queue done', () => {
    const html = renderToStaticMarkup(
      <FoodDetailTabs
        activeTab="checks"
        onTabChange={() => {}}
        board={{ invariants: [{ id: 'inv-1', label: 'ok', pass: true }] }}
        onReplayLog={() => {}}
        onReplayCatalog={() => {}}
        onReanalyze={() => {}}
        canReanalyze
      />
    );
    expect(html).toContain('Replay catalog');
    expect(html).toContain('Re-analyze');
    expect(html).toContain('Preview only');
  });

  it('renders live auto-spot hits on Checks (curator skip / collision / drop)', () => {
    const html = renderToStaticMarkup(
      <FoodDetailTabs
        activeTab="checks"
        onTabChange={() => {}}
        board={{
          invariants: [{ id: 'inv-1', label: 'Calories within bounds', pass: true }],
          autoSpot: [
            {
              id: 'CURATOR_SKIP:kiwifruit',
              code: 'CURATOR_SKIP',
              surface: 'food',
              text: 'Curator skipped pick_existing for 2 queries (fresh kiwifruit, pickled onion)',
              class: 'OPENING_WRONG',
            },
          ],
        }}
      />
    );
    expect(html).toContain('Also spotted on tape');
    expect(html).toContain('pick_existing');
    expect(html).toContain('OPENING_WRONG');
  });
});

describe('computeBoardProgress helper (G2-3)', () => {
  it('correctly maps invariants and outcomes with pass: true into passCount and percentages', () => {
    const board = {
      invariants: [
        { id: 'inv-1', pass: true },
        { id: 'inv-2', pass: true },
        { id: 'inv-3', pass: false, status: 'fail' },
        { id: 'inv-4', pass: true },
      ],
    };
    const { passCount, failCount, total, passPct, failPct } = computeBoardProgress(board);
    expect(passCount).toBe(3);
    expect(failCount).toBe(1);
    expect(total).toBe(4);
    expect(passPct).toBe(75);
    expect(failPct).toBe(25);
  });

  it('handles empty/null board gracefully without crashing', () => {
    const res = computeBoardProgress(null);
    expect(res).toEqual({ passCount: 0, failCount: 0, total: 0, passPct: 0, failPct: 0 });
  });

  it('filters out "Scouted only" and j_* journey entries so they do not count as failures', () => {
    const board = {
      invariants: [
        { id: 'inv-1', label: 'Calories within bounds', pass: true },
        { id: 'j_0', label: 'Scouted only: fresh blueberries', status: 'fail' }, // MUST BE DROPPED
        { id: 'j_1', label: 'Scout query chicken', pass: false }, // MUST BE DROPPED
        { id: 'inv-2', label: 'Weight non-zero', pass: false, status: 'fail' },
      ],
    };
    const { passCount, failCount, total, passPct, failPct } = computeBoardProgress(board);
    expect(passCount).toBe(1);
    expect(failCount).toBe(1);
    expect(total).toBe(2);
    expect(passPct).toBe(50);
    expect(failPct).toBe(50);
  });
});
