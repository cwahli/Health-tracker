#!/usr/bin/env python3
"""Hard-task harness (T-QUIZ, T-TERTIARY, synthetic hard tasks). Reuses bench.py helpers. Resumable; pushes after every run.
usage: hardbench.py --plan hard_plan.json [--timeout 1800] [--only model]
Each plan row: [model, task, run]. Results append to results.jsonl (same schema + parts, task>=6)."""
import json, os, sys, time, subprocess, signal, threading, argparse
sys.path.insert(0, '/content/bakeoff/harness')
import bench
from bench import *

HARD = json.load(open('/content/bakeoff/hard_tasks.json'))  # {"11": {"repo","seed","prompt","check","name","srv"}}

def _run_hard_once(model, task, run, timeout):
    T = HARD[str(task)]; repo = T['repo']
    rid = f'{model.replace("/", "_")}-t{task}-r{run}'
    rd = f'{RUNS}/{rid}'; os.makedirs(rd, exist_ok=True)
    prompt = open(T['prompt']).read().strip()
    sh(f'cd {repo} && git reset -q --hard && git clean -fdq && git checkout -q -f --detach {T["seed"]} && git clean -fdq')
    warm(model)
    srv = None
    stop = threading.Event(); box = {}
    th = threading.Thread(target=bench.vram_poller, args=(stop, box), daemon=True); th.start()
    t0 = time.time(); timed_out = False
    out = open(f'{rd}/events.jsonl', 'w')
    p = subprocess.Popen(['opencode', 'run', '--format', 'json', '-m', model, '--dir', repo, prompt], cwd=repo, env=ENV,
                         stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
    try: p.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        try: os.killpg(p.pid, signal.SIGTERM); time.sleep(3); os.killpg(p.pid, signal.SIGKILL)
        except Exception: pass
    wall = time.time() - t0; out.close()
    ps = ps_info(); stop.set()
    # kill any leftover http.server the model started (by recorded port only, exact pids)
    ev = parse_events(f'{rd}/events.jsonl')
    sh(f'cd {repo} && git add -A -N . 2>/dev/null; git diff {T["seed"]} > {rd}/final.diff')
    # check (serves repo on port T["port"])
    srv = subprocess.Popen(['python3', '-m', 'http.server', str(T['port'])], cwd=repo, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    time.sleep(1)
    try:
        c = sh(T['check'].format(repo=repo, rd=rd, port=T['port'], B=B), env=dict(ENV, PORT=str(T['port'])), timeout=420)
        chk = json.loads(c.stdout.strip().splitlines()[-1])
    except Exception as e:
        chk = {'pass': False, 'reasons': ['check failed: ' + str(e)[:200]], 'parts': {}}
    try: os.killpg(srv.pid, signal.SIGTERM)
    except Exception: pass
    json.dump(chk, open(f'{rd}/check.json', 'w'))
    # keep every attempt on its own local branch bench/<slug>/<model>-r<n> (never main); push passing ones' branch only
    short = model.split('/', 1)[1].replace('bench-', '')
    br = f'bench/{T["slug"]}/{short}-r{run}'
    sh(f'cd {repo} && git checkout -q -B {br} && git add -A && git -c user.name=cwah123 -c user.email=260443071+cwah123@users.noreply.github.com commit -q -m "bench {T["name"]} {short} r{run} (pass={chk["pass"]})" --allow-empty')
    pushed = False
    if chk['pass'] and T.get('push', True):
        r = sh(f'cd {repo} && git push -q gh {br}:refs/heads/{br} 2>&1 | tail -2')
        pushed = 'error' not in (r.stdout + r.stderr).lower() and 'fatal' not in (r.stdout + r.stderr).lower() and 'rejected' not in (r.stdout + r.stderr).lower()
        log('push', br, 'ok' if pushed else 'FAILED')
    fc = classify(chk['pass'], timed_out, ev, ev['final'])
    ps_pct = round(100 * (ps[0][2] or 0) / ps[0][1]) if ps and ps[0][1] else None
    row = dict(model=model, task=task, run=run, pass_=chk['pass'], failure_class=fc, fake_success=(fc == 'fake_success'),
               wall_s=round(wall, 1), timed_out=timed_out, steps=ev['steps'], tool_calls=ev['tools'], tool_errors=ev['tool_err'], edits=ev['edits'],
               in_tok=ev['in_tok'], out_tok=ev['out_tok'], eff_tok_s=round(ev['out_tok'] / wall, 1) if wall > 0 else None,
               vram_mib_peak=box.get('vram'), gpu_pct=ps_pct, parts=chk.get('parts'), branch=br, pushed=pushed, reasons=chk['reasons'][:6], final=ev['final'][:240].replace('\n', ' '), err=ev['err'], ts=time.strftime('%Y-%m-%d %H:%M:%S'))
    sh(f'cd {repo} && git checkout -q -f --detach {T["seed"]} && git clean -fdq')
    return row

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--timeout', type=int, default=1800); ap.add_argument('--plan', required=True); ap.add_argument('--only')
    a = ap.parse_args()
    plan = json.load(open(a.plan)); os.makedirs(RUNS, exist_ok=True)
    restore()
    sh(f'cd {HT} && git checkout -q bakeoff-results')
    for model, task, run in plan:
        if a.only and model != a.only: continue
        if (model, task, run) in done_keys(): continue
        log('RUN', model, 't%d' % task, 'r%d' % run)
        row = run_hard(model, task, run, a.timeout)
        open(RES, 'a').write(json.dumps(row) + '\n')
        log('  ->', 'PASS' if row['pass_'] else 'FAIL', row['failure_class'], f"{row['wall_s']}s", 'out_tok', row['out_tok'], row['reasons'][:2])
        persist(f"{model} t{task} r{run} {row['failure_class']}")
    log('ALL DONE')

if __name__ == '__main__': main()


def run_hard(model, task, run, timeout=1800):
    """Retry (max 2x) only on Ollama's qwen3.8 renderer HTTP 500 'no user query found in messages' (infra error, not a model failure)."""
    n = 0
    while True:
        row = _run_hard_once(model, task, run, timeout)
        if 'no user query found' in (row.get('err') or '') and n < 2:
            n += 1
            log('infra error (renderer 500), retry', n)
            continue
        row['infra_retries'] = n
        return row
