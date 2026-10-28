#!/usr/bin/env python3
"""sage-watch.py - zero-model job watcher for /content/jobs (stdlib only).

Job = directory /content/jobs/<id>/. State is derived from files, no LLM:
  DONE     marker file DONE/done/.done, or status file starting ok/done/success/finished,
           or exit-code file (exit_code/exit/rc) containing 0
  DEAD     status failed/error, non-zero exit code, or a pid file whose process is gone
  WORKING  pid alive (or no pid) and newest file/log activity within STALL seconds
  STALLED  no activity for > STALL seconds (default 600) while not finished
Activity = newest mtime among top-level files and files in logs/ (repo dirs ignored).

Usage:  sage-watch.py            loop forever, post state changes to the webhook
        sage-watch.py --list     print TSV: id state age_s log_path (used by jobs-dash.sh)
Env (or /content/.sage-watch.env as KEY=VALUE lines, re-read every poll):
  SAGE_WATCHER_WEBHOOK_URL   POST target; unset -> nothing is posted
  SAGE_WATCHER_WEBHOOK_AUTH  "Name: value" header, or just a value for Authorization
  SAGE_JOBS_DIR (/content/jobs)  SAGE_STALL_SECS (600)  SAGE_WATCH_INTERVAL (60)
  SAGE_REALERT_SECS (3600)
Alerts (state in .watch-state.json): 'done' once when DONE appears; 'idle' when run.log
has not grown/changed for SAGE_STALL_SECS (re-alert <= hourly, reset when log moves);
'dead' once when tmux colabjob-<id> is gone without DONE. Payload has last 30 scrubbed log lines.
"""
import json, os, re, subprocess, shlex, socket, sys, time, urllib.request

JOBS = os.environ.get("SAGE_JOBS_DIR", "/content/jobs")
STALL = int(os.environ.get("SAGE_STALL_SECS", "600"))
EVERY = int(os.environ.get("SAGE_WATCH_INTERVAL", "60"))
STATE_FILE = os.path.join(JOBS, ".watch-state.json")
ENV_FILE = "/content/.sage-watch.env"
DONE_WORDS = {"ok", "done", "success", "finished", "complete", "completed"}
FAIL_WORDS = {"failed", "fail", "error", "dead"}


def read1(path):
    try:
        with open(path, errors="replace") as f:
            return f.read(200).strip()
    except OSError:
        return None


def alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except (ValueError, ProcessLookupError):
        return False
    except PermissionError:
        return True


def files_of(d):
    out = []
    for base in (d, os.path.join(d, "logs")):
        try:
            out += [os.path.join(base, n) for n in os.listdir(base)]
        except OSError:
            pass
    return [p for p in out if os.path.isfile(p)]


def log_of(d):
    logs = [p for p in files_of(d) if p.endswith((".log", ".out", ".txt")) or os.path.basename(p) == "log"]
    return max(logs, key=lambda p: os.path.getmtime(p)) if logs else ""


def job_state(d, now):
    fs = files_of(d)
    age = int(now - max((os.path.getmtime(p) for p in fs), default=os.path.getmtime(d)))
    names = {os.path.basename(p) for p in fs}
    if names & {"DONE", "done", ".done"}:
        return "DONE", age
    word = (read1(os.path.join(d, "status")) or "").split(" ")[0].lower().strip(":")
    if word in DONE_WORDS:
        return "DONE", age
    if word in FAIL_WORDS:
        return "DEAD", age
    for n in ("exit_code", "exit", "rc"):
        v = read1(os.path.join(d, n))
        if v is not None:
            return ("DONE" if v.split()[:1] == ["0"] else "DEAD"), age
    pid = read1(os.path.join(d, "pid")) or read1(os.path.join(d, "job.pid"))
    if pid and not alive(pid):
        return "DEAD", age
    return ("WORKING" if age <= STALL else "STALLED"), age


def scan():
    now, rows = time.time(), []
    try:
        ids = sorted(n for n in os.listdir(JOBS) if os.path.isdir(os.path.join(JOBS, n)) and not n.startswith("."))
    except OSError:
        ids = []
    for i in ids:
        d = os.path.join(JOBS, i)
        st, age = job_state(d, now)
        rows.append((i, st, age, log_of(d)))
    return rows


