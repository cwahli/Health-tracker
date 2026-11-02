#!/usr/bin/env bash
# jobs-dash.sh - live table of /content/jobs (WORKING/DONE/STALLED/DEAD), refresh 5s.
# Also ensures a tmux session `colabjob-<id>` tailing each job's log exists.
# State logic lives in sage-watch.py --list (single source of truth).
WATCH="$(dirname "$(readlink -f "$0")")/sage-watch.py"
while true; do
  rows=$(python3 "$WATCH" --list 2>/dev/null)
  printf '\033[H\033[2J'
  printf 'Colab jobs  %s   (tmux attach -t colabjob-<id> to tail)\n\n' "$(date '+%F %T')"
  printf '%-24s %-9s %-8s %s\n' JOB STATE IDLE LOG
  while IFS=$'\t' read -r id st age log; do
    [ -n "$id" ] || continue
    printf '%-24s %-9s %-8s %s\n' "$id" "$st" "${age}s" "${log:-"-"}"
    if [ -n "$log" ] && ! tmux has-session -t "colabjob-$id" 2>/dev/null; then
      tmux new-session -d -s "colabjob-$id" "tail -n 50 -F '$log'" 2>/dev/null
    fi
  done <<<"$rows"
  [ -n "$rows" ] || echo "(no jobs in /content/jobs)"
  sleep 5
done
