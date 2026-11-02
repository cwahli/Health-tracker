"""Run from the notebook (needs the kernel for Colab Secrets):
    exec(open("/content/Health-tracker/tooling/colab/launch.py").read())
Copies optional Colab Secrets into env, writes the sage-watch webhook env file directly (0600),
starts bootstrap.sh detached (returns immediately) and prints one status line per step.
Never prints secret values, only counts."""
import os, subprocess, shutil
_SECRETS = ("SAGE_REPO_URL", "SAGE_GITHUB_TOKEN", "SAGE_WATCHER_WEBHOOK_URL", "SAGE_WATCHER_WEBHOOK_AUTH")
_miss = []
for _k in _SECRETS:
    if not os.environ.get(_k):
        try:
            from google.colab import userdata
            _v = userdata.get(_k)
            if _v:
                os.environ[_k] = _v
        except Exception:  # missing secret / not in Colab: ignore, never print
            pass
    if not os.environ.get(_k):
        _miss.append(_k)
print("launch.py: secrets loaded %d/%d%s" % (len(_SECRETS) - len(_miss), len(_SECRETS), (" (missing: " + ", ".join(_miss) + ")") if _miss else ""))
# Write the watcher env file here as well, so it exists even if bootstrap is slow or already running.
if os.environ.get("SAGE_WATCHER_WEBHOOK_URL"):
    import shlex
    _old = os.umask(0o077)
    try:
        with open("/content/.sage-watch.env", "w") as _f:
            _f.write("SAGE_WATCHER_WEBHOOK_URL=%s\nSAGE_WATCHER_WEBHOOK_AUTH=%s\n" % (shlex.quote(os.environ["SAGE_WATCHER_WEBHOOK_URL"]), shlex.quote(os.environ.get("SAGE_WATCHER_WEBHOOK_AUTH", ""))))
        print("launch.py: wrote /content/.sage-watch.env (sage-watch re-reads it every poll)")
    finally:
        os.umask(_old)
_here = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.path.join(os.environ.get("REPO_DIR", "/content/Health-tracker"), "tooling/colab")
subprocess.Popen(["bash", os.path.join(_here, "bootstrap.sh")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL, start_new_session=True)
print("launch.py: bootstrap launched detached (log /content/bootstrap.log, status /content/bootstrap.status)")
# Figma check: node lives in /tools/node/bin, which a non-notebook shell (ssh, tmux) may lack on PATH.
_fd = os.environ.get("FIGMA_PROXY_DIR", "/root/figma-proxy")
if os.path.isfile(os.path.join(_fd, "tooling/figma-call.js")):
    _env = dict(os.environ, PATH=os.environ.get("PATH", "") + ":/tools/node/bin")
    if shutil.which("node", path=_env["PATH"]):
        try:
            _r = subprocess.run(["node", "tooling/figma-call.js", "whoami", "{}"], cwd=_fd, env=_env, capture_output=True, text=True, timeout=90, stdin=subprocess.DEVNULL)
            print("launch.py: figma: " + ("OK" if _r.returncode == 0 and '"user_id"' in (_r.stdout or "") else "FAILED rc=%s (%s)" % (_r.returncode, ((_r.stderr or "").strip().splitlines() or ["no stderr"])[-1][:120])))
        except Exception as _e:
            print("launch.py: figma: FAILED (%s)" % type(_e).__name__)
    else:
        print("launch.py: figma: FAILED (node not found on PATH)")
