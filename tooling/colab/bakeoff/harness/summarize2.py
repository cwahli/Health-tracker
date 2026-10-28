#!/usr/bin/env python3
"""Partial/final RESULTS.md: per-model table with passes/3, fakes, median wall of passing runs, plus key and versions."""
import json, statistics, subprocess, datetime, os
B='/content/bakeoff'
subprocess.run(['python3',f'{B}/harness/summarize.py'],capture_output=True)   # regenerates base incl. per-run detail
base=open(f'{B}/RESULTS.md').read()
tail=base[base.index('## Failure classes per model'):] if '## Failure classes per model' in base else ''
rows=[json.loads(l) for l in open(f'{B}/results.jsonl') if l.strip().startswith('{')]
def name(m):
    m=m.split('/')[-1]
    return {'qwen3.8-fixed':'qwen3.8 (fixed renderer, easy rerun)','bench-qwen38r':'qwen3.8 (fixed renderer, hard)','bench-qwen38':'qwen3.8 (original, buggy renderer)'}.get(m,m.replace('bench-',''))
models=[]
for r in rows:
    if name(r['model']) not in models: models.append(name(r['model']))
tasks=[1,2,3,4,5,11,6,7,12]
TN={1:'T1',2:'T2',3:'T3',4:'T4',5:'T5',11:'T11 quiz*',6:'T6 bugfix',7:'T7 refactor',12:'T12 tertiary'}
out=['# Local model bake-off (Colab L4 23 GB) — PARTIAL, updated '+datetime.datetime.now().strftime('%Y-%m-%d %H:%M')+' (Europe/London)','',
'## How to read this','',
'- Each cell is **passes out of 3** runs for that task. **Higher is better.** `0/3` means the model failed all 3 runs. A dash `-` means it was **not run** on that task (yet).',
'- **Fakes** = runs where the model said it was done but the independent check failed (fewer is better; more than 1 eliminates a model).',
'- **Median s** = median wall-clock seconds of the *passing* runs only (lower is better). Hard-task cap per run is 1800 s.',
'- Elimination rule: under 2/3 on two or more hard tasks (T11, T6, T7, T12), or more than 1 fake success. Survivors ranked by time.',
'- `*` T11 is a **suspect task**: every model (including MiMo reference) has so far failed it, mostly by never producing an edit/timeout at 1803 s. The reference solution (commit 15732a48) passes the checker, so the check is satisfiable; verdict is pending the MiMo x3 rule. T12 is queued, not started.','',
'| Model | '+' | '.join(TN[t] for t in tasks)+' | Fakes | Median s (passes) |','|'+'---|'*(len(tasks)+3)]
for m in models:
    mr=[r for r in rows if name(r['model'])==m]; cells=[]
    for t in tasks:
        x=[r for r in mr if r['task']==t]
        cells.append(f"{sum(r['pass_'] for r in x)}/3" if len(x)==3 else (f"{sum(r['pass_'] for r in x)}/{len(x)} (partial)" if x else '-'))
    ps=[r['wall_s'] for r in mr if r['pass_']]
    out.append(f"| {m} | "+' | '.join(cells)+f" | {sum(bool(r['fake_success']) for r in mr)} | {round(statistics.median(ps)) if ps else '-'} |")
out+=['','Note: MiMo (reference) has 1 run per task so far (1/1 each on T1-T5, 0/1 on T11), not 3.','',
'## qwen3.8: original vs fixed','',
'The original qwen3.8 hit an Ollama renderer 500 ("no user query found") on parallel tool-call continuations. Variant `bench-qwen38r` adds `RENDERER qwen3.5` as a workaround (same weights/sampling). Easy tasks T1-T5 x3: original 9/15 -> fixed **15/15**. Compare qwen3.6 on the same tasks: 13/15 (T3 2/3, T4 2/3).','',
'## Exact model versions (Ollama 0.40.12, 32k ctx, flash-attn, q8_0 KV, opencode 1.19.5)','',
'| Bench name | Base model tag | Notes |','|---|---|---|',
'| qwen3.8 | qwen3.8:27b (id aaee06c39dcf) | temp 1.0 top_p 0.95 top_k 20; `r` variant adds RENDERER qwen3.5 |',
'| qwen3.6 | qwen3.6:27b (bcbdbd4bcf86) | temp 0.6 top_p 0.95 top_k 20 |',
'| glm | glm-4.7-flash:q4_K_M (4475827791a2) | GLM-4.7-Flash, Q4_K_M quant; temp 0.7 top_p 1.0 min_p 0.01 |',
'| devstral | devstral-small-2:latest (24277f07f62d) | temp 0.15 |',
'| qwen3-coder | qwen3-coder:30b (06c1097efce0) | temp 0.7 top_p 0.8 top_k 20 rep 1.05 |',
'| gemma4 | gemma4:26b-a4b-it-qat (2dd70431afed) | temp 1.0 top_p 0.95 top_k 64 |',
'| qwen35-9b | qwen3.5:9b (56671c2ab938) | temp 0.6 top_p 0.95 top_k 20 |',
'| MiMo (reference) | opencode/mimo-v2.6-flash-free | hosted free tier |','| DeepSeek (fallback) | opencode/deepseek-v4.1-flash-free | hosted; used only if MiMo is rate-limited |','']
open(f'{B}/RESULTS.md','w').write('\n'.join(out)+'\n'+tail)
print('\n'.join(out))

try:
    import sys; sys.path.insert(0,"/content/bakeoff/harness"); import realwork; realwork.summary()
except Exception as e: print('realwork block skipped:',e)
