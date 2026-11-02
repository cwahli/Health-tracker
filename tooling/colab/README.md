# tooling/colab

`bootstrap.sh` rebuilds the Colab agent environment after a runtime reset (idempotent; re-run is a fast no-op).
Log `/content/bootstrap.log`, status `/content/bootstrap.status` (one `component STATE detail` line each; model pull updates its line when done).

Notebook (agent_launcher cell, **before** the blocking `%run .../colab_worker.py`):

    import os,subprocess;subprocess.Popen(["bash",os.path.join(os.environ.get("REPO_DIR","/content/Health-tracker"),"tooling/colab/bootstrap.sh")],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)

Or `exec(open("/content/Health-tracker/tooling/colab/launch.py").read())` to also pass Colab Secrets
(`SAGE_REPO_URL` or `SAGE_GITHUB_TOKEN`, `SAGE_WATCHER_WEBHOOK_URL`, `SAGE_WATCHER_WEBHOOK_AUTH`) to it.

Not automatable: Figma MCP OAuth (`mcp-auth.json`, gitignored) must be re-authorised after a reset; GPU steps are skipped on CPU runtimes.
