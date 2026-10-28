#!/usr/bin/env python3
"""Sage-style local-model bake-off harness. Resumable, persists after every run.
usage: bench.py [--timeout 900] [--plan plan.json] [--only model] [--tasks 1,2] [--runs 3] [--dry]
Results: /content/bakeoff/results.jsonl (one row per run), logs in /content/bakeoff/runs/<id>/.
After every run: scrub secrets, copy to ht clone, commit as cwah123 on branch bakeoff-results, push branch only."""
import json, os, re, subprocess, sys, time, threading, signal, shutil, argparse, urllib.request

B = '/content/bakeoff'
REPO = f'{B}/repo'; HT = f'{B}/ht'; RES = f'{B}/results.jsonl'; RUNS = f'{B}/runs'
DEST = f'{HT}/tooling/colab/bakeoff'
ENV = dict(os.environ, XDG_CONFIG_HOME=f'{B}/xdg', PATH='/tools/node/bin:' + os.environ.get('PATH', ''), CI='1')
ENV.pop('OPENCODE_API_KEY', None)
SECRET = re.compile(r'(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|xox[abp]-[A-Za-z0-9-]{10,}|(?i:bearer)\s+[A-Za-z0-9._-]{20,}|https://[^/\s@]+@github\.com)')
CLAIM = re.compile(r'\b(done|completed?|fixed|updated|changed|implemented|created|refactored|extracted|removed|added|successfully|now (passes|pass))\b', re.I)
NEG = re.compile(r"(unable|cannot|can't|couldn't|could not|failed|not able|did not|didn't|unfortunately)", re.I)

def sh(cmd, **k):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, **k)

def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)

def done_keys():
    s = set()
    if os.path.exists(RES):
        for l in open(RES):
            try:
                r = json.loads(l); s.add((r['model'], r['task'], r['run']))
            except Exception: pass
    return s

def restore():
    """resume: if local results are missing/short, restore from the bakeoff-results branch."""
    r = sh(f'cd {HT} && git fetch -q origin bakeoff-results 2>&1 && git show origin/bakeoff-results:tooling/colab/bakeoff/results.jsonl')
    if r.returncode == 0 and r.stdout.strip():
        have = len(open(RES).read().splitlines()) if os.path.exists(RES) else 0
        got = r.stdout.strip().splitlines()
        if len(got) > have:
            open(RES, 'w').write('\n'.join(got) + '\n'); log('restored', len(got), 'rows from branch (local had', have, ')')

def vram_poller(stop, box):
    while not stop.is_set():
        r = sh('nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits')
        try: box['vram'] = max(box.get('vram', 0), int(r.stdout.split()[0]))
        except Exception: pass
        stop.wait(2)

def ps_info():
    try:
        d = json.load(urllib.request.urlopen('http://localhost:11434/api/ps', timeout=5))
        return [(m['name'], m.get('size'), m.get('size_vram')) for m in d.get('models', [])]
    except Exception: return []

def warm(model):
    if model.startswith('opencode/'): return
    name = model.split('/', 1)[1]
    try:
        body = json.dumps({'model': name, 'prompt': '', 'keep_alive': '60m', 'stream': False}).encode()
        urllib.request.urlopen(urllib.request.Request('http://localhost:11434/api/generate', body), timeout=600).read()
    except Exception as e: log('warm failed', e)

def parse_events(path):
    ev = dict(tools=0, tool_err=0, edits=0, tool_names={}, in_tok=0, out_tok=0, steps=0, final='', text_all='', err='')
    for l in open(path, errors='replace'):
        l = l.strip()
        if not l.startswith('{'): continue
        try: e = json.loads(l)
        except Exception: continue
        t = e.get('type'); p = e.get('part', {}) or {}
        if t == 'tool_use':
            st = p.get('state', {}) or {}
            ev['tools'] += 1; n = p.get('tool', '?'); ev['tool_names'][n] = ev['tool_names'].get(n, 0) + 1
            if st.get('status') == 'error': ev['tool_err'] += 1
            elif n in ('edit', 'write', 'patch', 'multiedit', 'apply_patch'): ev['edits'] += 1
        elif t == 'text':
            ev['final'] = p.get('text', ''); ev['text_all'] += p.get('text', '') + '\n'
        elif t == 'step_finish':
            ev['steps'] += 1; tk = p.get('tokens', {}) or {}
            ev['in_tok'] += tk.get('input', 0); ev['out_tok'] += tk.get('output', 0) + tk.get('reasoning', 0)
        elif t == 'error':
            ev['err'] = json.dumps(e.get('error', e))[:300]
    return ev

