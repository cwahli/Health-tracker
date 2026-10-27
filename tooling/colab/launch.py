"""Run from the notebook (needs the kernel for Colab Secrets): exec(open(.../launch.py).read()).
Copies optional Colab Secrets into env, then starts bootstrap.sh detached (returns immediately)."""
import os, subprocess
for _k in ("SAGE_REPO_URL", "SAGE_GITHUB_TOKEN", "SAGE_WATCHER_WEBHOOK_URL", "SAGE_WATCHER_WEBHOOK_AUTH"):
    if not os.environ.get(_k):
        try:
            from google.colab import userdata
            os.environ[_k] = userdata.get(_k)
        except Exception:
            pass
_here = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.path.join(os.environ.get("REPO_DIR", "/content/Health-tracker"), "tooling/colab")
subprocess.Popen(["bash", os.path.join(_here, "bootstrap.sh")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL, start_new_session=True)
