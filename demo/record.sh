#!/usr/bin/env bash
# Records the README demo against a running Gateway (use a throwaway profile).
# A fake thread log grows over three ticks: working -> waiting for CI -> done.
# Each tick the automation's trigger script asks jev_when; only "done" fires.
#   OPENCLAW="openclaw --profile scratch" ./demo/record.sh > demo/transcript.txt
set -euo pipefail
OC=${OPENCLAW:-openclaw}
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d)
LOG="$WORK/thread.log"

node "$HERE/../dist/cli.js" \
  --when "The work in this thread is finished and the assistant has delivered its final result" \
  --not-when "The assistant is only paused: waiting for a reply, an approval, a CI run, or a background job, or it is still working" \
  --exec "tail -n 2 $LOG" > "$WORK/watch.js"

ID=$($OC automations add --name demo-thread-done --every 30s --trigger-script "$WORK/watch.js" \
  --command "echo woke the model" --session isolated --no-deliver --json 2>/dev/null |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id))')
trap '$OC automations rm "$ID" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

state() { $OC automations get "$ID" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s).state;console.log(JSON.stringify({n:j.triggerEvalCount??0,st:j.triggerState??{},fire:j.lastTriggerFireAtMs??null}))})'; }
LAST_FIRE=null
tick() { # $1 = eval count to wait for, $2 = label
  local s
  for _ in $(seq 1 60); do s=$(state); [ "$(node -p "JSON.parse('$s').n")" -ge "$1" ] && break; sleep 2; done
  node -e '
    const s = JSON.parse(process.argv[1]); const fired = s.fire !== null && String(s.fire) !== process.argv[3];
    const verdict = fired ? "→ FIRE: wake the model" : s.st.matched ? "→ quiet (already fired)" : "→ quiet (no model call)";
    console.log(`${process.argv[2].padEnd(44)} p=${String(s.st.p).padEnd(6)} ${verdict}`);
  ' "$s" "$2" "$LAST_FIRE"
  LAST_FIRE=$(node -p "String(JSON.parse('$s').fire)")
}

printf '[user] bump lodash and open a PR\n[assistant] On it. Updating package.json and running the tests.\n' > "$LOG"
tick 1 'tick 1  "On it. Running the tests."'
printf '[assistant] Opened PR #41.\n[assistant] Waiting for CI before I merge. Will report back.\n' >> "$LOG"
tick 2 'tick 2  "Waiting for CI before I merge."'
printf '[assistant] CI is green. Merged #41 into main.\n[assistant] Done. 1 file changed, nothing left on my side.\n' >> "$LOG"
tick 3 'tick 3  "Merged #41. Done."'
tick 4 'tick 4  (nothing new)'
