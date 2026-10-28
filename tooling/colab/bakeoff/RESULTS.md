# Local model bake-off (Colab L4 23 GB) — fixed setup

Setup: ollama 0.40.12 serve with OLLAMA_CONTEXT_LENGTH=32768, FLASH_ATTENTION=1, KV_CACHE_TYPE=q8_0; models via Modelfile variants with the vendor-recommended sampling; opencode 1.19.5 with an isolated config (limit.context 32768, limit.output 10000; gemma reasoningEffort none). Per run: 900 s timeout, repo reset to the task seed commit, identical prompt, objective check script.

Runs recorded: 1. Cell = passes/runs.

| Model | T1 | T2 | T3 | T4 | T5 | Total | Mean wall s | Eff tok/s | Decode tok/s | VRAM MiB | GPU% | Fake success |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bench-qwen3-coder | 1/1 | - | - | - | - | 1/1 | 8.6 | 24.8 | 76.3 | 19570 | 100 | 0 |

## Failure classes per model

- **bench-qwen3-coder**: pass 1

## Per-run detail

| Model | T | r | result | class | wall s | steps | tools | tool err | out tok | first failed check |
|---|---|---|---|---|---|---|---|---|---|---|
| bench-qwen3-coder | 1 | 1 | PASS | pass | 8.6 | 3 | 2 | 0 | 214 |  |
