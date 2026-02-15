#!/usr/bin/env bash
# seed-tasks.sh — Seed 13 realistic demo tasks with varied statuses.
# Usage: bash scripts/seed-tasks.sh [BASE_URL]
set -uo pipefail

BASE="${1:-http://localhost:4000}"
CREATED=0

# Extract fields from JSON response
json_field() {
  node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).$1))"
}

echo "========================================"
echo " Seeding Demo Tasks  →  $BASE"
echo "========================================"
echo ""

# ── Register agents ────────────────────────────────────────
PUB_ID=$(curl -sf -X POST "$BASE/api/agents/register" \
  -H "Content-Type: application/json" \
  -d '{"name":"seed-publisher","role":"publisher","pubkey":"seed-publisher-pubkey-1234567890"}' \
  | json_field agentId)

SUB_ID=$(curl -sf -X POST "$BASE/api/agents/register" \
  -H "Content-Type: application/json" \
  -d '{"name":"seed-subscriber","role":"subscriber","pubkey":"seed-subscriber-pubkey-123456789"}' \
  | json_field agentId)

SUP_ID=$(curl -sf -X POST "$BASE/api/agents/register" \
  -H "Content-Type: application/json" \
  -d '{"name":"seed-supervisor","role":"supervisor","pubkey":"seed-supervisor-pubkey-123456789"}' \
  | json_field agentId)

if [ -z "$PUB_ID" ]; then
  echo "ERROR: Could not register agents. Is the server running at $BASE?"
  exit 1
fi
echo "  Publisher:  $PUB_ID"
echo "  Subscriber: $SUB_ID"
echo "  Supervisor: $SUP_ID"
echo ""

# Array to store task IDs
declare -a TASK_IDS

# Helper to create a task and store its ID
create_task() {
  local label="$1"
  local json="$2"
  local raw tid
  raw=$(curl -sf -X POST "$BASE/api/tasks" \
    -H "Content-Type: application/json" \
    -d "$json")
  tid=$(echo "$raw" | json_field taskId)
  if [ -n "$tid" ] && [ "$tid" != "undefined" ]; then
    TASK_IDS+=("$tid")
    CREATED=$((CREATED+1))
    echo "  [$CREATED] $label"
    echo "      id: $tid"
  else
    TASK_IDS+=("")
    echo "  FAIL: $label"
  fi
}

echo "--- Creating tasks ---"
echo ""

# ── Task 1: Landing page UX comparison ─────────────────────
create_task "Landing page UX comparison" "$(cat <<EOJSON
{
  "question": "Which landing page has better UX and why?",
  "context": "Compare these two fintech onboarding landing pages. Page A is trust-focused with a clean layout emphasizing security badges and testimonials. Page B is engagement-focused with progressive disclosure, animated transitions, and an interactive demo widget.",
  "imageUrls": ["/assets/landing_a.svg", "/assets/landing_b.svg"],
  "bountyLamports": 50000000,
  "agentPubkey": "seed-publisher-pubkey-1234567890",
  "lockTxSig": "MOCK_LOCK_seed_000001",
  "expiresInSec": 600,
  "publisherAgentId": "$PUB_ID"
}
EOJSON
)"

# ── Task 2: Checkout flow trust signals ─────────────────────
create_task "Checkout flow trust signals" "$(cat <<EOJSON
{
  "question": "Does the checkout flow communicate trust effectively to first-time buyers?",
  "context": "This is a 3-step checkout for a direct-to-consumer supplement brand. The agent detected that the cart-abandonment rate is 68% at step 2 (payment info). Evaluate whether the trust signals (SSL badge, money-back guarantee, review count) are prominent enough and whether the form layout reduces perceived friction.",
  "imageUrls": ["/assets/checkout_trust.svg"],
  "bountyLamports": 45000000,
  "agentPubkey": "seed-publisher-pubkey-1234567890",
  "lockTxSig": "MOCK_LOCK_seed_000002",
  "expiresInSec": 600,
  "publisherAgentId": "$PUB_ID"
}
EOJSON
)"

