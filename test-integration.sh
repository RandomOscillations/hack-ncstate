#!/usr/bin/env bash
set -uo pipefail

BASE="http://localhost:4000"
PASS=0
FAIL=0

check() {
  local name="$1" expected="$2" actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    echo "  PASS: $name"
    PASS=$((PASS+1))
  else
    echo "  FAIL: $name (expected '$expected')"
    echo "    got: $(echo "$actual" | head -c 300)"
    FAIL=$((FAIL+1))
  fi
}

# Extract taskId from create response: {"taskId":"...","status":"OPEN"}
get_task_id() {
  node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).taskId))"
}

echo "========================================"
echo " REGISTERING AGENTS"
echo "========================================"

PUB_ID=$(curl -sf -X POST $BASE/api/agents/register -H "Content-Type: application/json" \
  -d '{"name":"test-publisher","role":"publisher","pubkey":"publisher-pubkey-1234"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).agentId))")
echo "  Publisher:  $PUB_ID"

SUB_ID=$(curl -sf -X POST $BASE/api/agents/register -H "Content-Type: application/json" \
  -d '{"name":"test-subscriber","role":"subscriber","pubkey":"subscriber-pubkey-1234"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).agentId))")
echo "  Subscriber: $SUB_ID"

SUP_ID=$(curl -sf -X POST $BASE/api/agents/register -H "Content-Type: application/json" \
  -d '{"name":"test-supervisor","role":"supervisor","pubkey":"supervisor-pubkey-1234"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).agentId))")
echo "  Supervisor: $SUP_ID"
echo ""

# ============================================================
echo "========================================"
echo " FLOW 1: Legacy (Publisher + Human)"
echo "========================================"
echo ""

echo "--- 1a. Create Task ---"
T1_RAW=$(curl -sf -X POST $BASE/api/tasks -H "Content-Type: application/json" -d @- <<EOJSON
{
  "question": "Which landing page converts better?",
  "context": "A/B test for fintech onboarding",
  "imageUrls": ["https://example.com/a.png","https://example.com/b.png"],
  "bountyLamports": 50000000,
  "agentPubkey": "publisher-pubkey-1234",
  "lockTxSig": "MOCK_LOCK_legacy_00001",
  "publisherAgentId": "$PUB_ID"
}
EOJSON
)
T1_ID=$(echo "$T1_RAW" | get_task_id)
echo "  Task ID: $T1_ID"
check "task created with OPEN status" "OPEN" "$T1_RAW"

echo ""
echo "--- 1b. List Tasks ---"
LIST=$(curl -sf $BASE/api/tasks)
check "list contains task" "$T1_ID" "$LIST"

echo ""
echo "--- 1c. Get Task by ID ---"
GET=$(curl -sf $BASE/api/tasks/$T1_ID)
check "get returns OPEN task" "OPEN" "$GET"
check "get has correct question" "landing page" "$GET"

echo ""
echo "--- 1d. Submit Answer (Human) ---"
ANS=$(curl -sf -X POST $BASE/api/tasks/$T1_ID/answer -H "Content-Type: application/json" -d @- <<EOJSON
{
  "resolverPubkey": "resolver-pubkey-1234",
  "answerText": "Page A converts 23% better due to clearer CTA"
}
EOJSON
)
check "answer -> ANSWERED" "ANSWERED" "$ANS"

echo ""
echo "--- 1e. Confirm + Release Payment ---"
CONF=$(curl -sf -X POST $BASE/api/tasks/$T1_ID/confirm -H "Content-Type: application/json" -d '{}')
check "confirm -> CONFIRMED_PAID" "CONFIRMED_PAID" "$CONF"
check "has MOCK release tx" "MOCK_RELEASE" "$CONF"

echo ""
echo "--- 1f. Verify final state ---"
FINAL1=$(curl -sf $BASE/api/tasks/$T1_ID)
check "final state is CONFIRMED_PAID" "CONFIRMED_PAID" "$FINAL1"

# ============================================================
echo ""
echo "========================================"
echo " FLOW 2: Multi-Agent Protocol"
echo "========================================"
echo ""

echo "--- 2a. Create Task ---"
T2_RAW=$(curl -sf -X POST $BASE/api/tasks -H "Content-Type: application/json" -d @- <<EOJSON
{
  "question": "Rate the UX quality of this dashboard",
  "context": "Enterprise analytics dashboard review",
  "imageUrls": ["https://example.com/dash.png"],
  "bountyLamports": 80000000,
  "agentPubkey": "publisher-pubkey-1234",
  "lockTxSig": "MOCK_LOCK_multi_00001",
  "publisherAgentId": "$PUB_ID"
}
EOJSON
)
T2_ID=$(echo "$T2_RAW" | get_task_id)
echo "  Task ID: $T2_ID"
check "multi-agent task OPEN" "OPEN" "$T2_RAW"

echo ""
echo "--- 2b. Subscriber Claims ---"
CLAIM=$(curl -sf -X POST $BASE/api/tasks/$T2_ID/claim -H "Content-Type: application/json" \
  -d "{\"subscriberAgentId\": \"$SUB_ID\"}")
check "claim -> CLAIMED" "CLAIMED" "$CLAIM"

echo ""
echo "--- 2c. Subscriber Fulfills ---"
FULF=$(curl -sf -X POST $BASE/api/tasks/$T2_ID/fulfill -H "Content-Type: application/json" -d @- <<EOJSON
{
  "subscriberAgentId": "$SUB_ID",
  "fulfillmentText": "The dashboard scores 78/100. Strong data viz but navigation needs work."
}
EOJSON
)
check "fulfill -> FULFILLED" "FULFILLED" "$FULF"

echo ""
echo "--- 2d. Supervisor Scores ---"
SCORE=$(curl -sf -X POST $BASE/api/tasks/$T2_ID/score -H "Content-Type: application/json" -d @- <<EOJSON
{
  "supervisorAgentId": "$SUP_ID",
  "score": 75,
  "reasoning": "Comprehensive review with actionable feedback"
}
EOJSON
)
check "score -> UNDER_REVIEW" "UNDER_REVIEW" "$SCORE"

echo ""
echo "--- 2e. Verifier Approves ---"
VERIFY=$(curl -sf -X POST $BASE/api/tasks/$T2_ID/verify -H "Content-Type: application/json" -d @- <<EOJSON
{
  "verifierPubkey": "verifier-pubkey-1234",
  "groundTruthScore": 72,
  "agreesWithSupervisor": true,
  "feedback": "Score is fair, fulfillment was thorough"
}
EOJSON
)
check "verify -> VERIFIED_PAID" "VERIFIED_PAID" "$VERIFY"
check "has subscriber payment" "subscriberPaymentTxSig" "$VERIFY"
check "has verifier payment" "verifierPaymentTxSig" "$VERIFY"

echo ""
echo "--- 2f. Verify final state ---"
FINAL2=$(curl -sf $BASE/api/tasks/$T2_ID)
check "final state is VERIFIED_PAID" "VERIFIED_PAID" "$FINAL2"
check "has fulfillment data" "fulfillment" "$FINAL2"
check "has supervisor score" "supervisorScore" "$FINAL2"
check "has verifier review" "verifierReview" "$FINAL2"

# ============================================================
echo ""
echo "========================================"
echo " FLOW 3: Dispute Path"
echo "========================================"
echo ""

echo "--- 3a. Create Task ---"
T3_RAW=$(curl -sf -X POST $BASE/api/tasks -H "Content-Type: application/json" -d @- <<EOJSON
{
  "question": "Is this logo professional quality?",
  "imageUrls": ["https://example.com/logo.png"],
  "bountyLamports": 30000000,
  "agentPubkey": "publisher-pubkey-1234",
  "lockTxSig": "MOCK_LOCK_dispute_0001",
  "publisherAgentId": "$PUB_ID"
}
EOJSON
)
T3_ID=$(echo "$T3_RAW" | get_task_id)
echo "  Task ID: $T3_ID"

echo ""
echo "--- 3b. Claim + Fulfill + Score ---"
curl -sf -X POST $BASE/api/tasks/$T3_ID/claim -H "Content-Type: application/json" \
  -d "{\"subscriberAgentId\": \"$SUB_ID\"}" > /dev/null

FULF3=$(curl -sf -X POST $BASE/api/tasks/$T3_ID/fulfill -H "Content-Type: application/json" -d @- <<EOJSON
{"subscriberAgentId": "$SUB_ID", "fulfillmentText": "Yes it looks professional."}
EOJSON
)
check "dispute path: fulfill ok" "FULFILLED" "$FULF3"

SCORE3=$(curl -sf -X POST $BASE/api/tasks/$T3_ID/score -H "Content-Type: application/json" -d @- <<EOJSON
{"supervisorAgentId": "$SUP_ID", "score": 40, "reasoning": "Low effort answer"}
EOJSON
)
check "dispute path: score ok" "UNDER_REVIEW" "$SCORE3"

echo ""
echo "--- 3c. Verifier Disputes ---"
DISPUTE=$(curl -sf -X POST $BASE/api/tasks/$T3_ID/verify -H "Content-Type: application/json" -d @- <<EOJSON
{
  "verifierPubkey": "verifier-pubkey-1234",
  "groundTruthScore": 15,
  "agreesWithSupervisor": false,
  "feedback": "Fulfillment is too superficial"
}
EOJSON
)
check "dispute -> DISPUTED" "DISPUTED" "$DISPUTE"

echo ""
echo "--- 3d. Verify disputed state ---"
FINAL3=$(curl -sf $BASE/api/tasks/$T3_ID)
check "final state is DISPUTED" "DISPUTED" "$FINAL3"

# ============================================================
echo ""
echo "========================================"
echo " FLOW 4: Reject/Refund (Legacy)"
echo "========================================"
echo ""

echo "--- 4a. Create + Answer + Reject ---"
T4_RAW=$(curl -sf -X POST $BASE/api/tasks -H "Content-Type: application/json" -d @- <<EOJSON
{
  "question": "Which color scheme is better?",
  "imageUrls": ["https://example.com/colors.png"],
  "bountyLamports": 20000000,
  "agentPubkey": "publisher-pubkey-1234",
  "lockTxSig": "MOCK_LOCK_reject_00001"
}
EOJSON
)
T4_ID=$(echo "$T4_RAW" | get_task_id)
echo "  Task ID: $T4_ID"

curl -sf -X POST $BASE/api/tasks/$T4_ID/answer -H "Content-Type: application/json" -d @- > /dev/null <<EOJSON
{"resolverPubkey": "resolver-pubkey-1234", "answerText": "Blue is better"}
EOJSON

REJECT=$(curl -sf -X POST $BASE/api/tasks/$T4_ID/reject -H "Content-Type: application/json" -d '{}')
check "reject -> REJECTED_REFUNDED" "REJECTED_REFUNDED" "$REJECT"
check "has MOCK refund tx" "MOCK_REFUND" "$REJECT"

# ============================================================
echo ""
echo "========================================"
echo " AGENT & TRUST ENDPOINTS"
echo "========================================"
echo ""

echo "--- 5a. List Agents ---"
AGENTS=$(curl -sf $BASE/api/agents)
check "agents list has publisher" "test-publisher" "$AGENTS"
check "agents list has subscriber" "test-subscriber" "$AGENTS"
check "agents list has supervisor" "test-supervisor" "$AGENTS"

echo ""
echo "--- 5b. Get Agent Detail ---"
AGENT_D=$(curl -sf $BASE/api/agents/$SUB_ID)
check "agent detail has subscriber role" "subscriber" "$AGENT_D"
check "agent detail has pubkey" "subscriber-pubkey" "$AGENT_D"

echo ""
echo "--- 5c. Trust Leaderboard ---"
TRUST=$(curl -sf $BASE/api/trust)
check "trust list returns scores" "score" "$TRUST"

echo ""
echo "--- 5d. Subscriber Trust Record ---"
TRUST_SUB=$(curl -sf $BASE/api/trust/$SUB_ID)
check "subscriber has trust record" "score" "$TRUST_SUB"
echo "  $(echo "$TRUST_SUB" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{let j=JSON.parse(d);let t=j.trust||j;console.log('Trust: score='+t.score+' total='+t.totalTasks+' success='+t.successfulTasks+' fail='+t.failedTasks)})")"

echo ""
echo "--- 5e. Audit Log ---"
AUDIT=$(curl -sf $BASE/api/audit)
check "audit log has entries" "topic" "$AUDIT"

# ============================================================
echo ""
echo "========================================"
echo " EDGE CASES & VALIDATION"
echo "========================================"
echo ""

echo "--- 6a. Empty body on create task ---"
BAD1=$(curl -s -X POST $BASE/api/tasks -H "Content-Type: application/json" -d '{}')
check "rejects empty body" "error" "$BAD1"

echo ""
echo "--- 6b. Non-existent task ---"
BAD2=$(curl -s $BASE/api/tasks/does-not-exist-uuid)
check "404 on missing task" "error" "$BAD2"

echo ""
echo "--- 6c. Confirm OPEN task (invalid state transition) ---"
T5_RAW=$(curl -sf -X POST $BASE/api/tasks -H "Content-Type: application/json" -d @- <<EOJSON
{
  "question": "State transition edge case",
  "imageUrls": [],
  "bountyLamports": 10000000,
  "agentPubkey": "publisher-pubkey-1234",
  "lockTxSig": "MOCK_LOCK_edge_000001"
}
EOJSON
)
T5_ID=$(echo "$T5_RAW" | get_task_id)
BAD3=$(curl -s -X POST $BASE/api/tasks/$T5_ID/confirm -H "Content-Type: application/json" -d '{}')
check "cannot confirm OPEN task" "error" "$BAD3"

echo ""
echo "--- 6d. Double claim (task already claimed) ---"
T6_RAW=$(curl -sf -X POST $BASE/api/tasks -H "Content-Type: application/json" -d @- <<EOJSON
{
  "question": "Double claim edge case",
  "imageUrls": [],
  "bountyLamports": 10000000,
  "agentPubkey": "publisher-pubkey-1234",
  "lockTxSig": "MOCK_LOCK_edge_000002"
}
EOJSON
)
T6_ID=$(echo "$T6_RAW" | get_task_id)
curl -sf -X POST $BASE/api/tasks/$T6_ID/claim -H "Content-Type: application/json" \
  -d "{\"subscriberAgentId\": \"$SUB_ID\"}" > /dev/null
BAD4=$(curl -s -X POST $BASE/api/tasks/$T6_ID/claim -H "Content-Type: application/json" \
  -d "{\"subscriberAgentId\": \"$SUP_ID\"}")
check "cannot double-claim" "error" "$BAD4"

echo ""
echo "--- 6e. Fulfill without claim ---"
T7_RAW=$(curl -sf -X POST $BASE/api/tasks -H "Content-Type: application/json" -d @- <<EOJSON
{
  "question": "Fulfill without claim edge case",
  "imageUrls": [],
  "bountyLamports": 10000000,
  "agentPubkey": "publisher-pubkey-1234",
  "lockTxSig": "MOCK_LOCK_edge_000003"
}
EOJSON
)
T7_ID=$(echo "$T7_RAW" | get_task_id)
BAD5=$(curl -s -X POST $BASE/api/tasks/$T7_ID/fulfill -H "Content-Type: application/json" -d @- <<EOJSON
{"subscriberAgentId": "$SUB_ID", "fulfillmentText": "test fulfillment"}
EOJSON
)
check "cannot fulfill unclaimed task" "error" "$BAD5"

echo ""
echo "--- 6f. Score without fulfillment ---"
BAD6=$(curl -s -X POST $BASE/api/tasks/$T6_ID/score -H "Content-Type: application/json" -d @- <<EOJSON
{"supervisorAgentId": "$SUP_ID", "score": 50, "reasoning": "test score"}
EOJSON
)
check "cannot score CLAIMED task" "error" "$BAD6"

echo ""
echo "--- 6g. Verify without scoring ---"
BAD7=$(curl -s -X POST $BASE/api/tasks/$T7_ID/verify -H "Content-Type: application/json" -d @- <<EOJSON
{"verifierPubkey": "verifier-pubkey-1234", "groundTruthScore": 50, "agreesWithSupervisor": true, "feedback": "ok"}
EOJSON
)
check "cannot verify unscored task" "error" "$BAD7"

echo ""
echo "--- 6h. Invalid bounty amount ---"
BAD8=$(curl -s -X POST $BASE/api/tasks -H "Content-Type: application/json" -d @- <<EOJSON
{"question": "test", "imageUrls": [], "bountyLamports": -100, "agentPubkey": "publisher-pubkey-1234", "lockTxSig": "MOCK_LOCK_edge_000004"}
EOJSON
)
check "rejects negative bounty" "error" "$BAD8"

echo ""
echo "--- 6i. Filter tasks by status ---"
OPEN_LIST=$(curl -sf "$BASE/api/tasks?status=OPEN")
check "OPEN filter works" "OPEN" "$OPEN_LIST"
PAID_LIST=$(curl -sf "$BASE/api/tasks?status=CONFIRMED_PAID")
check "CONFIRMED_PAID filter works" "CONFIRMED_PAID" "$PAID_LIST"
VPAID_LIST=$(curl -sf "$BASE/api/tasks?status=VERIFIED_PAID")
check "VERIFIED_PAID filter works" "VERIFIED_PAID" "$VPAID_LIST"

echo ""
echo "--- 6j. Non-existent agent ---"
BAD9=$(curl -s $BASE/api/agents/fake-agent-id-1234)
check "404 on missing agent" "error" "$BAD9"

echo ""
echo "========================================"
echo "           RESULTS SUMMARY"
echo "========================================"
echo ""
echo "  PASSED: $PASS"
echo "  FAILED: $FAIL"
echo "  TOTAL:  $((PASS + FAIL))"
echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "  ALL TESTS PASSED!"
else
  echo "  SOME TESTS FAILED"
fi
echo ""
