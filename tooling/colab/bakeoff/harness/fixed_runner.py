#!/usr/bin/env python3
"""qwen3.8-fixed: easy suite T1-T5 x3 on bench-qwen38r (same weights, RENDERER qwen3.5, avoids Ollama's 'no user query found' 500).
Thinking: MEDIUM requested via reasoning_effort if Ollama accepts it for this renderer, else default thinking-on (recorded in qwen38fixed_settings.json).
Rows are recorded under model 'qwen3.8-fixed' (separate from the first 'ollama/bench-qwen38' run). Persisted after every run."""
import json, os, sys, time, urllib.request, urllib.error
sys.path.insert(0, '/content/bakeoff/harness')
import bench
from bench import RES, RUNS, log, persist, restore, sh, done_keys, HT, run_one, warm
M = 'ollama/bench-qwen38r'; LABEL = 'qwen3.8-fixed'
CFG = '/content/bakeoff/xdg/opencode/opencode.json'

def preflight():
    info = {'ts': time.strftime('%F %T')}
    warm(M)
    def call(extra):
        body = dict(model='bench-qwen38r', messages=[{'role': 'user', 'content': 'What is 17*23? Think briefly.'}], max_tokens=600, **extra)
        try:
            r = urllib.request.urlopen(urllib.request.Request('http://localhost:11434/v1/chat/completions', json.dumps(body).encode(), {'Content-Type': 'application/json'}), timeout=300)
            m = json.loads(r.read())['choices'][0]['message']
            return 200, bool(m.get('reasoning')), len(m.get('reasoning') or '')
        except urllib.error.HTTPError as e: return e.code, None, e.read()[:200].decode('utf8', 'replace')
        except Exception as e: return 0, None, str(e)[:200]
    base = call({}); med = call({'reasoning_effort': 'medium'})
    info['default'] = base; info['reasoning_effort_medium'] = med
    cfg = json.load(open(CFG)); mod = cfg['provider']['ollama']['models']['bench-qwen38r']
    if med[0] == 200 and med[1]:
        mod.setdefault('options', {})['reasoningEffort'] = 'medium'; info['applied'] = 'reasoning_effort=medium accepted; thinking on'
    else:
        mod.pop('options', None); info['applied'] = 'medium NOT selectable on qwen3.5 renderer (only think true/false); default thinking ON'
    json.dump(cfg, open(CFG, 'w'), indent=2)
    json.dump(info, open('/content/bakeoff/qwen38fixed_settings.json', 'w'), indent=1)
    log('qwen3.8-fixed preflight:', info)

def main():
    restore()
    if os.path.isdir(HT): sh(f'cd {HT} && git checkout -q bakeoff-results')
    preflight()
    for run in (1, 2, 3):
        for task in (1, 2, 3, 4, 5):
            if (LABEL, task, run) in done_keys(): continue
            log('RUN', LABEL, 't%d' % task, 'r%d' % run)
            row = run_one(M, task, run, 900)
            row['model'] = LABEL; row['ollama_model'] = 'bench-qwen38r'; row['thinking'] = json.load(open('/content/bakeoff/qwen38fixed_settings.json'))['applied']
            open(RES, 'a').write(json.dumps(row) + '\n')
            log('  ->', 'PASS' if row['pass_'] else 'FAIL', row['failure_class'], f"{row['wall_s']}s", 'out_tok', row['out_tok'], row['reasons'][:1])
            persist(f"{LABEL} t{task} r{run} {row['failure_class']}")
    log('qwen3.8-fixed ALL DONE')

if __name__ == '__main__': main()