# ── Task 3: Dashboard data hierarchy ────────────────────────
create_task "Dashboard data hierarchy" "$(cat <<EOJSON
{
  "question": "Rate the visual hierarchy of this analytics dashboard — does the most important metric stand out?",
  "context": "Enterprise SaaS dashboard showing MRR, churn rate, active users, and NPS. The PM wants MRR to be the hero metric but the current layout gives equal visual weight to all four KPIs. The agent needs a human to judge whether the information architecture matches business priorities and whether the color coding helps or hinders quick scanning.",
  "imageUrls": ["/assets/dashboard_kpi.svg"],
  "bountyLamports": 80000000,
  "agentPubkey": "seed-publisher-pubkey-1234567890",
  "lockTxSig": "MOCK_LOCK_seed_000003",
  "expiresInSec": 600,
  "publisherAgentId": "$PUB_ID"
}
EOJSON
)"

# ── Task 4: Pricing page conversion clarity ─────────────────
create_task "Pricing page conversion clarity" "$(cat <<EOJSON
{
  "question": "Which pricing tier will most visitors choose, and is the upgrade path from Free to Pro clear?",
  "context": "B2B project-management tool with three tiers: Free, Pro (\$12/mo), and Enterprise (custom). The agent analyzed the feature comparison table but cannot determine whether the value gap between Free and Pro justifies the price jump from a human perception standpoint. The Pro tier includes 'unlimited projects' and 'priority support' — evaluate whether these differentiators are compelling enough to convert free users.",
  "imageUrls": ["/assets/pricing_page.svg"],
  "bountyLamports": 60000000,
  "agentPubkey": "seed-publisher-pubkey-1234567890",
  "lockTxSig": "MOCK_LOCK_seed_000004",
  "expiresInSec": 600,
  "publisherAgentId": "$PUB_ID"
}
EOJSON
)"

# ── Task 5: Onboarding flow completion ──────────────────────
create_task "Onboarding flow completion" "$(cat <<EOJSON
{
  "question": "Will a non-technical user be able to complete this onboarding without dropping off?",
  "context": "A no-code automation platform has a 5-step onboarding wizard: (1) name your workspace, (2) connect an integration (OAuth popup), (3) choose a template, (4) customize the template, (5) run your first automation. Analytics show 40% drop-off at step 2 (OAuth). The agent suspects the OAuth popup is confusing but needs human judgment on whether the instructions and visual cues are sufficient for someone unfamiliar with API integrations.",
  "imageUrls": ["/assets/onboarding_oauth.svg"],
  "bountyLamports": 55000000,
  "agentPubkey": "seed-publisher-pubkey-1234567890",
  "lockTxSig": "MOCK_LOCK_seed_000005",
  "expiresInSec": 600,
  "publisherAgentId": "$PUB_ID"
}
EOJSON
)"

# ── Task 6: Dark mode contrast review ───────────────────────
create_task "Dark mode contrast review" "$(cat <<EOJSON
{
  "question": "Does this dark mode implementation have sufficient contrast, or are any elements hard to read?",
  "context": "A developer tools platform shipped dark mode. The agent ran automated WCAG contrast checks and most elements pass AA, but three components flagged as borderline: (1) secondary button outlines against the dark surface, (2) disabled input placeholder text, (3) code syntax highlighting for comments. Automated checks cannot account for real-world perception on different monitors — a human should verify readability.",
  "imageUrls": ["/assets/dark_mode.svg"],
  "bountyLamports": 30000000,
  "agentPubkey": "seed-publisher-pubkey-1234567890",
  "lockTxSig": "MOCK_LOCK_seed_000006",
  "expiresInSec": 600,
  "publisherAgentId": "$PUB_ID"
}
EOJSON
)"

# ── Task 7: Social proof placement ──────────────────────────
create_task "Social proof placement" "$(cat <<EOJSON
{
  "question": "Is the social proof on this SaaS homepage convincing, or does it feel manufactured?",
  "context": "A cybersecurity startup's homepage shows: a rotating carousel of 6 client logos (3 well-known, 3 obscure), a single blockquote testimonial from a CTO, and a '10,000+ teams trust us' counter. The agent cannot judge whether the overall impression feels credible or whether the mix of strong and weak logos undermines trust. Also evaluate whether the testimonial placement (below the fold, after features) is optimal or should be moved higher.",
  "imageUrls": ["/assets/social_proof.svg"],
  "bountyLamports": 70000000,
  "agentPubkey": "seed-publisher-pubkey-1234567890",
  "lockTxSig": "MOCK_LOCK_seed_000007",
  "expiresInSec": 600,
  "publisherAgentId": "$PUB_ID"
}
EOJSON
)"

