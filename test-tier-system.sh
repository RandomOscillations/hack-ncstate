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

get_task_id() {
  node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).taskId))"
}

echo "========================================"
echo " TIER SYSTEM INTEGRATION TESTS"
echo "========================================"
echo ""

# Register agents
PUB_ID=$(curl -sf -X POST $BASE/api/agents/register -H "Content-Type: application/json" \
  -d '{"name":"tier-publisher","role":"publisher","pubkey":"tier-pub-pubkey-1234"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).agentId))")

SUB_ID=$(curl -sf -X POST $BASE/api/agents/register -H "Content-Type: application/json" \
  -d '{"name":"tier-subscriber","role":"subscriber","pubkey":"tier-sub-pubkey-1234"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).agentId))")

SUP_ID=$(curl -sf -X POST $BASE/api/agents/register -H "Content-Type: application/json" \
  -d '{"name":"tier-supervisor","role":"supervisor","pubkey":"tier-sup-pubkey-1234"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).agentId))")

echo "  Publisher:  $PUB_ID"
echo "  Subscriber: $SUB_ID"
echo "  Supervisor: $SUP_ID"
echo ""

# ============================================================
echo "========================================"
echo " TEST 1: Registration returns tier"
echo "========================================"
echo ""

REG_RESP=$(curl -sf -X POST $BASE/api/agents/register -H "Content-Type: application/json" \
  -d '{"name":"tier-test-agent","role":"supervisor","pubkey":"tier-test-pubkey-12345"}')
check "register returns tier" "tier" "$REG_RESP"
check "new agent is tier 2" '"tier":2' "$REG_RESP"

echo ""
echo "--- Agent detail includes tier info ---"
AGENT_DETAIL=$(curl -sf $BASE/api/agents/$SUP_ID)
check "agent detail has tier" "tier" "$AGENT_DETAIL"

# ============================================================
echo ""
echo "========================================"
echo " TEST 2: Confusion Matrix (TP)"
echo "========================================"
echo ""

echo "--- Supervisor scores 75 (passes threshold=60), verifier agrees ---"
T_TP=$(curl -sf -X POST $BASE/api/tasks -H "Content-Type: application/json" -d @- <<EOJSON
{"question":"TP test","imageUrls":[],"bountyLamports":10000000,"agentPubkey":"tier-pub-pubkey-1234","lockTxSig":"MOCK_LOCK_tp_000001","publisherAgentId":"$PUB_ID"}
EOJSON
)
T_TP_ID=$(echo "$T_TP" | get_task_id)
curl -sf -X POST $BASE/api/tasks/$T_TP_ID/claim -H "Content-Type: application/json" -d "{\"subscriberAgentId\":\"$SUB_ID\"}" > /dev/null
curl -sf -X POST $BASE/api/tasks/$T_TP_ID/fulfill -H "Content-Type: application/json" -d "{\"subscriberAgentId\":\"$SUB_ID\",\"fulfillmentText\":\"TP fulfillment\"}" > /dev/null
curl -sf -X POST $BASE/api/tasks/$T_TP_ID/score -H "Content-Type: application/json" -d "{\"supervisorAgentId\":\"$SUP_ID\",\"score\":75,\"reasoning\":\"Good work\"}" > /dev/null
V_TP=$(curl -sf -X POST $BASE/api/tasks/$T_TP_ID/verify -H "Content-Type: application/json" -d '{"verifierPubkey":"verifier-pubkey-1234","groundTruthScore":70,"agreesWithSupervisor":true,"feedback":"Agreed"}')
check "TP -> VERIFIED_PAID" "VERIFIED_PAID" "$V_TP"

TRUST_TP=$(curl -sf $BASE/api/trust/$SUP_ID)
check "supervisor trust has confusion matrix" "confusionMatrix" "$TRUST_TP"
check "TP recorded" '"tp":1' "$TRUST_TP"

# ============================================================
echo ""
echo "========================================"
echo " TEST 3: Confusion Matrix (FP)"
echo "========================================"
echo ""

echo "--- Supervisor scores 75 (passes), verifier DISAGREES ---"
T_FP=$(curl -sf -X POST $BASE/api/tasks -H "Content-Type: application/json" -d @- <<EOJSON
{"question":"FP test","imageUrls":[],"bountyLamports":10000000,"agentPubkey":"tier-pub-pubkey-1234","lockTxSig":"MOCK_LOCK_fp_000001","publisherAgentId":"$PUB_ID"}
EOJSON
)
T_FP_ID=$(echo "$T_FP" | get_task_id)
curl -sf -X POST $BASE/api/tasks/$T_FP_ID/claim -H "Content-Type: application/json" -d "{\"subscriberAgentId\":\"$SUB_ID\"}" > /dev/null
curl -sf -X POST $BASE/api/tasks/$T_FP_ID/fulfill -H "Content-Type: application/json" -d "{\"subscriberAgentId\":\"$SUB_ID\",\"fulfillmentText\":\"FP fulfillment\"}" > /dev/null
curl -sf -X POST $BASE/api/tasks/$T_FP_ID/score -H "Content-Type: application/json" -d "{\"supervisorAgentId\":\"$SUP_ID\",\"score\":75,\"reasoning\":\"Looks good\"}" > /dev/null
V_FP=$(curl -sf -X POST $BASE/api/tasks/$T_FP_ID/verify -H "Content-Type: application/json" -d '{"verifierPubkey":"verifier-pubkey-1234","groundTruthScore":20,"agreesWithSupervisor":false,"feedback":"Bad work"}')
check "FP -> DISPUTED" "DISPUTED" "$V_FP"

TRUST_FP=$(curl -sf $BASE/api/trust/$SUP_ID)
check "FP recorded in confusion matrix" '"fp":1' "$TRUST_FP"
echo "  $(echo "$TRUST_FP" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{let j=JSON.parse(d);console.log('Supervisor trust:',j.score,'tier:',j.tier)})")"

# ============================================================
echo ""
echo "========================================"
echo " TEST 4: Confusion Matrix (FN)"
echo "========================================"
echo ""

echo "--- Supervisor scores 40 (fails threshold=60), verifier DISAGREES ---"
T_FN=$(curl -sf -X POST $BASE/api/tasks -H "Content-Type: application/json" -d @- <<EOJSON
{"question":"FN test","imageUrls":[],"bountyLamports":10000000,"agentPubkey":"tier-pub-pubkey-1234","lockTxSig":"MOCK_LOCK_fn_000001","publisherAgentId":"$PUB_ID"}
EOJSON
)
T_FN_ID=$(echo "$T_FN" | get_task_id)
curl -sf -X POST $BASE/api/tasks/$T_FN_ID/claim -H "Content-Type: application/json" -d "{\"subscriberAgentId\":\"$SUB_ID\"}" > /dev/null
curl -sf -X POST $BASE/api/tasks/$T_FN_ID/fulfill -H "Content-Type: application/json" -d "{\"subscriberAgentId\":\"$SUB_ID\",\"fulfillmentText\":\"FN fulfillment\"}" > /dev/null
curl -sf -X POST $BASE/api/tasks/$T_FN_ID/score -H "Content-Type: application/json" -d "{\"supervisorAgentId\":\"$SUP_ID\",\"score\":40,\"reasoning\":\"Below threshold\"}" > /dev/null
V_FN=$(curl -sf -X POST $BASE/api/tasks/$T_FN_ID/verify -H "Content-Type: application/json" -d '{"verifierPubkey":"verifier-pubkey-1234","groundTruthScore":80,"agreesWithSupervisor":false,"feedback":"Was actually good"}')
check "FN -> DISPUTED" "DISPUTED" "$V_FN"

TRUST_FN=$(curl -sf $BASE/api/trust/$SUP_ID)
check "FN recorded" '"fn":1' "$TRUST_FN"

# ============================================================
echo ""
echo "========================================"
echo " TEST 5: Confusion Matrix (TN)"
echo "========================================"
echo ""

echo "--- Supervisor scores 40 (fails threshold), verifier AGREES ---"
T_TN=$(curl -sf -X POST $BASE/api/tasks -H "Content-Type: application/json" -d @- <<EOJSON
{"question":"TN test","imageUrls":[],"bountyLamports":10000000,"agentPubkey":"tier-pub-pubkey-1234","lockTxSig":"MOCK_LOCK_tn_000001","publisherAgentId":"$PUB_ID"}
EOJSON
)
T_TN_ID=$(echo "$T_TN" | get_task_id)
curl -sf -X POST $BASE/api/tasks/$T_TN_ID/claim -H "Content-Type: application/json" -d "{\"subscriberAgentId\":\"$SUB_ID\"}" > /dev/null
curl -sf -X POST $BASE/api/tasks/$T_TN_ID/fulfill -H "Content-Type: application/json" -d "{\"subscriberAgentId\":\"$SUB_ID\",\"fulfillmentText\":\"TN fulfillment\"}" > /dev/null
curl -sf -X POST $BASE/api/tasks/$T_TN_ID/score -H "Content-Type: application/json" -d "{\"supervisorAgentId\":\"$SUP_ID\",\"score\":40,\"reasoning\":\"Low quality\"}" > /dev/null
V_TN=$(curl -sf -X POST $BASE/api/tasks/$T_TN_ID/verify -H "Content-Type: application/json" -d '{"verifierPubkey":"verifier-pubkey-1234","groundTruthScore":30,"agreesWithSupervisor":true,"feedback":"Correct, was low quality"}')
check "TN -> VERIFIED_PAID" "VERIFIED_PAID" "$V_TN"

TRUST_TN=$(curl -sf $BASE/api/trust/$SUP_ID)
check "TN recorded" '"tn":1' "$TRUST_TN"
echo "  $(echo "$TRUST_TN" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{let j=JSON.parse(d);console.log('Final supervisor: score='+j.score+' tier='+j.tier+' cm='+JSON.stringify(j.confusionMatrix))})")"

# ============================================================
echo ""
echo "========================================"
echo " TEST 6: Tier 4 Gating"
echo "========================================"
echo ""

echo "--- Register a new supervisor, manually drive to Tier 4 via FP hits ---"
BAD_SUP_ID=$(curl -sf -X POST $BASE/api/agents/register -H "Content-Type: application/json" \
  -d '{"name":"bad-supervisor","role":"supervisor","pubkey":"bad-sup-pubkey-12345"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).agentId))")
echo "  Bad supervisor: $BAD_SUP_ID"

# Hit with 7x FP (-8 each): 50 - 56 = 0 (clamped to 0, tier 4).
# Use fresh subscriber per iteration so claim gate doesn't block us.
for i in $(seq 1 7); do
  FRESH_SUB=$(curl -sf -X POST $BASE/api/agents/register -H "Content-Type: application/json" \
    -d "{\"name\":\"fresh-sub-$i\",\"role\":\"subscriber\",\"pubkey\":\"fresh-sub-pk-$i-1234\"}" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).agentId))")
  TT=$(curl -sf -X POST $BASE/api/tasks -H "Content-Type: application/json" -d @- <<EOJSON
{"question":"Tier4 test $i","imageUrls":[],"bountyLamports":10000000,"agentPubkey":"tier-pub-pubkey-1234","lockTxSig":"MOCK_LOCK_t4_00000$i","publisherAgentId":"$PUB_ID"}
EOJSON
  )
  TT_ID=$(echo "$TT" | get_task_id)
  curl -sf -X POST $BASE/api/tasks/$TT_ID/claim -H "Content-Type: application/json" -d "{\"subscriberAgentId\":\"$FRESH_SUB\"}" > /dev/null
  curl -sf -X POST $BASE/api/tasks/$TT_ID/fulfill -H "Content-Type: application/json" -d "{\"subscriberAgentId\":\"$FRESH_SUB\",\"fulfillmentText\":\"test $i\"}" > /dev/null
  curl -sf -X POST $BASE/api/tasks/$TT_ID/score -H "Content-Type: application/json" -d "{\"supervisorAgentId\":\"$BAD_SUP_ID\",\"score\":75,\"reasoning\":\"Looks ok\"}" > /dev/null
  curl -sf -X POST $BASE/api/tasks/$TT_ID/verify -H "Content-Type: application/json" -d '{"verifierPubkey":"verifier-pubkey-1234","groundTruthScore":10,"agreesWithSupervisor":false,"feedback":"Bad"}' > /dev/null
