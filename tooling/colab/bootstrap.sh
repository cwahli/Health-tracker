#!/usr/bin/env bash
# tooling/colab/bootstrap.sh - idempotent Colab runtime bootstrap.
#
# Reinstalls/starts everything the Colab agent needs after a runtime reset:
#   base apt tools, git identity, Node 20, sage-prototypes + figma-proxy clones,
#   npm installs, Ollama (+serve in tmux, GPU only), qwen3-coder model pull
#   (background, GPU only), OpenCode + config merge, job tooling (watcher/dash).
#
# Every step checks first, so a re-run is a fast no-op. Non-fatal failures never
# stop the run. Log: /content/bootstrap.log   Status: /content/bootstrap.status
#
# Optional env (never printed; URLs/tokens are masked in the log):
#   SAGE_REPO_URL          authenticated clone URL of cwah123/sage-prototypes
#   SAGE_GITHUB_TOKEN      alternative: token used to build that URL
#   SAGE_WATCHER_WEBHOOK_URL / SAGE_WATCHER_WEBHOOK_AUTH   for sage-watch.py
#   OLLAMA_MODEL           default qwen3-coder:30b
# Usage: bash bootstrap.sh            (run in background from the notebook)
set -u
export DEBIAN_FRONTEND=noninteractive
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="${BOOTSTRAP_LOG:-/content/bootstrap.log}"
STATUS="${BOOTSTRAP_STATUS:-/content/bootstrap.status}"
MODEL="${OLLAMA_MODEL:-qwen3-coder:30b}"
FIGMA_DIR="${FIGMA_PROXY_DIR:-/root/figma-proxy}"
MCP_DIR="$FIGMA_DIR/tooling/opencode-mcp-figma-remote"
SAGE_DIR="${SAGE_DIR:-/content/sage-prototypes}"
OC_CFG="${OPENCODE_CONFIG_FILE:-$HOME/.config/opencode/opencode.json}"
JOBS=/content/jobs; BIN=/content/bin
mkdir -p /content "$(dirname "$LOG")" 2>/dev/null

mask() { sed -E 's#//[^@/[:space:]]*@#//***@#g'; }
log()  { printf '%s %s\n' "$(date '+%F %T')" "$*" | mask >>"$LOG"; }
# q: run a command, append masked output to the log, keep its exit code
q()    { "$@" 2>&1 | mask >>"$LOG"; return "${PIPESTATUS[0]}"; }
have() { command -v "$1" >/dev/null 2>&1; }
has_gpu() { have nvidia-smi && nvidia-smi -L >/dev/null 2>&1; }

set_status() { # name state detail  (atomic-ish, serialised by flock)
  ( flock 9
    { [ -f "$STATUS" ] && grep -v -E "^$1 " "$STATUS" | grep -v '^updated '; printf '%s %s %s\n' "$1" "$2" "$3"; printf 'updated %s\n' "$(date '+%F %T')"; } >"$STATUS.tmp" 2>/dev/null
    mv -f "$STATUS.tmp" "$STATUS" ) 9>"$STATUS.lock"
}

# ---- background mode: model pull worker (re-invokes this script) -------------
if [ "${1:-}" = "--pull-worker" ]; then
  log "pull-worker: ollama pull $MODEL"
  if q ollama pull "$MODEL"; then set_status ollama-model OK "$MODEL pulled"; log "pull-worker: done"
  else set_status ollama-model FAIL "pull of $MODEL failed (see $LOG)"; log "pull-worker: FAILED"; fi
  exit 0
fi

# ---- single instance ---------------------------------------------------------
exec 8>/content/bootstrap.lock
if ! flock -n 8; then echo "bootstrap already running; see $LOG"; exit 0; fi

: >"$STATUS"; rm -f "$STATUS.lock"
T0=$(date +%s)
log "=== bootstrap start (host=$(hostname), gpu=$(has_gpu && echo yes || echo no), repo=$HERE) ==="
ORDER=(); declare -A RS RD
# step <name> <fn>: fn sets R_STATE (OK|FAIL|SKIP|PULLING) and R_DETAIL
step() {
  local n="$1" fn="$2"; R_STATE=FAIL; R_DETAIL=""
  log "--- $n"
  "$fn" || { [ "$R_STATE" = OK ] && R_STATE=FAIL; [ -n "$R_DETAIL" ] || R_DETAIL="exit non-zero"; }
  ORDER+=("$n"); RS[$n]=$R_STATE; RD[$n]=$R_DETAIL
  set_status "$n" "$R_STATE" "$R_DETAIL"; log "$n: $R_STATE $R_DETAIL"
}
ok()   { R_STATE=OK;   R_DETAIL="$*"; return 0; }
skip() { R_STATE=SKIP; R_DETAIL="$*"; return 0; }
fail() { R_STATE=FAIL; R_DETAIL="$*"; return 1; }

