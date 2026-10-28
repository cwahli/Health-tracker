# Prior work reviewed (not reused as numbers)
- /workspace/bake, /workspace/bake2 (box): generic non-Sage A/B/C tasks (HTML table extraction etc.) run with opencode/cline on Colab, mostly cloud free models and ollama qwen3-coder:30b / gemma4. Pre-fix setup (Ollama /v1 truncating the prompt to the default context, no sampling variants). Harness ideas reused: timeout-wrapped opencode run, untimed warm-up, objective hidden check, results TSV.
- Health-tracker golden/scorecard/current/FREE_MODEL_BAKEOFF.md: cloud free-model log (Sept 2026); no local-model numbers.
- docs/MODEL-BENCHMARK-RANKING.md: no devstral/glm local data.
- Earlier sub-agent sand-subagent-02b629b9 (T1-T3 + devstral/glm numbers): ReadTranscript could not read it from here, so its numbers could not be recovered. Anything it measured was on the unfixed setup (16384 ctx limit in opencode.json, default Ollama context) and should not be compared with this table.
- Colab global opencode.json (before this bake-off) pointed at ollama/qwen3-coder:30b with limit.context 16384 / output 8192 (unfixed).