done

BAD_TRUST=$(curl -sf $BASE/api/trust/$BAD_SUP_ID)
echo "  $(echo "$BAD_TRUST" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{let j=JSON.parse(d);console.log('Bad supervisor: score='+j.score+' tier='+j.tier)})")"
check "bad supervisor is Tier 4" '"tier":4' "$BAD_TRUST"

echo ""
echo "--- Try to score a task with Tier 4 supervisor ---"
TT_GATE=$(curl -sf -X POST $BASE/api/tasks -H "Content-Type: application/json" -d @- <<EOJSON
{"question":"Tier4 gate test","imageUrls":[],"bountyLamports":10000000,"agentPubkey":"tier-pub-pubkey-1234","lockTxSig":"MOCK_LOCK_t4_gate01","publisherAgentId":"$PUB_ID"}
EOJSON
)
TT_GATE_ID=$(echo "$TT_GATE" | get_task_id)
curl -sf -X POST $BASE/api/tasks/$TT_GATE_ID/claim -H "Content-Type: application/json" -d "{\"subscriberAgentId\":\"$SUB_ID\"}" > /dev/null
curl -sf -X POST $BASE/api/tasks/$TT_GATE_ID/fulfill -H "Content-Type: application/json" -d "{\"subscriberAgentId\":\"$SUB_ID\",\"fulfillmentText\":\"gate test\"}" > /dev/null
GATE_RESP=$(curl -s -X POST $BASE/api/tasks/$TT_GATE_ID/score -H "Content-Type: application/json" -d "{\"supervisorAgentId\":\"$BAD_SUP_ID\",\"score\":75,\"reasoning\":\"test\"}")
check "Tier 4 blocked from scoring" "supervisor_suspended" "$GATE_RESP"