# ── Task 8: Empty state design helpfulness ──────────────────
create_task "Empty state design helpfulness" "$(cat <<EOJSON
{
  "question": "Do these empty states guide the user toward their first action, or do they feel like dead ends?",
  "context": "A team collaboration app has three empty states: (1) Dashboard with no projects — shows an illustration and 'Create your first project' button, (2) Inbox with no messages — shows 'All caught up!' with a checkmark, (3) Reports page with no data — shows 'No reports yet' with no call to action. The agent identified that state 3 lacks a clear next step but needs human judgment on whether the illustrations are helpful or patronizing, and whether the overall tone matches a professional B2B context.",
  "imageUrls": ["/assets/empty_states.svg"],
  "bountyLamports": 42000000,
  "agentPubkey": "seed-publisher-pubkey-1234567890",
  "lockTxSig": "MOCK_LOCK_seed_000008",
  "expiresInSec": 600,
  "publisherAgentId": "$PUB_ID"
}
EOJSON
)"

# ── Task 9: Content moderation (age-gating) ─────────────────
create_task "Content moderation — age-gating" "$(cat <<EOJSON
{
  "question": "Should the recommendation algorithm surface this content to users under 18?",
  "context": "A video platform's recommendation engine flagged a content item for manual review. The video contains edgy humor with mild violence references and substance mentions, but also has educational value. The AI confidence score is 68% (below the auto-approve threshold). Similar content has been split roughly 60/40 between approved and blocked. The agent cannot make moral judgments about age-appropriateness — a human must decide whether the educational value outweighs the mature themes for a teenage audience.",
  "imageUrls": ["/assets/content_moderation.svg"],
  "bountyLamports": 65000000,
  "agentPubkey": "seed-publisher-pubkey-1234567890",
  "lockTxSig": "MOCK_LOCK_seed_000009",
  "expiresInSec": 600,
  "publisherAgentId": "$PUB_ID"
}
EOJSON
)"

# ── Task 10: Email subject line tone ────────────────────────
create_task "Email subject line — compelling or spammy?" "$(cat <<EOJSON
{
  "question": "Does this email subject line feel compelling or spammy?",
  "context": "A fintech app is running a re-engagement campaign targeting users who signed up but never completed onboarding (7+ days inactive). The AI generated three subject line variants: (A) an urgency-driven line with emoji and caps, (B) a progress-nudge referencing their 80% completion, and (C) a conversational question about goals. The agent predicted open rates but cannot judge whether variant A crosses the line into spam territory for a regulated financial brand, or whether variant C is too passive to drive action.",
  "imageUrls": ["/assets/email_subject.svg"],
  "bountyLamports": 38000000,
  "agentPubkey": "seed-publisher-pubkey-1234567890",
  "lockTxSig": "MOCK_LOCK_seed_000010",
  "expiresInSec": 600,
  "publisherAgentId": "$PUB_ID"
}
EOJSON
)"

# ── Task 11: Patient health summary accuracy ────────────────
create_task "Health summary — medically accurate?" "$(cat <<EOJSON
{
  "question": "Is this patient-facing health summary medically accurate?",
  "context": "A health portal uses AI to convert physician visit notes into plain-language summaries for patients. This summary covers a Type 2 Diabetes follow-up: diagnosis, two medications (Metformin 500mg, Lisinopril 10mg), dietary instructions, and a follow-up date. The AI flagged potential issues: a possible drug interaction not mentioned, an omitted A1C target, and vague exercise guidance. The agent cannot verify clinical accuracy — a human with medical knowledge should assess whether this summary is safe to show a patient.",
  "imageUrls": ["/assets/health_summary.svg"],
  "bountyLamports": 90000000,
  "agentPubkey": "seed-publisher-pubkey-1234567890",
  "lockTxSig": "MOCK_LOCK_seed_000011",
  "expiresInSec": 600,
  "publisherAgentId": "$PUB_ID"
}
EOJSON
)"

# ── Task 12: Customer complaint triage ──────────────────────
create_task "Complaint triage — rank by severity" "$(cat <<EOJSON
{
  "question": "Rank these 4 customer complaints by severity — which needs immediate response?",
  "context": "A support queue has 4 open tickets: (1) Billing — enterprise customer charged \$499 instead of \$49, angry, high churn risk; (2) Feature request — healthcare org needs CSV columns for SOC2 audit in 2 weeks; (3) Bug — free-tier user reports dark mode resets on refresh, mild annoyance; (4) Outage — enterprise customer (\$48k ARR, 200 seats) reports API 503 errors, production pipeline down. The agent extracted sentiment and churn risk but cannot weigh business impact, customer lifetime value, and urgency the way a human support lead can.",
  "imageUrls": ["/assets/complaint_triage.svg"],
  "bountyLamports": 55000000,
  "agentPubkey": "seed-publisher-pubkey-1234567890",
  "lockTxSig": "MOCK_LOCK_seed_000012",
  "expiresInSec": 600,
  "publisherAgentId": "$PUB_ID"
}
EOJSON
)"

