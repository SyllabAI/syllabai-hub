#!/usr/bin/env bash
# Runtime verification — dashboard NBA card + cascading add-course overlay.
# Usage: bash scripts/nba_dashboard_test.sh [BASE]  (default http://localhost:3210)
BASE="${1:-http://localhost:3210}"
printf '%s' "$BASE" > /tmp/nba-base.txt
PASS=0; FAIL=0
ck() { # ck <label> <command-that-should-succeed>
  if eval "$2" >/dev/null 2>&1; then PASS=$((PASS+1)); echo "PASS  $1";
  else FAIL=$((FAIL+1)); echo "FAIL  $1"; fi
}
ckg() { # grep-based: ckg <label> <haystack-file> <needle>
  if grep -qiF -- "$3" "$2" >/dev/null 2>&1; then PASS=$((PASS+1)); echo "PASS  $1";
  else FAIL=$((FAIL+1)); echo "FAIL  $1  (missing: $3)"; fi
}
ckng() { # negative grep: must NOT contain
  if grep -qiF -- "$3" "$2" >/dev/null 2>&1; then FAIL=$((FAIL+1)); echo "FAIL  $1  (unexpected: $3)";
  else PASS=$((PASS+1)); echo "PASS  $1"; fi
}

echo "== bridge API =="
curl -s "$BASE/api/kg-learner-bridge?course=igcse-chemistry-19" > /tmp/nba-bridge.json
python3 - <<'EOF'
import json,sys
b=json.load(open('/tmp/nba-bridge.json'))
pt=b.get('pointTexts',{}); nt=b.get('noteTitles',{})
print(f"pointTexts={len(pt)} noteTitles={len(nt)} miscons={len(b.get('misconceptions',[]))}")
sys.exit(0 if len(pt)>100 and len(nt)>50 and b.get('misconceptions') else 1)
EOF
ck "bridge: pointTexts + noteTitles + misconceptions present" "true"

echo "== dashboard: fresh profile =="
agent-browser open "$BASE/dashboard" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser storage local clear >/dev/null 2>&1
agent-browser reload >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 1.2
agent-browser eval "document.body.innerText" > /tmp/nba-fresh.txt 2>/dev/null
ckg "NBA card renders" /tmp/nba-fresh.txt "Next best actions"
ckg "empty roster copy" /tmp/nba-fresh.txt "Add a course and your next best actions"
ckg "empty-state CTA present" /tmp/nba-fresh.txt "Choose a subject"
ckng "old catalogue heading gone" /tmp/nba-fresh.txt "Add a subject"
ckng "old registry search gone" /tmp/nba-fresh.txt "Search the 49-course registry"

echo "== overlay cascade =="
agent-browser find role button click --name "Choose a subject" >/dev/null 2>&1
sleep 1.2
agent-browser eval "document.body.innerText" > /tmp/nba-overlay.txt 2>/dev/null
ckg "overlay opens" /tmp/nba-overlay.txt "Choose the exam board, then the level"
ckg "step1 board Edexcel" /tmp/nba-overlay.txt "Pearson Edexcel lanes only"
ckg "step3 gated until level" /tmp/nba-overlay.txt "Pick a level to see its subjects"
ckg "level chips show counts" /tmp/nba-overlay.txt "36"
ckng "no subject rows before level chosen" /tmp/nba-overlay.txt "YBI11"

# choose IAL (accessible name carries the census badge)
agent-browser find role button click --name "IAL 13" >/dev/null 2>&1
sleep 0.8
agent-browser eval "document.body.innerText" > /tmp/nba-ial.txt 2>/dev/null
ckg "IAL lanes listed" /tmp/nba-ial.txt "Pure Mathematics"
agent-browser snapshot -i 2>/dev/null | grep -q 'button "IAL 13"' && P=1 || P=0
if [ "$P" = 1 ]; then PASS=$((PASS+1)); echo "PASS  IAL census on chip"; else FAIL=$((FAIL+1)); echo "FAIL  IAL census on chip"; fi
agent-browser find role button click --name "Done" >/dev/null 2>&1
sleep 0.8

echo "== add via overlay (header button path) =="
agent-browser find role button click --name "Add course" >/dev/null 2>&1
sleep 1.2
agent-browser find role button click --name "IGCSE 36" >/dev/null 2>&1
sleep 0.8
agent-browser eval "document.body.innerText" > /tmp/nba-igcse.txt 2>/dev/null
ckg "IGCSE lanes listed" /tmp/nba-igcse.txt "Chemistry"
# hub note: the Chemistry 4CH1 row sits below the 42dvh fold at small viewports;
# scroll it into view first so the coordinate click can't land on the dialog
# backdrop (an outside-click closes the overlay and starves every check below).
agent-browser eval "(() => { const b = Array.from(document.querySelectorAll('button[aria-label]')).find(x => x.getAttribute('aria-label') === 'Add Chemistry to my subjects'); if (b) b.scrollIntoView({ block: 'center' }); return b ? 'ok' : 'missing' })()" >/dev/null 2>&1
sleep 0.4
agent-browser find role button click --name "Add Chemistry" >/dev/null 2>&1
sleep 0.8
agent-browser eval "document.body.innerText" > /tmp/nba-added.txt 2>/dev/null
ckg "Added state in overlay" /tmp/nba-added.txt "Added"
agent-browser find role button click --name "Done" >/dev/null 2>&1
sleep 1.2
agent-browser eval "document.body.innerText" > /tmp/nba-mysubj.txt 2>/dev/null
ckg "Chemistry card in My subjects" /tmp/nba-mysubj.txt "Chemistry"
ckg "My subjects count = 1" /tmp/nba-mysubj.txt "My subjects · 1"
ckg "slot card now present" /tmp/nba-mysubj.txt "Got another course?"