# ============================================================
echo ""
echo "========================================"
echo " TEST 7: Calibration Tasks"
echo "========================================"
echo ""

echo "--- List calibration tasks (should have tasks from verified flows) ---"
CALIB_LIST=$(curl -sf "$BASE/api/calibration-tasks?supervisorAgentId=$BAD_SUP_ID")
check "calibration tasks available" "tasks" "$CALIB_LIST"
CALIB_COUNT=$(echo "$CALIB_LIST" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{let j=JSON.parse(d);console.log(j.tasks.length)})")
echo "  Calibration tasks available: $CALIB_COUNT"

if [ "$CALIB_COUNT" -gt 0 ]; then
  CALIB_ID=$(echo "$CALIB_LIST" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{let j=JSON.parse(d);console.log(j.tasks[0].id)})")
  GT_SCORE=$(echo "$CALIB_LIST" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{let j=JSON.parse(d);console.log(j.tasks[0].groundTruthScore)})")
  echo "  Calibration task: $CALIB_ID (ground truth: $GT_SCORE)"

  echo ""
  echo "--- Submit correct calibration score ---"
  CALIB_RESP=$(curl -sf -X POST $BASE/api/calibration-tasks/$CALIB_ID/score -H "Content-Type: application/json" -d "{\"supervisorAgentId\":\"$BAD_SUP_ID\",\"score\":$GT_SCORE,\"reasoning\":\"Calibration attempt\"}")
  check "calibration returns attempt" "attempt" "$CALIB_RESP"
  check "calibration matches ground truth" "matchesGroundTruth" "$CALIB_RESP"
  echo "  $(echo "$CALIB_RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{let j=JSON.parse(d);console.log('Match:',j.attempt.matchesGroundTruth,'delta:',j.attempt.trustDelta,'new tier:',j.tier.tier)})")"
