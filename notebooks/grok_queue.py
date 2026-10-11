"""Grok job queue runner for Colab.
Pulls jobs Grok Bot drops on the VPS queue, runs them with OpenCode, and sends the
result back to Grok through the "Worker job finished" webhook. Needs Colab Secrets:
COLABQ_KEY (queue SSH key), HT_WAKE_WEBHOOK_URL, HT_WAKE_WEBHOOK_AUTH. Skips quietly if missing.
"""
import os, subprocess

LOOP = r'''
#!/bin/bash
. ~/.grokq.env
V=colabq@51.254.217.163
S="ssh -i $HOME/.ssh/colabq -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o ServerAliveInterval=30"
case "$WAUTH" in Authorization:*) H="$WAUTH";; Bearer\ *|Basic\ *) H="Authorization: $WAUTH";; *) H="Authorization: Bearer $WAUTH";; esac
ping(){ python3 -c 'import json,sys;print(json.dumps({"session":"colab-"+sys.argv[1],"verdict":sys.argv[2]}))' "$1" "$2" |
  curl -s -m 20 -o /dev/null -w "%{http_code}\n" -X POST -H "$H" -H "Content-Type: application/json" --data-binary @- "$WURL"; }
echo "loop start $(date)"; ping start "Colab runner started $(date -u +%H:%MZ)"
while true; do
  $S $V 'date +%s > ~/queue/heartbeat' 2>/dev/null
  n=$($S $V 'ls ~/queue/inbox/*.txt 2>/dev/null | head -1 | xargs -r basename | sed "s/\.txt$//"' 2>/dev/null)
  if [ -n "$n" ] && $S $V "mv ~/queue/inbox/$n.txt ~/queue/running/$n.txt"; then
    d=~/jobs/$n; mkdir -p $d; cd $d
    $S $V "cat ~/queue/running/$n.txt" > PROMPT.txt
    echo "job $n start $(date)"
    ( while sleep 60; do $S $V 'date +%s > ~/queue/heartbeat' 2>/dev/null; done ) & HB=$!
    timeout 6h opencode run "$(cat PROMPT.txt)
(Work only in $d. Write your final answer to $d/REPORT.md.)" > run.log 2>&1; rc=$?
    kill $HB
    [ -s REPORT.md ] || tail -c 3000 run.log > REPORT.md
    tar czf - . | $S $V "mkdir -p ~/queue/done/$n && tar xzf - -C ~/queue/done/$n && rm -f ~/queue/running/$n.txt"
    st=DONE; [ $rc -ne 0 ] && st="FAILED(rc=$rc)"
    ping "$n" "$st: $n. $(head -c 1500 REPORT.md)"
    echo "job $n $st $(date)"; cd ~
  fi
  sleep 60
done
'''

def _fix_key(k):
    """Rebuild an OpenSSH private key whose line breaks were lost when pasted into Secrets."""
    import re, textwrap
    k = k.strip().replace("\\n", "\n").replace("\r", "")
    m = re.search(r"-----BEGIN ([A-Z ]+)-----(.*?)-----END \1-----", k, re.S)
    if not m:
        return k + "\n"
    body = re.sub(r"\s+", "", m.group(2))
    return f"-----BEGIN {m.group(1)}-----\n" + "\n".join(textwrap.wrap(body, 70)) + f"\n-----END {m.group(1)}-----\n"

def start():
    key = url = auth = None
    try:
        from google.colab import userdata
        key = userdata.get("COLABQ_KEY"); url = userdata.get("HT_WAKE_WEBHOOK_URL"); auth = userdata.get("HT_WAKE_WEBHOOK_AUTH")
    except Exception as e:
        print(f"• Grok queue: secrets not readable here ({e.__class__.__name__}), trying saved files.")
    home0 = os.path.expanduser("~")
    if not (key and url and auth) and os.path.exists(f"{home0}/.grokq.env") and os.path.exists(f"{home0}/.ssh/colabq"):
        return _launch(home0)
    if not (key and url and auth):
        print("• Grok queue: COLABQ_KEY / HT_WAKE_WEBHOOK_URL / HT_WAKE_WEBHOOK_AUTH missing, skipped."); return False
    home = os.path.expanduser("~"); os.makedirs(f"{home}/.ssh", exist_ok=True)
    with open(f"{home}/.ssh/colabq", "w") as f: f.write(_fix_key(key))
    os.chmod(f"{home}/.ssh/colabq", 0o600)
    with open(f"{home}/.grokq.env", "w") as f: f.write(f"WURL='{url.strip()}'\nWAUTH='{auth.strip()}'\n")
    return _launch(home)

def _launch(home):
    with open(f"{home}/grokq.sh", "w") as f: f.write(LOOP)
    subprocess.run("command -v ssh >/dev/null || (apt-get -qq update && apt-get -qq install -y openssh-client) >/dev/null 2>&1", shell=True)
    pidf = f"{home}/grokq.pid"
    try:
        os.kill(int(open(pidf).read()), 15)
    except Exception:
        pass
    log = open(f"{home}/grokq.log", "a")
    p = subprocess.Popen(["bash", f"{home}/grokq.sh"], stdout=log, stderr=log, stdin=subprocess.DEVNULL, start_new_session=True)
    open(pidf, "w").write(str(p.pid))
    print(f"• Grok queue: runner started pid {p.pid} (log {home}/grokq.log).", flush=True); return True

if __name__ == "__main__":
    start()
