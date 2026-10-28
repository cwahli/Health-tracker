#!/usr/bin/env python3
"""Round-based hard-task driver with elimination. Rounds come from /content/bakeoff/hard_rounds.json (list of task ids, re-read each round).
Elimination (chiwah): after each completed round, a model is dropped if it passed <2 of 3 on >=2 hard tasks, or has >1 fake success on hard tasks.
mimo (cloud reference, no GPU) is flagged but still run. State is derived from results.jsonl, so the driver is resumable."""
import json, os, sys, time, subprocess
sys.path.insert(0, '/content/bakeoff/harness')
import hardbench, bench
from bench import RES, RUNS, log, persist, restore, sh, done_keys, HT
MODELS = ['ollama/bench-qwen38', 'ollama/bench-glm', 'ollama/bench-qwen36', 'ollama/bench-devstral']  # open-weight, run first on every task
REF = 'opencode/mimo-v2.6-flash-free'
HARD_MIN = 6

def rows():
    return [json.loads(l) for l in open(RES) if l.strip().startswith('{')] if os.path.exists(RES) else []

def eliminations(tasks_done):
    sus = set(json.load(open('/content/bakeoff/suspect_tasks.json'))) if os.path.exists('/content/bakeoff/suspect_tasks.json') else set()
    gap = set(json.load(open('/content/bakeoff/capgap_tasks.json'))) if os.path.exists('/content/bakeoff/capgap_tasks.json') else set()
    sus |= gap  # a task nobody open-weight solves does not discriminate between them; reported separately
    rs = [r for r in rows() if r['task'] >= HARD_MIN and r['task'] not in sus]
    tasks_done = [t for t in tasks_done if t not in sus]
    out = {}
    for m in MODELS:
        mr = [r for r in rs if r['model'] == m]
        weak = []
        for t in tasks_done:
            tr = [r for r in mr if r['task'] == t]
            if len(tr) >= 3 and sum(1 for r in tr if r['pass_']) < 2: weak.append(t)
        fakes = sum(1 for r in mr if r.get('fake_success'))
        why = []
        if len(weak) >= 2: why.append(f'passed <2/3 on {len(weak)} hard tasks (t{",t".join(map(str, weak))})')
        if fakes > 1: why.append(f'{fakes} fake successes on hard tasks')
        if why: out[m] = '; '.join(why)
    return out

def wait_easy():
    while sh('tmux ls 2>/dev/null | grep -c "^colabjob-qwen38easy"').stdout.strip() not in ('0', ''):
        time.sleep(60)

def main():
    wait_easy(); restore(); sh(f'cd {HT} && git checkout -q bakeoff-results')
    done_rounds = []
    while True:
        rounds = json.load(open('/content/bakeoff/hard_rounds.json'))
        sus0 = json.load(open('/content/bakeoff/suspect_tasks.json')) if os.path.exists('/content/bakeoff/suspect_tasks.json') else []
        todo = [t for t in rounds if t not in done_rounds and t not in sus0]
        if not todo: break
        t = todo[0]
        hardbench.HARD = json.load(open('/content/bakeoff/hard_tasks.json'))
        elim = eliminations(done_rounds)
        for m in MODELS:
            if m in elim: log('SKIP (eliminated)', m, elim[m]); continue
            for run in (1, 2, 3):
                if (m, t, run) in done_keys(): continue
                log('RUN', m, 't%d' % t, 'r%d' % run)
                row = hardbench.run_hard(m, t, run, 1800)
                open(RES, 'a').write(json.dumps(row) + '\n')
                log('  ->', 'PASS' if row['pass_'] else 'FAIL', row['failure_class'], f"{row['wall_s']}s", row['reasons'][:2])
                persist(f"{m} t{t} r{run} {row['failure_class']}")
        done_rounds.append(t)
        tr = [r for r in rows() if r['task'] == t and r['model'] in MODELS]
        if tr and not any(r['pass_'] for r in tr):
            # chiwah rule: every open-weight model failed -> run mimo (ceiling) x3
            for run in (1, 2, 3):
                if (REF, t, run) in done_keys(): continue
                log('RUN (ceiling)', REF, 't%d' % t, 'r%d' % run)
                row = hardbench.run_hard(REF, t, run, 1800)
                open(RES, 'a').write(json.dumps(row) + '\n')
                log('  ->', 'PASS' if row['pass_'] else 'FAIL', row['failure_class'], f"{row['wall_s']}s", row['reasons'][:2])
                persist(f"{REF} t{t} r{run} {row['failure_class']} (ceiling)")
            mp = sum(1 for r in rows() if r['task'] == t and r['model'] == REF and r['pass_'])
            if mp >= 1:
                gap = json.load(open('/content/bakeoff/capgap_tasks.json')) if os.path.exists('/content/bakeoff/capgap_tasks.json') else []
                if t not in gap: gap.append(t)
                json.dump(gap, open('/content/bakeoff/capgap_tasks.json', 'w'))
                log('CAPABILITY GAP t%d: open-weight 0 passes, mimo %d/3 -> task valid' % (t, mp))
            else:
                sus = json.load(open('/content/bakeoff/suspect_tasks.json')) if os.path.exists('/content/bakeoff/suspect_tasks.json') else []
                if t not in sus: sus.append(t)
                json.dump(sus, open('/content/bakeoff/suspect_tasks.json', 'w'))
                log('TASK SUSPECT: open-weight AND mimo all failed t%d -> halting for diagnosis' % t)
                persist(f'task t{t} suspect (all incl. mimo failed); halted for diagnosis')
                sys.exit(3)
        elim = eliminations(done_rounds)
        os.makedirs(RUNS, exist_ok=True)
        json.dump({'after_tasks': done_rounds, 'eliminated': elim, 'capability_gap_tasks': json.load(open('/content/bakeoff/capgap_tasks.json')) if os.path.exists('/content/bakeoff/capgap_tasks.json') else [], 'suspect_tasks': json.load(open('/content/bakeoff/suspect_tasks.json')) if os.path.exists('/content/bakeoff/suspect_tasks.json') else [], 'note': 'mimo (cloud ceiling) runs on a task only when every open-weight model failed it'}, open(f'{RUNS}/_elimination.json', 'w'), indent=1)
        log('ROUND DONE t%d; eliminated:' % t, elim)
        persist(f'round t{t} done; eliminated {list(elim)}')
    log('ALL ROUNDS DONE')

if __name__ == '__main__': main()