# ── Task 13: Resume screening ───────────────────────────────
create_task "Resume screening — best candidate fit" "$(cat <<EOJSON
{
  "question": "Which of these 3 candidate resumes is the best fit for this role?",
  "context": "Hiring for a mid-level Frontend Engineer at a Series B startup (React/TypeScript/Node, \$120–160k budget, 4-person team). Candidate A: 8 years FAANG experience, 90% skills match, but overqualified, job-hopper pattern (3 in 3 years), and asking \$185k (above budget). Candidate B: 4 years startup background, 71% match, shipped 0→1 product, within budget at \$140k, but lacks React depth. Candidate C: 2 years bootcamp-to-agency path, 61% match, strong design sense and impressive portfolio, asking \$110k, but junior-level. The agent scored technical fit but cannot assess culture fit, growth potential, or whether the budget stretch for Candidate A is worth it.",
  "imageUrls": ["/assets/resume_screen.svg"],
  "bountyLamports": 75000000,
  "agentPubkey": "seed-publisher-pubkey-1234567890",
  "lockTxSig": "MOCK_LOCK_seed_000013",
  "expiresInSec": 600,
  "publisherAgentId": "$PUB_ID"
}
EOJSON
)"

echo ""
echo "  Created $CREATED / 13 tasks"
echo ""

# ================================================================
echo "--- Advancing task statuses ---"
echo ""

# Task 2 (Checkout): OPEN → CLAIMED → FULFILLED → SCORED → UNDER_REVIEW → VERIFIED_PAID
T=${TASK_IDS[1]}
curl -sf -X POST "$BASE/api/tasks/$T/claim" -H "Content-Type: application/json" \
  -d "{\"subscriberAgentId\": \"$SUB_ID\"}" > /dev/null
curl -sf -X POST "$BASE/api/tasks/$T/fulfill" -H "Content-Type: application/json" \
  -d "{\"subscriberAgentId\": \"$SUB_ID\", \"fulfillmentText\": \"The trust signals are present but undersized. The SSL badge is only 16px and the money-back guarantee is below the fold. Moving the guarantee above the payment form and enlarging the review count to a star-rating bar would reduce friction. The form itself is clean but lacks inline validation which adds uncertainty.\"}" > /dev/null
curl -sf -X POST "$BASE/api/tasks/$T/score" -H "Content-Type: application/json" \
  -d "{\"supervisorAgentId\": \"$SUP_ID\", \"score\": 82, \"reasoning\": \"Thorough analysis with specific, actionable recommendations. Correctly identified the key friction points.\"}" > /dev/null
curl -sf -X POST "$BASE/api/tasks/$T/verify" -H "Content-Type: application/json" \
  -d "{\"verifierPubkey\": \"verifier-pubkey-1234567890\", \"groundTruthScore\": 80, \"agreesWithSupervisor\": true, \"feedback\": \"Accurate assessment. The trust signal sizing issue is a real conversion blocker.\"}" > /dev/null
echo "  Task 2 (Checkout)        → VERIFIED_PAID"

# Task 3 (Dashboard): OPEN → CLAIMED → FULFILLED → SCORED → UNDER_REVIEW → VERIFIED_PAID
T=${TASK_IDS[2]}
curl -sf -X POST "$BASE/api/tasks/$T/claim" -H "Content-Type: application/json" \
  -d "{\"subscriberAgentId\": \"$SUB_ID\"}" > /dev/null
curl -sf -X POST "$BASE/api/tasks/$T/fulfill" -H "Content-Type: application/json" \
  -d "{\"subscriberAgentId\": \"$SUB_ID\", \"fulfillmentText\": \"MRR does not stand out — all four KPI cards are identical in size, color weight, and typography. To fix: make MRR 2x wider, use the primary brand color only for MRR, and set the other three cards to a muted variant. The bar chart below reinforces revenue trend well but the sidebar filters add noise. Consider removing filters from the default view.\"}" > /dev/null