def classify(passed, timed_out, ev, final_text):
    if passed: return 'pass'
    if timed_out: return 'timeout'
    txt = ev['text_all'] + ' ' + final_text
    textcall = re.search(r'<function=|<tool_call>|"name"\s*:\s*"(edit|write|bash|read)"|\[TOOL_CALLS\]|```json\s*\{\s*"(name|tool)"', txt)
    if ev['tools'] == 0:
        return 'tool_call_as_text' if textcall else ('no_tool_call_error' if ev['err'] else 'no_tool_call')
    claims = bool(CLAIM.search(final_text)) and not NEG.search(final_text)
    if claims: return 'fake_success'
    if ev['edits'] == 0: return 'no_edit' + ('_tool_errors' if ev['tool_err'] else '')
    if ev['tool_err'] >= max(2, ev['tools'] // 2): return 'wrong_args'
    return 'garbage_edit'

def scrub(path):
    for root, _, fs in os.walk(path):
        for f in fs:
            p = os.path.join(root, f)
            try:
                s = open(p, errors='replace').read()
                if SECRET.search(s): open(p, 'w').write(SECRET.sub('[REDACTED]', s))
            except Exception: pass

def persist(note):
    """copy artefacts into the ht clone, commit as cwah123, push branch only. Never raises."""
    try:
        os.makedirs(DEST, exist_ok=True)
        for src, dst in [(RES, 'results.jsonl'), (f'{B}/RESULTS.md', 'RESULTS.md'), (f'{B}/PRIOR.md', 'PRIOR.md')]:
            if os.path.exists(src): shutil.copy(src, f'{DEST}/{dst}')
        for d in ['suite', 'modelfiles', 'harness', 'runs']:
            if os.path.isdir(f'{B}/{d}'):
                sh(f'rsync -a --delete --exclude "*.pyc" {B}/{d}/ {DEST}/{d}/')
        cfg = json.load(open(f'{B}/xdg/opencode/opencode.json')); os.makedirs(f'{DEST}/cfg', exist_ok=True)
        json.dump(cfg, open(f'{DEST}/cfg/opencode.json', 'w'), indent=1)
        scrub(DEST)
        r = sh(f'cd {HT} && git checkout -q bakeoff-results 2>&1; git add tooling/colab/bakeoff && git -c user.name=cwah123 -c user.email=cwah123@users.noreply.github.com commit -q -m "bakeoff: {note}" 2>&1 | tail -1; git push -q origin bakeoff-results 2>&1 | tail -2', timeout=180)
        out = SECRET.sub('[REDACTED]', r.stdout + r.stderr).strip()
        log('persisted:', out[:160] or 'ok')
        return 'error' not in out.lower() and 'rejected' not in out.lower() and 'fatal' not in out.lower()
    except Exception as e:
        log('persist failed', e); return False

def run_one(model, task, run, timeout):
    rid = f'{model.replace("/", "_")}-t{task}-r{run}'
    rd = f'{RUNS}/{rid}'; os.makedirs(rd, exist_ok=True)
    prompt = open(f'{B}/suite/prompts/t{task}.txt').read().strip()
    sh(f'cd {REPO} && git reset -q --hard && git clean -fdq && git checkout -q -f task{task} && git reset -q --hard seed-t{task} && git clean -fdq')
    warm(model)
    stop = threading.Event(); box = {}
    th = threading.Thread(target=vram_poller, args=(stop, box), daemon=True); th.start()
    t0 = time.time(); timed_out = False
    out = open(f'{rd}/events.jsonl', 'w')
    p = subprocess.Popen(['opencode', 'run', '--format', 'json', '-m', model, '--dir', REPO, prompt], cwd=REPO, env=ENV,
                         stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
    try: p.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        try: os.killpg(p.pid, signal.SIGTERM); time.sleep(3); os.killpg(p.pid, signal.SIGKILL)
        except Exception: pass
    wall = time.time() - t0; out.close()
    ps = ps_info(); stop.set()
    ev = parse_events(f'{rd}/events.jsonl')
    sh(f'cd {REPO} && git add -A -N . 2>/dev/null; git diff seed-t{task} > {rd}/final.diff')
    c = sh(f'node {B}/suite/checks.js t{task} {REPO}', env=ENV)
    try: chk = json.loads(c.stdout.strip().splitlines()[-1])
    except Exception: chk = {'pass': False, 'reasons': ['check output unparseable: ' + (c.stdout + c.stderr)[:200]], 'changed': []}
    json.dump(chk, open(f'{rd}/check.json', 'w'))
    fc = classify(chk['pass'], timed_out, ev, ev['final'])
    ps_pct = None
    if ps and ps[0][1]: ps_pct = round(100 * (ps[0][2] or 0) / ps[0][1])
    row = dict(model=model, task=task, run=run, pass_=chk['pass'], failure_class=fc, fake_success=(fc == 'fake_success'),
               wall_s=round(wall, 1), timed_out=timed_out, steps=ev['steps'], tool_calls=ev['tools'], tool_errors=ev['tool_err'], edits=ev['edits'],
               in_tok=ev['in_tok'], out_tok=ev['out_tok'], eff_tok_s=round(ev['out_tok'] / wall, 1) if wall > 0 else None,
               vram_mib_peak=box.get('vram'), gpu_pct=ps_pct, reasons=chk['reasons'][:4], final=ev['final'][:240].replace('\n', ' '), err=ev['err'], ts=time.strftime('%Y-%m-%d %H:%M:%S'))
    sh(f'cd {REPO} && git reset -q --hard && git clean -fdq && git checkout -q -f main')
    return row

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--timeout', type=int, default=900); ap.add_argument('--plan', default=f'{B}/plan.json')
    ap.add_argument('--only'); ap.add_argument('--tasks'); ap.add_argument('--runs', type=int)
    a = ap.parse_args()
    plan = json.load(open(a.plan))  # list of [model, task, run]
    os.makedirs(RUNS, exist_ok=True)
    restore()
    if os.path.isdir(HT): sh(f'cd {HT} && git checkout -q bakeoff-results')
    for model, task, run in plan:
        if a.only and model != a.only: continue
        if a.tasks and str(task) not in a.tasks.split(','): continue
        if a.runs and run > a.runs: continue
        if (model, task, run) in done_keys(): continue
        log('RUN', model, 't%d' % task, 'r%d' % run)
        row = run_one(model, task, run, a.timeout)
        open(RES, 'a').write(json.dumps(row) + '\n')
        log('  ->', 'PASS' if row['pass_'] else 'FAIL', row['failure_class'], f"{row['wall_s']}s", 'out_tok', row['out_tok'], row['reasons'][:1])
        persist(f"{model} t{task} r{run} {row['failure_class']}")
    log('ALL DONE')

if __name__ == '__main__': main()
