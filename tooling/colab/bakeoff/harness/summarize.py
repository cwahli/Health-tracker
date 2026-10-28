#!/usr/bin/env python3
import json, collections, sys, os
B = '/content/bakeoff'
rows = [json.loads(l) for l in open(f'{B}/results.jsonl') if l.strip()]
DEC = {'bench-devstral': 16.6, 'bench-glm': 70.5, 'bench-qwen3-coder': 76.3, 'bench-qwen36': 12.9, 'bench-gemma4': 70.8, 'bench-qwen35-9b': 36.7}
TASKS = {1: 'T1 trivial value edit', 2: 'T2 shared button states', 3: 'T3 multi-file refactor', 4: 'T4 bug fix + test', 5: 'T5 spec to CSS'}
models = []
for r in rows:
    if r['model'] not in models: models.append(r['model'])
out = ['# Local model bake-off (Colab L4 23 GB) — fixed setup', '',
 'Setup: ollama 0.40.12 serve with OLLAMA_CONTEXT_LENGTH=32768, FLASH_ATTENTION=1, KV_CACHE_TYPE=q8_0; models via Modelfile variants with the vendor-recommended sampling; opencode 1.19.5 with an isolated config (limit.context 32768, limit.output 10000; gemma reasoningEffort none). Per run: 900 s timeout, repo reset to the task seed commit, identical prompt, objective check script.', '',
 f'Runs recorded: {len(rows)}. Cell = passes/runs.', '']
hdr = '| Model | ' + ' | '.join(f'T{t}' for t in TASKS) + ' | Total | Mean wall s | Eff tok/s | Decode tok/s | VRAM MiB | GPU% | Fake success |'
out += [hdr, '|' + '---|' * (len(TASKS) + 8)]
for m in models:
    mr = [r for r in rows if r['model'] == m]; cells = []
    for t in TASKS:
        x = [r for r in mr if r['task'] == t]
        cells.append(f"{sum(r['pass_'] for r in x)}/{len(x)}" if x else '-')
    tp = sum(r['pass_'] for r in mr)
    fs = sum(r['fake_success'] for r in mr)
    mean = lambda k: round(sum(r[k] or 0 for r in mr) / len(mr), 1)
    vr = max((r['vram_mib_peak'] or 0) for r in mr)
    gp = min((r['gpu_pct'] if r['gpu_pct'] is not None else 100) for r in mr)
    name = m.split('/')[-1]
    out.append(f"| {name} | " + ' | '.join(cells) + f" | {tp}/{len(mr)} | {mean('wall_s')} | {mean('eff_tok_s')} | {DEC.get(name, '-')} | {vr} | {gp} | {'**' + str(fs) + ' FAKE**' if fs else 0} |")
out += ['', '## Failure classes per model', '']
for m in models:
    c = collections.Counter(r['failure_class'] for r in rows if r['model'] == m)
    out.append(f"- **{m.split('/')[-1]}**: " + ', '.join(f'{k} {v}' for k, v in c.most_common()))
fk = [r for r in rows if r['fake_success']]
if fk:
    out += ['', '## FAKE SUCCESS (claimed done, check failed)', '']
    for r in fk: out.append(f"- {r['model'].split('/')[-1]} T{r['task']} r{r['run']}: \"{r['final'][:120]}\" — check: {r['reasons'][:2]}")
out += ['', '## Per-run detail', '', '| Model | T | r | result | class | wall s | steps | tools | tool err | out tok | first failed check |', '|' + '---|' * 11]
for r in rows:
    out.append(f"| {r['model'].split('/')[-1]} | {r['task']} | {r['run']} | {'PASS' if r['pass_'] else 'FAIL'} | {r['failure_class']} | {r['wall_s']} | {r['steps']} | {r['tool_calls']} | {r['tool_errors']} | {r['out_tok']} | {(r['reasons'][0][:90] if r['reasons'] else '')} |")
tail = f'{B}/RESULTS_NOTES.md'
if os.path.exists(tail): out += ['', open(tail).read()]
open(f'{B}/RESULTS.md', 'w').write('\n'.join(out) + '\n')
print('\n'.join(out[:30]))