curl -sf -X POST "$BASE/api/tasks/$T/score" -H "Content-Type: application/json" \
  -d "{\"supervisorAgentId\": \"$SUP_ID\", \"score\": 88, \"reasoning\": \"Excellent hierarchy analysis with concrete layout suggestions. The 2x width recommendation for MRR is particularly practical.\"}" > /dev/null
curl -sf -X POST "$BASE/api/tasks/$T/verify" -H "Content-Type: application/json" \
  -d "{\"verifierPubkey\": \"verifier-pubkey-1234567890\", \"groundTruthScore\": 85, \"agreesWithSupervisor\": true, \"feedback\": \"Strong analysis. Agreed that equal sizing is the core problem.\"}" > /dev/null
echo "  Task 3 (Dashboard)       → VERIFIED_PAID"

# Task 4 (Pricing): OPEN → CLAIMED → FULFILLED
T=${TASK_IDS[3]}
curl -sf -X POST "$BASE/api/tasks/$T/claim" -H "Content-Type: application/json" \
  -d "{\"subscriberAgentId\": \"$SUB_ID\"}" > /dev/null
curl -sf -X POST "$BASE/api/tasks/$T/fulfill" -H "Content-Type: application/json" \
  -d "{\"subscriberAgentId\": \"$SUB_ID\", \"fulfillmentText\": \"Most visitors will choose Free and stay there. The jump from Free (3 projects) to Pro (unlimited) is too abstract — users don't know if they'll need more than 3 projects until they hit the wall. Recommendation: change Free to '1 active project' so the constraint is felt immediately, and add a '14-day Pro trial' CTA instead of a hard upgrade.\"}" > /dev/null
echo "  Task 4 (Pricing)         → FULFILLED"

# Task 5 (Onboarding): OPEN → CLAIMED → FULFILLED → SCORED → UNDER_REVIEW
T=${TASK_IDS[4]}
curl -sf -X POST "$BASE/api/tasks/$T/claim" -H "Content-Type: application/json" \
  -d "{\"subscriberAgentId\": \"$SUB_ID\"}" > /dev/null
curl -sf -X POST "$BASE/api/tasks/$T/fulfill" -H "Content-Type: application/json" \
  -d "{\"subscriberAgentId\": \"$SUB_ID\", \"fulfillmentText\": \"Non-technical users will likely drop off at step 2. The OAuth popup is jarring — it opens a new window with unfamiliar branding and permission scopes. The main page gives no preview of what will happen. Fix: add a 3-frame visual preview showing 'You'll see a popup → Click Allow → Done' before the Connect button. Also add a 'Skip for now' option since the integration isn't strictly needed to explore templates.\"}" > /dev/null
curl -sf -X POST "$BASE/api/tasks/$T/score" -H "Content-Type: application/json" \
  -d "{\"supervisorAgentId\": \"$SUP_ID\", \"score\": 76, \"reasoning\": \"Good identification of the core UX issue with the OAuth popup. The visual preview suggestion is practical. The skip option is a smart fallback.\"}" > /dev/null
echo "  Task 5 (Onboarding)      → UNDER_REVIEW"

# Task 7 (Social proof): OPEN → CLAIMED
T=${TASK_IDS[6]}
curl -sf -X POST "$BASE/api/tasks/$T/claim" -H "Content-Type: application/json" \
  -d "{\"subscriberAgentId\": \"$SUB_ID\"}" > /dev/null
echo "  Task 7 (Social proof)    → CLAIMED"

# Task 9 (Content mod): OPEN → CLAIMED → FULFILLED → SCORED → UNDER_REVIEW → DISPUTED
T=${TASK_IDS[8]}
curl -sf -X POST "$BASE/api/tasks/$T/claim" -H "Content-Type: application/json" \
  -d "{\"subscriberAgentId\": \"$SUB_ID\"}" > /dev/null
curl -sf -X POST "$BASE/api/tasks/$T/fulfill" -H "Content-Type: application/json" \
  -d "{\"subscriberAgentId\": \"$SUB_ID\", \"fulfillmentText\": \"Yes, surface it. The educational value outweighs the mild mature themes. Teens aged 13-17 are regularly exposed to similar content in school curricula. The violence references are contextual (historical documentary style) not gratuitous. Add an age-gate interstitial with content warnings rather than blocking entirely.\"}" > /dev/null
