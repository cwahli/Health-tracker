#!/usr/bin/env python3
"""Real-work ledger for the Colab model scoreboard. Append-only JSONL at /content/bakeoff/realwork.jsonl.
Usage (python):  sys.path.insert(0,'/content/bakeoff/harness'); import realwork; realwork.log_row(...)
Usage (shell):   python3 /content/bakeoff/harness/realwork.py log --model ollama/bench-qwen38r --task mtd-quiz-figma-2 --difficulty hard --verified true --how 'node check.js' --wall-s 1260 [--fake-success] [--retries 1] [--notes '...']
                 python3 /content/bakeoff/harness/realwork.py summary     # rebuild the ranking block in RESULTS.md
See /content/bakeoff/REALWORK.md for the format. Never put secrets in any field."""
import json, os, sys, time, fcntl, argparse, statistics, re
B = '/content/bakeoff'; LEDGER = f'{B}/realwork.jsonl'; RESULTS = f'{B}/RESULTS.md'
BEGIN, END = '<!-- REALWORK:BEGIN -->', '<!-- REALWORK:END -->'
HARD_WHY = ('multi-file', 'layout/figma', 'test-preserving')

def _now():
    return time.strftime('%Y-%m-%dT%H:%M:%S%z')  # box clock is Europe/London

def log_row(model, task, difficulty, verified, how, wall_s, fake_success=False, retries=0, hard_reason='', job='', notes='', update=True):
    """verified: True/False from the REAL check or live verification; None = not verified yet (excluded from rates).
    fake_success: the model claimed done/passing but verification failed (or it never changed the files).
    retries: extra attempts after the first (0 = one-shot). wall_s: total wall seconds for the job incl. retries."""
    assert difficulty in ('easy', 'hard'), 'difficulty must be easy|hard'
    if difficulty == 'hard' and not hard_reason: hard_reason = 'unspecified'
    row = dict(ts=_now(), job=job, task=str(task), model=model, difficulty=difficulty, hard_reason=hard_reason if difficulty == 'hard' else '',
               verified=verified, how=how, fake_success=bool(fake_success), retries=int(retries), wall_s=round(float(wall_s), 1), notes=notes[:300])
    with open(LEDGER, 'a') as f:
        fcntl.flock(f, fcntl.LOCK_EX); f.write(json.dumps(row) + '\n'); fcntl.flock(f, fcntl.LOCK_UN)
    if update:
        try: summary()
        except Exception as e: print('realwork summary failed:', e, file=sys.stderr)
    return row

def rows():
    if not os.path.exists(LEDGER): return []
    out = []
    for l in open(LEDGER):
        l = l.strip()
        if l.startswith('{'):
            try: out.append(json.loads(l))
            except Exception: pass
    last = {}
    for r in out: last[(r.get('job', ''), r['task'], r['model'])] = r  # a later row for the same job+task+model supersedes
    return list(last.values())

def _fmt_t(s):
    return '-' if s is None else (f'{s/60:.0f} min' if s >= 120 else f'{s:.0f} s')

def _table(rs, label):
    models = sorted({r['model'] for r in rs})
    stats = []
    for m in models:
        mr = [r for r in rs if r['model'] == m]
        ver = [r for r in mr if r['verified'] is not None]
        ok = [r for r in ver if r['verified'] is True]
        rate = len(ok) / len(ver) if ver else None
        med = statistics.median([r['wall_s'] for r in ok]) if ok else None
        stats.append((m, len(ok), len(ver), len(mr) - len(ver), sum(1 for r in mr if r['fake_success']), sum(r['retries'] for r in mr), med, rate))
    # rank: verified success rate (desc), then more verified jobs as evidence, then time (asc) only as the final tiebreak
    stats.sort(key=lambda s: (-(s[7] if s[7] is not None else -1), -s[2], s[6] if s[6] is not None else 1e12))
    L = [f'**{label}**', '']
    if not stats: return L + ['_no jobs logged yet_', '']
    L += ['| Rank | Model | Verified success | Rate | Fakes | Retries | Median time of passing jobs | Unverified |', '|---|---|---|---|---|---|---|---|']
    for i, (m, ok, n, unv, fk, rt, med, rate) in enumerate(stats, 1):
        L.append(f'| {i} | {m} | {ok} of {n} | {("%.0f%%" % (rate*100)) if rate is not None else "-"} | {fk} | {rt} | {_fmt_t(med)} | {unv} |')
    return L + ['']

def summary():
    rs = rows()
    L = [BEGIN, '## Real-work scoreboard (continuous)', '',
         'Source: `/content/bakeoff/realwork.jsonl` (one row per real Colab coding job; format in `REALWORK.md`). Updated: ' + _now() + '.',
         'Ranked by verified success rate (a job counts as a success only if the real check or live verification passed). Time is used only to break ties. A job with no verification yet is listed under Unverified and not counted in the rate.', '']
    L += _table([r for r in rs if r['difficulty'] == 'easy'], 'Easy jobs')
    L += _table([r for r in rs if r['difficulty'] == 'hard'], 'Hard jobs (multi-file, layout/Figma, or test-preserving)')
    L += ['Key: numbers like "3 of 4" are verified passes out of verified jobs, higher is better. Fakes = the model said it was done but the check failed. Retries = extra attempts. "-" means no passing job to time.', END]
    block = '\n'.join(L)
    cur = open(RESULTS).read() if os.path.exists(RESULTS) else ''
    if BEGIN in cur and END in cur:
        new = cur[:cur.index(BEGIN)] + block + cur[cur.index(END) + len(END):]
    else:
        new = cur.rstrip('\n') + '\n\n' + block + '\n'
    tmp = RESULTS + '.tmp'; open(tmp, 'w').write(new); os.replace(tmp, RESULTS)
    return block

def _b(x):
    return {'true': True, 'false': False, 'none': None, 'pending': None}[x.lower()]

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); sp = ap.add_subparsers(dest='cmd', required=True)
    lg = sp.add_parser('log')
    lg.add_argument('--model', required=True); lg.add_argument('--task', required=True); lg.add_argument('--difficulty', required=True, choices=['easy', 'hard'])
    lg.add_argument('--verified', required=True, help='true|false|pending'); lg.add_argument('--how', required=True, help='the real check / live verification used')
    lg.add_argument('--wall-s', type=float, required=True); lg.add_argument('--fake-success', action='store_true'); lg.add_argument('--retries', type=int, default=0)
    lg.add_argument('--hard-reason', default='', help='multi-file | layout/figma | test-preserving'); lg.add_argument('--job', default=''); lg.add_argument('--notes', default='')
    sp.add_parser('summary')
    a = ap.parse_args()
    if a.cmd == 'log': print(json.dumps(log_row(a.model, a.task, a.difficulty, _b(a.verified), a.how, a.wall_s, a.fake_success, a.retries, a.hard_reason, a.job, a.notes)))
    else: print(summary())