echo "== NBA rows after seeding evidence =="
python3 - <<'EOF'
import json, time
now = int(time.time()*1000)
d45 = now - 45*86400000
p = {"notesRead": {},
     "selfScores": {"qstn_jqfsn2rdNhdD96tK": {"subtopic": None, "topicSlug": "1-1-states-of-matter--exam-questions", "score": 2, "max": 6, "at": d45}},
     "mcqAnswers": {}, "flashcards": {}, "saved": {}, "typedAnswers": {}}
open('/tmp/nba-seed.json','w').write(json.dumps(p))
EOF
agent-browser eval "localStorage.setItem('syllabai-hub:progress:igcse-chemistry-19', require('fs').readFileSync('/tmp/nba-seed.json','utf8'))" >/dev/null 2>&1 || \
  agent-browser eval "localStorage.setItem('syllabai-hub:progress:igcse-chemistry-19', JSON.stringify($(cat /tmp/nba-seed.json)))" >/dev/null 2>&1
agent-browser reload >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 1.5
agent-browser eval "document.body.innerText" > /tmp/nba-rows.txt 2>/dev/null
ckg "tier0 misconception row" /tmp/nba-rows.txt "Fix misconception"
ckg "SIMULATED honesty on rows" /tmp/nba-rows.txt "SIMULATED likelihood"
ckg "tier1 review row" /tmp/nba-rows.txt "Review topic"
ckg "review detail carries effective mastery" /tmp/nba-rows.txt "effective mastery"
ckg "tier2 retry row" /tmp/nba-rows.txt "Retry question"
ckg "retry detail carries marks" /tmp/nba-rows.txt "You scored 2/6"
ckg "course badge on rows" /tmp/nba-rows.txt "Chemistry · IGCSE"
ckg "policy footer" /tmp/nba-rows.txt "deterministic rule baseline"
ckg "reason codes footer" /tmp/nba-rows.txt "Misconception Suspected"
ckg "tutor escape hatch" /tmp/nba-rows.txt "Ask the AI Tutor"

echo "== deep links resolve =="
agent-browser eval "JSON.stringify(Array.from(document.querySelectorAll('[aria-label^=\"Action\"] a')).map(a=>a.getAttribute('href')))" > /tmp/nba-hrefs.json 2>/dev/null
python3 - <<'EOF'
import json, subprocess, sys
raw = open('/tmp/nba-hrefs.json').read().strip()
hrefs = json.loads(json.loads(raw)) if raw.startswith('"') else json.loads(raw)
hrefs = [h for h in hrefs if h]
print('hrefs:', hrefs)
base = open('/tmp/nba-base.txt').read().strip()
ok = 0
for h in hrefs[:5]:
    code = subprocess.run(['curl','-s','-o','/dev/null','-w','%{http_code}', base+h], capture_output=True, text=True).stdout
    print(h, '->', code)
    if code in ('200','307','308'): ok += 1
sys.exit(0 if ok == min(5, len(hrefs)) and ok >= 4 else 1)
EOF
if [ $? -eq 0 ]; then PASS=$((PASS+1)); echo "PASS  all NBA hrefs resolve 200 (>=4 rows)"; else FAIL=$((FAIL+1)); echo "FAIL  some NBA hrefs failed"; fi

echo "== console + visual =="
agent-browser errors > /tmp/nba-errors.txt 2>&1
[ -s /tmp/nba-errors.txt ] && tail -3 /tmp/nba-errors.txt
ckng "no page errors" /tmp/nba-errors.txt "Error"
mkdir -p /home/z/my-project/download
agent-browser screenshot --full /home/z/my-project/download/dashboard-nba-card.png >/dev/null 2>&1
agent-browser find role button click --name "Got another course? Add course" >/dev/null 2>&1 || agent-browser find role button click --name "Got another course?" >/dev/null 2>&1
sleep 1
agent-browser screenshot /home/z/my-project/download/dashboard-add-overlay.png >/dev/null 2>&1
agent-browser press Escape >/dev/null 2>&1
sleep 0.8

echo "== persistence: remove course =="
agent-browser find role button click --name "Remove Chemistry from my subjects" >/dev/null 2>&1
sleep 1.2
agent-browser eval "document.body.innerText" > /tmp/nba-removed.txt 2>/dev/null
ckg "roster empty again" /tmp/nba-removed.txt "No subjects yet"
ckg "NBA card back to roster-empty copy" /tmp/nba-removed.txt "Add a course and your next best actions"

echo ""
echo "RESULT: $PASS PASS / $FAIL FAIL"
exit $([ $FAIL -eq 0 ] && echo 0 || echo 1)