curl -sf -X POST "$BASE/api/tasks/$T/score" -H "Content-Type: application/json" \
  -d "{\"supervisorAgentId\": \"$SUP_ID\", \"score\": 45, \"reasoning\": \"The analysis is too permissive. It dismisses the substance references without adequate consideration of platform liability.\"}" > /dev/null
curl -sf -X POST "$BASE/api/tasks/$T/verify" -H "Content-Type: application/json" \
  -d "{\"verifierPubkey\": \"verifier-pubkey-1234567890\", \"groundTruthScore\": 30, \"agreesWithSupervisor\": false, \"feedback\": \"Fulfillment oversimplifies the risk. The substance references alone warrant blocking for under-16, not just a warning interstitial. Needs re-evaluation with stricter criteria.\"}" > /dev/null
echo "  Task 9 (Content mod)     → DISPUTED"

# Task 10 (Email): OPEN → CLAIMED → FULFILLED
T=${TASK_IDS[9]}
curl -sf -X POST "$BASE/api/tasks/$T/claim" -H "Content-Type: application/json" \
  -d "{\"subscriberAgentId\": \"$SUB_ID\"}" > /dev/null
curl -sf -X POST "$BASE/api/tasks/$T/fulfill" -H "Content-Type: application/json" \
  -d "{\"subscriberAgentId\": \"$SUB_ID\", \"fulfillmentText\": \"Variant A is spammy — the all-caps, emoji, and fear tactics violate fintech brand trust. Variant C is too passive for re-engagement. Variant B is the winner: the '80% complete' framing leverages the Zeigarnik effect (desire to finish incomplete tasks) without being manipulative. Recommend B with a minor tweak: add the user's first name for personalization.\"}" > /dev/null
echo "  Task 10 (Email)          → FULFILLED"

# Task 12 (Complaints): OPEN → CLAIMED
T=${TASK_IDS[11]}
curl -sf -X POST "$BASE/api/tasks/$T/claim" -H "Content-Type: application/json" \
  -d "{\"subscriberAgentId\": \"$SUB_ID\"}" > /dev/null
echo "  Task 12 (Complaints)     → CLAIMED"

# Task 13 (Resume): OPEN → CLAIMED → FULFILLED → SCORED → UNDER_REVIEW → VERIFIED_PAID
T=${TASK_IDS[12]}
curl -sf -X POST "$BASE/api/tasks/$T/claim" -H "Content-Type: application/json" \
  -d "{\"subscriberAgentId\": \"$SUB_ID\"}" > /dev/null
curl -sf -X POST "$BASE/api/tasks/$T/fulfill" -H "Content-Type: application/json" \
  -d "{\"subscriberAgentId\": \"$SUB_ID\", \"fulfillmentText\": \"Candidate B is the best fit. Sarah (A) is overqualified and a flight risk — 3 jobs in 3 years plus above-budget salary signals she'll leave within a year. Priya (C) has great potential but is too junior for a 4-person team that needs someone productive on day one. Marcus (B) has the startup DNA to thrive in a Series B environment, ships fast, and is within budget. His React gap can be closed in 2-3 months with the existing team's mentorship.\"}" > /dev/null
curl -sf -X POST "$BASE/api/tasks/$T/score" -H "Content-Type: application/json" \
  -d "{\"supervisorAgentId\": \"$SUP_ID\", \"score\": 91, \"reasoning\": \"Excellent reasoning that weighs retention risk, team dynamics, and growth trajectory — not just technical match. The recommendation is well-justified.\"}" > /dev/null
curl -sf -X POST "$BASE/api/tasks/$T/verify" -H "Content-Type: application/json" \
  -d "{\"verifierPubkey\": \"verifier-pubkey-1234567890\", \"groundTruthScore\": 88, \"agreesWithSupervisor\": true, \"feedback\": \"Strong analysis. Agreed on Candidate B. The flight risk assessment of Candidate A is spot on.\"}" > /dev/null
echo "  Task 13 (Resume)         → VERIFIED_PAID"

echo ""
echo "========================================"
echo "  Status summary:"
echo "    OPEN:          4  (tasks 1, 6, 8, 11)"
echo "    CLAIMED:       2  (tasks 7, 12)"
echo "    FULFILLED:     2  (tasks 4, 10)"
echo "    UNDER_REVIEW:  1  (task 5)"
echo "    VERIFIED_PAID: 3  (tasks 2, 3, 13)"
echo "    DISPUTED:      1  (task 9)"
echo "========================================"
echo ""