sage_url() {
  if [ -n "${SAGE_REPO_URL:-}" ]; then printf '%s' "$SAGE_REPO_URL"; return; fi
  local d; for d in "$FIGMA_DIR" "$SAGE_DIR"; do
    [ -d "$d/.git" ] && { git -C "$d" remote get-url origin 2>/dev/null; return; }
  done
  [ -n "${SAGE_GITHUB_TOKEN:-}" ] && printf 'https://%s@github.com/cwah123/sage-prototypes.git' "$SAGE_GITHUB_TOKEN"
}

# ---- steps -------------------------------------------------------------------
s_base() {
  local need=() c
  for c in tmux curl git zstd flock python3; do have "$c" || need+=("$c"); done
  [ ${#need[@]} -eq 0 ] && { ok "tmux curl git zstd present"; return; }
  local pk=("${need[@]/flock/util-linux}")
  q apt-get update -qq; q apt-get install -y -qq "${pk[@]}" || fail "apt install ${pk[*]}"
  for c in "${need[@]}"; do have "$c" || { fail "missing $c"; return; }; done
  ok "installed ${need[*]}"
}
s_git_identity() {
  [ "$(git config --global user.name 2>/dev/null)" ] || q git config --global user.name cwahli
  [ "$(git config --global user.email 2>/dev/null)" ] || q git config --global user.email cwahli@users.noreply.github.com
  ok "$(git config --global user.name)"
}
s_node() {
  local v; v=$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')
  if [ -n "$v" ] && [ "$v" -ge 20 ]; then ok "node $(node -v)"; return; fi
  q bash -c 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash -' && q apt-get install -y -qq nodejs
  v=$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')
  [ -n "$v" ] && [ "$v" -ge 20 ] && ok "installed node $(node -v)" || fail "node install failed"
}
sage_identity() { # repo-local author = cwah123 (Vercel Hobby blocks deploys of commits authored by anyone else)
  q git -C "$1" config user.name cwah123; q git -C "$1" config user.email 260443071+cwah123@users.noreply.github.com
}
s_sage_clone() {
  if [ -d "$SAGE_DIR/.git" ]; then sage_identity "$SAGE_DIR"; ok "present $(git -C "$SAGE_DIR" rev-parse --short HEAD 2>/dev/null)"; return; fi
  local url; url=$(sage_url)
  [ -n "$url" ] || { skip "no SAGE_REPO_URL/SAGE_GITHUB_TOKEN and no existing clone to copy the URL from"; return; }
  q git clone "$url" "$SAGE_DIR" && sage_identity "$SAGE_DIR" && ok "cloned $(git -C "$SAGE_DIR" rev-parse --short HEAD)" || fail "git clone failed"
}
s_figma_clone() {
  if [ -d "$FIGMA_DIR/.git" ]; then sage_identity "$FIGMA_DIR"; ok "present"; return; fi
  local url; url=$(sage_url)
  [ -n "$url" ] || { skip "no SAGE_REPO_URL/SAGE_GITHUB_TOKEN to clone $FIGMA_DIR"; return; }
  q git clone --filter=blob:none "$url" "$FIGMA_DIR" && sage_identity "$FIGMA_DIR" && ok "cloned" || fail "git clone failed"
}
npm_dir() { # dir -> ensures deps installed
  local d="$1"
  [ -f "$d/package.json" ] || { skip "no package.json in $d"; return 0; }
  if (cd "$d" && npm ls --depth=0 >/dev/null 2>&1); then ok "deps up to date"; return 0; fi
  (cd "$d" && q npm install --no-audit --no-fund) && ok "npm install done" || fail "npm install failed"
}
s_npm_proxy() { npm_dir "$FIGMA_DIR"; }
s_npm_mcp() {
  npm_dir "$MCP_DIR"; local rc=$?
  [ "$R_STATE" = SKIP ] && return 0
  [ "$R_STATE" = OK ] || return $rc
  if [ ! -f "$MCP_DIR/dist/proxy-server.js" ]; then   # dist/ is gitignored -> build it
    (cd "$MCP_DIR" && q npx --no-install tsc) && [ -f "$MCP_DIR/dist/proxy-server.js" ] \
      && ok "deps ok, built dist" || fail "tsc build of dist failed"
  else R_DETAIL="deps ok, dist present"; fi
}
s_ollama() {
  has_gpu || { skip "no GPU (CPU runtime)"; return 0; }
  if have ollama; then ok "$(ollama -v 2>&1 | grep -o '[0-9][0-9.]*' | head -1)"; return; fi
  q bash -c 'curl -fsSL https://ollama.com/install.sh | sh'; have ollama && ok "installed $(ollama -v 2>&1 | grep -o '[0-9][0-9.]*' | head -1)" || fail "ollama install failed"
}
ollama_up() { curl -fs -m 3 http://127.0.0.1:11434/api/version >/dev/null 2>&1; }
s_ollama_serve() {
  has_gpu || { skip "no GPU"; return 0; }
  have ollama || { fail "ollama not installed"; return 1; }
  if ollama_up; then ok "serving :11434"; return; fi
  tmux kill-session -t ollama 2>/dev/null
  tmux new-session -d -s ollama "OLLAMA_CONTEXT_LENGTH=32768 OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 OLLAMA_KEEP_ALIVE=-1 ollama serve > /content/ollama_serve.log 2>&1" 8>&-
  local i; for i in $(seq 1 60); do ollama_up && { ok "started tmux:ollama"; return; }; sleep 1; done
  fail "server did not come up in 60s (see /content/ollama_serve.log)"
}
s_ollama_model() {
  has_gpu || { skip "no GPU"; return 0; }
  ollama_up || { fail "ollama server not up"; return 1; }
  if ollama list 2>/dev/null | awk 'NR>1{print $1}' | grep -qx "$MODEL"; then ok "$MODEL present"; return; fi
  if pgrep -f "ollama pull $MODEL" >/dev/null 2>&1; then R_STATE=PULLING; R_DETAIL="$MODEL pull already running (tail /content/pull.log)"; return 0; fi
  nohup bash "$HERE/bootstrap.sh" --pull-worker >>/content/pull.log 2>&1 </dev/null 8>&- &
  disown 2>/dev/null
  R_STATE=PULLING; R_DETAIL="$MODEL pull started in background (tail /content/pull.log)"
}
s_opencode() {
  local b="$HOME/.opencode/bin/opencode"
  if [ ! -x "$b" ]; then q bash -c 'curl -fsSL https://opencode.ai/install | bash'; fi
  [ -x "$b" ] || { fail "opencode binary missing after install"; return 1; }
  [ "$(readlink /usr/local/bin/opencode 2>/dev/null)" = "$b" ] || ln -sf "$b" /usr/local/bin/opencode
  [ -x /usr/local/bin/opencode ] && ok "opencode -> /usr/local/bin" || fail "symlink failed"
}
s_opencode_cfg() {
  mkdir -p "$(dirname "$OC_CFG")"
  OC_CFG="$OC_CFG" GPU=$(has_gpu && echo 1 || echo 0) MODEL="$MODEL" MCP_DIR="$MCP_DIR" python3 - <<'PY' 2>&1 | mask >>"$LOG"
import json, os, sys
p = os.environ["OC_CFG"]; model = os.environ["MODEL"]
try:
    cfg = json.load(open(p)) if os.path.exists(p) else {}
    assert isinstance(cfg, dict)
except Exception as e:
    print("config unreadable, NOT touching it:", e); sys.exit(3)
def merge(dst, src):  # fill only what is missing; never override existing values
    for k, v in src.items():
        if k not in dst: dst[k] = v
        elif isinstance(dst[k], dict) and isinstance(v, dict): merge(dst[k], v)
want = {"$schema": "https://opencode.ai/config.json",
  "permission": {"external_directory": "allow", "edit": "allow", "bash": "allow"},
  "mcp": {"figma": {"type": "local", "command": ["node", os.environ["MCP_DIR"] + "/dist/proxy-server.js"],
          "enabled": True, "environment": {"NODE_TLS_REJECT_UNAUTHORIZED": "0"}}}}
if os.environ["GPU"] == "1":
    want["provider"] = {"ollama": {"npm": "@ai-sdk/openai-compatible", "name": "Ollama (Colab GPU)",
        "options": {"baseURL": "http://127.0.0.1:11434/v1"},
        "models": {model: {"name": model + " (local)", "tool_call": True, "limit": {"context": 32768, "output": 8192}}}}}
    want["model"] = "ollama/" + model
before = json.dumps(cfg, sort_keys=True)
merge(cfg, want)
if json.dumps(cfg, sort_keys=True) == before: print("opencode.json unchanged"); sys.exit(0)
json.dump(cfg, open(p + ".tmp", "w"), indent=2); os.replace(p + ".tmp", p); print("opencode.json merged")
PY
  local rc=${PIPESTATUS[0]}
  [ "$rc" = 0 ] && ok "$(grep -c . "$OC_CFG") lines, valid" || fail "config merge rc=$rc"
}
s_dirs() { mkdir -p "$JOBS" "$BIN" && ok "$JOBS $BIN" || fail "mkdir"; }
s_job_scripts() {
  local f changed=0
  for f in sage-watch.py jobs-dash.sh; do
    [ -f "$HERE/$f" ] || { fail "$f missing beside bootstrap.sh"; return 1; }
    cmp -s "$HERE/$f" "$BIN/$f" || { install -m 755 "$HERE/$f" "$BIN/$f"; changed=1; }
  done
  JOB_SCRIPTS_CHANGED=$changed; ok "installed in $BIN$([ $changed = 1 ] && echo ' (updated)')"
}
write_watch_env() { # keep webhook secrets in a 0600 file, not on any command line
  [ -n "${SAGE_WATCHER_WEBHOOK_URL:-}" ] || return 0
  ( umask 077; printf 'SAGE_WATCHER_WEBHOOK_URL=%q\nSAGE_WATCHER_WEBHOOK_AUTH=%q\n' "$SAGE_WATCHER_WEBHOOK_URL" "${SAGE_WATCHER_WEBHOOK_AUTH:-}" >/content/.sage-watch.env )
}
ensure_tmux() { # name cmd
  local n="$1"; shift
  if tmux has-session -t "$n" 2>/dev/null && [ "${JOB_SCRIPTS_CHANGED:-0}" = 0 ]; then return 0; fi
  tmux kill-session -t "$n" 2>/dev/null; tmux new-session -d -s "$n" "$*" 8>&-
}
s_sage_watch() {
  write_watch_env
  ensure_tmux sage-watch "python3 $BIN/sage-watch.py 2>&1 | tee -a /content/sage-watch.log"; sleep 1
  tmux has-session -t sage-watch 2>/dev/null || { fail "tmux sage-watch not running"; return 1; }
  ok "tmux sage-watch$([ -z "${SAGE_WATCHER_WEBHOOK_URL:-}" ] && [ ! -f /content/.sage-watch.env ] && echo ' (webhook unset: no posts)')"
}
s_jobs_dash() {
  ensure_tmux colab-jobs "bash $BIN/jobs-dash.sh"; sleep 1
  tmux has-session -t colab-jobs 2>/dev/null && ok "tmux colab-jobs" || fail "tmux colab-jobs not running"
}

step base-tools     s_base
step git-identity   s_git_identity
step node20         s_node
step sage-clone     s_sage_clone
step figma-clone    s_figma_clone
step npm-figma-proxy s_npm_proxy
step npm-figma-mcp  s_npm_mcp
step ollama         s_ollama
step ollama-serve   s_ollama_serve
step ollama-model   s_ollama_model
step opencode       s_opencode
step opencode-config s_opencode_cfg
step job-dirs       s_dirs
step job-scripts    s_job_scripts
step sage-watch     s_sage_watch
step colab-jobs     s_jobs_dash

# ---- summary -----------------------------------------------------------------
bad=0; { echo "=== bootstrap summary ($(( $(date +%s) - T0 ))s) ==="
  for n in "${ORDER[@]}"; do printf '%-20s %-8s %s\n' "$n" "${RS[$n]}" "${RD[$n]}"; [ "${RS[$n]}" = FAIL ] && bad=1; done
  [ $bad = 0 ] && echo "RESULT: OK (no failures)" || echo "RESULT: FAIL (see $LOG)"; } | tee -a "$LOG" | mask
set_status RESULT "$([ $bad = 0 ] && echo OK || echo FAIL)" "finished in $(( $(date +%s) - T0 ))s"
exit $bad
