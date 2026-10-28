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
    n = 0
    # the queue keeps a 'tail -F' viewer session alive after a job ends, so wait on the job log instead of tmux
    f = '/content/jobs/qwen38easy/out.log'
    while not (os.path.exists(f) and 'ALL DONE' in open(f, errors='replace').read()):
        if n % 5 == 0: log('waiting for qwen38easy to finish (heartbeat)')
        n += 1
        time.sleep(60)

DEEP = 'opencode/deepseek-v4.1-flash-free'

def real_keys(model):
    return {(r['model'], r['task'], r['run']) for r in rows() if r['model'] == model and r.get('failure_class') != 'unavailable'}

def run_ref(ref, t):
    for run in (1, 2, 3):
        if (ref, t, run) in real_keys(ref): continue
        log('RUN (ceiling)', ref, 't%d' % t, 'r%d' % run)
        row = hardbench.run_hard(ref, t, run, 1800)
        open(RES, 'a').write(json.dumps(row) + '\n')
        log('  ->', 'PASS' if row['pass_'] else row['failure_class'].upper(), f"{row['wall_s']}s", row['reasons'][:2])
        persist(f"{ref} t{t} r{run} {row['failure_class']} (ceiling)")
    return sum(1 for k in real_keys(ref) if k[1] == t)

def ceiling_ref(t):
    """mimo first; rate-limit/quota/provider errors are recorded as 'unavailable' (not fail) and retried later; if mimo stays
    unavailable (2 sweeps, 20 min apart) fall back to DeepSeek via opencode and note the switch."""
    for sweep in range(2):
        if run_ref(REF, t) >= 3: return REF
        log('mimo unavailable (provider/rate limit); waiting 20 min before retry', sweep + 1)
        time.sleep(1200)
    if run_ref(REF, t) >= 3: return REF
    note = f'task t{t}: mimo stayed unavailable (rate limit/quota/provider error) -> using {DEEP} as the ceiling reference'
    log('CEILING SWITCH', note)
    open('/content/bakeoff/ceiling_switch.txt', 'a').write(time.strftime('%F %T ') + note + '\n')
    run_ref(DEEP, t)
    return DEEP

def pick_qwen38():
    """Ollama's qwen3.8 renderer 500s ('no user query found') on parallel-tool-call continuations. If the probe shows that and the
    same weights with RENDERER qwen3.5 work, use bench-qwen38r for the hard tasks (documented in the report)."""
    f = '/content/bakeoff/qwen38_probe.txt'
    if not os.path.exists(f):
        out = sh('python3 /content/bakeoff/harness/repro.py bench-qwen38 bench-qwen38r', timeout=900).stdout
        open(f, 'w').write(out)
    out = open(f).read()
    if 'bench-qwen38 3 calls: HTTP 500' in out and 'bench-qwen38r 3 calls: OK' in out:
        MODELS[0] = 'ollama/bench-qwen38r'
    log('qwen3.8 probe ->', MODELS[0])

def run_queue():
    """interleave: run queued jobs (/content/bakeoff/queue/*.sh) at a safe point between runs/rounds, never overlapping on the GPU."""
    qd = '/content/bakeoff/queue'
    for f in sorted(x for x in os.listdir(qd) if x.endswith('.sh')) if os.path.isdir(qd) else []:
        log('QUEUE start', f)
        pr = subprocess.Popen(f'bash {qd}/{f} >> /content/jobs/harddriver/queue-{f}.log 2>&1', shell=True)
        n = 0
        while pr.poll() is None:
            time.sleep(30); n += 1
            if n % 10 == 0: log('queue job running (heartbeat):', f, '|', (open(RES).read().count('\n') if os.path.exists(RES) else 0), 'result rows')
        os.rename(f'{qd}/{f}', f'{qd}/{f}.done'); log('QUEUE done', f, 'rc', pr.returncode)
    decide_qwen38()

def decide_qwen38():
    """if qwen3.8-fixed (easy T1-T5 x3) clearly beats the first qwen3.8 run (>=2 more passes of 15), use bench-qwen38r as the qwen3.8 entry in hard rounds."""
    d = '/content/bakeoff/qwen38_decision.json'
    if os.path.exists(d):
        if json.load(open(d)).get('use') == 'ollama/bench-qwen38r': MODELS[0] = 'ollama/bench-qwen38r'
        return
    fx = [r for r in rows() if r['model'] == 'qwen3.8-fixed' and r['task'] <= 5]
    if len(fx) < 15: return
    old = [r for r in rows() if r['model'] == 'ollama/bench-qwen38' and r['task'] <= 5]
    po, pf = sum(1 for r in old if r['pass_']), sum(1 for r in fx if r['pass_'])
    use = 'ollama/bench-qwen38r' if pf >= po + 2 else 'ollama/bench-qwen38'
    json.dump({'old_passes': po, 'old_n': len(old), 'fixed_passes': pf, 'fixed_n': len(fx), 'use': use, 'rule': 'fixed >= old + 2 passes'}, open(d, 'w'))
    MODELS[0] = use; log('qwen3.8 decision: old %d/%d vs fixed %d/%d -> hard rounds use %s' % (po, len(old), pf, len(fx), use))
    persist('qwen3.8 decision recorded')

def main():
    wait_easy(); pick_qwen38(); restore(); run_queue(); sh(f'cd {HT} && git checkout -q bakeoff-results')
    done_rounds = []
    while True:
        rounds = json.load(open('/content/bakeoff/hard_rounds.json'))
        sus0 = json.load(open('/content/bakeoff/suspect_tasks.json')) if os.path.exists('/content/bakeoff/suspect_tasks.json') else []
        todo = [t for t in rounds if t not in done_rounds and t not in sus0]
        if not todo: break
        t = todo[0]
        run_queue()
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
            # chiwah rule: every open-weight model failed -> run the ceiling reference x3 (mimo; DeepSeek if mimo stays unavailable)
            ref = ceiling_ref(t)
            mp = sum(1 for r in rows() if r['task'] == t and r['model'] == ref and r['pass_'])
            if mp >= 1:
                gap = json.load(open('/content/bakeoff/capgap_tasks.json')) if os.path.exists('/content/bakeoff/capgap_tasks.json') else []
                if t not in gap: gap.append(t)
                json.dump(gap, open('/content/bakeoff/capgap_tasks.json', 'w'))
                log('CAPABILITY GAP t%d: open-weight 0 passes, %s %d/3 -> task valid' % (t, ref, mp))
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