fi

# ============================================================
echo ""
echo "========================================"
echo " TEST 8: Trust endpoint includes tier info"
echo "========================================"
echo ""

TRUST_INFO=$(curl -sf $BASE/api/trust/$SUP_ID)
check "trust has tierInfo" "tierInfo" "$TRUST_INFO"
check "trust has confusionMatrix" "confusionMatrix" "$TRUST_INFO"
check "trust has calibrationAttempts" "calibrationAttempts" "$TRUST_INFO"

# ============================================================
echo ""
echo "========================================"
echo " TEST 9: Subscriber trust gating"
echo "========================================"
echo ""

echo "--- Register a new subscriber with low trust (drive it down) ---"
LOW_SUB_ID=$(curl -sf -X POST $BASE/api/agents/register -H "Content-Type: application/json" \
  -d '{"name":"low-trust-sub","role":"subscriber","pubkey":"low-sub-pubkey-12345"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).agentId))")

# Use a dedicated supervisor for this test so we don't exhaust the main supervisor's trust
LOW_SUB_SUP_ID=$(curl -sf -X POST $BASE/api/agents/register -H "Content-Type: application/json" \
  -d '{"name":"lowsub-supervisor","role":"supervisor","pubkey":"lowsub-sup-pubkey-12345"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).agentId))")

# Drive subscriber trust below 10 with 6 disputes (-10 each): 50 - 60 = 0 (clamped)
# Note: claim gate is score < 10, so subscriber at 10 can still claim. Need score < 10.
for i in $(seq 1 6); do
  TT=$(curl -sf -X POST $BASE/api/tasks -H "Content-Type: application/json" -d @- <<EOJSON
{"question":"Low sub test $i","imageUrls":[],"bountyLamports":10000000,"agentPubkey":"tier-pub-pubkey-1234","lockTxSig":"MOCK_LOCK_ls_00000$i","publisherAgentId":"$PUB_ID"}
EOJSON
  )
  TT_ID=$(echo "$TT" | get_task_id)
  curl -sf -X POST $BASE/api/tasks/$TT_ID/claim -H "Content-Type: application/json" -d "{\"subscriberAgentId\":\"$LOW_SUB_ID\"}" > /dev/null
  curl -sf -X POST $BASE/api/tasks/$TT_ID/fulfill -H "Content-Type: application/json" -d "{\"subscriberAgentId\":\"$LOW_SUB_ID\",\"fulfillmentText\":\"bad work $i\"}" > /dev/null
  curl -sf -X POST $BASE/api/tasks/$TT_ID/score -H "Content-Type: application/json" -d "{\"supervisorAgentId\":\"$LOW_SUB_SUP_ID\",\"score\":75,\"reasoning\":\"ok\"}" > /dev/null
  curl -sf -X POST $BASE/api/tasks/$TT_ID/verify -H "Content-Type: application/json" -d '{"verifierPubkey":"verifier-pubkey-1234","groundTruthScore":10,"agreesWithSupervisor":false,"feedback":"Bad"}' > /dev/null
done

LOW_TRUST=$(curl -sf $BASE/api/trust/$LOW_SUB_ID)
echo "  $(echo "$LOW_TRUST" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{let j=JSON.parse(d);console.log('Low subscriber: score='+j.score)})")"

echo ""
echo "--- Try to claim with low-trust subscriber ---"
TT_CLAIM=$(curl -sf -X POST $BASE/api/tasks -H "Content-Type: application/json" -d @- <<EOJSON
{"question":"Claim gate test","imageUrls":[],"bountyLamports":10000000,"agentPubkey":"tier-pub-pubkey-1234","lockTxSig":"MOCK_LOCK_cg_000001","publisherAgentId":"$PUB_ID"}
EOJSON
)
TT_CLAIM_ID=$(echo "$TT_CLAIM" | get_task_id)
CLAIM_RESP=$(curl -s -X POST $BASE/api/tasks/$TT_CLAIM_ID/claim -H "Content-Type: application/json" -d "{\"subscriberAgentId\":\"$LOW_SUB_ID\"}")
check "low-trust subscriber blocked from claiming" "trust_too_low" "$CLAIM_RESP"

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
  echo "  ALL TIER TESTS PASSED!"
else
  echo "  SOME TESTS FAILED"
fi
echo ""