def load_env():
    try:
        for line in open(ENV_FILE):
            if "=" in line and not line.startswith("#"):
                k, _, v = line.rstrip("\n").partition("=")
                v = shlex.split(v)
                if k.startswith("SAGE_") and v:
                    os.environ[k] = v[0]
    except OSError:
        pass


def post(payload):
    url = os.environ.get("SAGE_WATCHER_WEBHOOK_URL")
    if not url:
        return
    hdr = {"Content-Type": "application/json", "User-Agent": "sage-watch"}
    auth = os.environ.get("SAGE_WATCHER_WEBHOOK_AUTH", "")
    if auth:
        name, sep, val = auth.partition(": ")
        hdr.update({name: val} if sep else {"Authorization": auth})
    try:
        urllib.request.urlopen(urllib.request.Request(url, json.dumps(payload).encode(), hdr), timeout=15).read()
    except Exception as e:  # never log the URL/headers
        print("webhook post failed:", type(e).__name__, flush=True)


REALERT = int(os.environ.get("SAGE_REALERT_SECS", "3600"))
SECRET_RE = re.compile(r"(ghp_|gho_|ghs_|github_pat_|figd_)[A-Za-z0-9_\-]+|(?<=://)[^/\s@]+@")


def scrub(text):
    return SECRET_RE.sub(lambda m: "[REDACTED]@" if m.group(0).endswith("@") else m.group(1) + "[REDACTED]", text)


def tail(path, n=30):
    try:
        with open(path, "rb") as f:
            f.seek(0, 2); f.seek(max(0, f.tell() - 65536))
            return scrub("\n".join(f.read().decode("utf-8", "replace").splitlines()[-n:]))
    except OSError:
        return ""


def tmux_sessions():
    try:
        out = subprocess.run(["tmux", "ls", "-F", "#{session_name}"], capture_output=True, text=True, timeout=10).stdout
        return set(out.split())
    except Exception:
        return None


def is_done(d):
    return any(os.path.exists(os.path.join(d, n)) for n in ("DONE", "done", ".done"))


def alert(jid, event, log, host, extra=None):
    payload = {"job": jid, "event": event, "host": host, "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
               "log_tail": tail(log)}
    payload.update(extra or {})
    print(time.strftime("%F %T"), "ALERT", event, jid, flush=True)
    post(payload)


def check(seen, host, now):
    sess = tmux_sessions()
    try:
        ids = sorted(n for n in os.listdir(JOBS) if os.path.isdir(os.path.join(JOBS, n)) and not n.startswith("."))
    except OSError:
        ids = []
    for jid in ids:
        d = os.path.join(JOBS, jid)
        log = os.path.join(d, "run.log")
        if not os.path.exists(log):
            log = log_of(d)
        try:
            st = os.stat(log); sig = [st.st_size, st.st_mtime]
        except OSError:
            sig = [0, 0]
        s = seen.get(jid)
        if not isinstance(s, dict):
            s = {"sig": sig, "moved": now, "done": False, "dead": False, "idle_at": 0}
            seen[jid] = s
        if sig != s["sig"]:
            s.update(sig=sig, moved=now, idle_at=0, dead=False)
        if is_done(d):
            if not s["done"]:
                s["done"] = True; alert(jid, "done", log, host)
            continue
        s["done"] = False
        if sess is not None and "colabjob-" + jid not in sess:
            if not s["dead"]:
                s["dead"] = True; alert(jid, "dead", log, host)
            continue
        quiet = now - s["moved"]
        if quiet >= STALL and now - s["idle_at"] >= REALERT:
            s["idle_at"] = now; alert(jid, "idle", log, host, {"idle_s": int(quiet)})


def main():
    if "--list" in sys.argv:
        for r in scan():
            print("\t".join(str(x) for x in r))
        return
    try:
        seen = json.load(open(STATE_FILE))
    except (OSError, ValueError):
        seen = {}
    host = socket.gethostname()
    print("sage-watch: watching", JOBS, "every", EVERY, "s; idle after", STALL, "s", flush=True)
    while True:
        try:
            load_env()
            check(seen, host, time.time())
            tmp = STATE_FILE + ".tmp"
            json.dump(seen, open(tmp, "w")); os.replace(tmp, STATE_FILE)
        except Exception as e:
            print("watch loop error:", type(e).__name__, flush=True)
        time.sleep(EVERY)


if __name__ == "__main__":
    main()
