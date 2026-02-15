import type { Task, Fulfillment, SupervisorScore, VerifierReview, LedgerEntry, LedgerEntryType, TaskStatus } from "@unblock/common";
import crypto from "node:crypto";
import { TaskStore } from "./store";
import { LedgerStore } from "./ledger-store";
import { AgentRegistry } from "../agents/registry";
import { TrustStore } from "../agents/trust";

/**
 * Seeds 13 demo tasks with varied statuses, fulfillments, scores, and reviews.
 * Called once on server startup so the UI is populated immediately.
 */
export function seedDemoData(
  store: TaskStore,
  agentRegistry: AgentRegistry,
  trustStore: TrustStore,
  ledgerStore: LedgerStore,
) {
  const now = Date.now();
  const ESCROW_KEY = "escrow-pubkey-1234567890abcdef";
  const PUB = "seed-publisher";
  const SUB = "seed-subscriber";
  const SUP = "seed-supervisor";
  const PUB_KEY = "seed-publisher-pubkey-1234567890";
  const SUB_KEY = "seed-subscriber-pubkey-123456789";
  const SUP_KEY = "seed-supervisor-pubkey-123456789";
  const VER_KEY = "verifier-pubkey-1234567890";

  // Register agents
  const pubId = agentRegistry.register({ name: PUB, role: "publisher", pubkey: PUB_KEY }).agentId;
  const subId = agentRegistry.register({ name: SUB, role: "subscriber", pubkey: SUB_KEY }).agentId;
  const supId = agentRegistry.register({ name: SUP, role: "supervisor", pubkey: SUP_KEY }).agentId;
  trustStore.getOrCreate(pubId);
  trustStore.getOrCreate(subId);
  trustStore.getOrCreate(supId);

  // Helper to make a fulfillment
  const mkFulfillment = (taskId: string, text: string): Fulfillment => ({
    id: crypto.randomUUID(),
    taskId,
    subscriberAgentId: subId,
    fulfillmentText: text,
    submittedAtMs: now - 120_000,
  });

  // Helper to make a supervisor score
  const mkScore = (taskId: string, fulfillmentId: string, score: number, reasoning: string): SupervisorScore => ({
    id: crypto.randomUUID(),
    taskId,
    fulfillmentId,
    supervisorAgentId: supId,
    score,
    reasoning,
    passesThreshold: score >= 60,
    scoredAtMs: now - 60_000,
  });

  // Helper to make a verifier review
  const mkReview = (taskId: string, fulfillmentId: string, scoreId: string, groundTruthScore: number, agrees: boolean, feedback: string): VerifierReview => ({
    id: crypto.randomUUID(),
    taskId,
    fulfillmentId,
    scoreId,
    verifierPubkey: VER_KEY,
    groundTruthScore,
    agreesWithSupervisor: agrees,
    feedback,
    reviewedAtMs: now - 30_000,
  });

  // Helper to create a ledger entry
  const mkLedger = (type: LedgerEntryType, taskId: string, txSig: string, amountLamports: number, status: TaskStatus, description: string, fromPubkey?: string, toPubkey?: string, offsetMs = 0): LedgerEntry => ({
    id: crypto.randomUUID(),
    timestampMs: now - 300_000 + offsetMs,
    type,
    taskId,
    txSig,
    amountLamports,
    fromPubkey,
    toPubkey,
    status,
    description,
  });

  // Base task template
  const base = (overrides: Partial<Task> & { id: string; question: string; bountyLamports: number; lockTxSig: string }): Task => ({
    createdAtMs: now - 300_000,
    updatedAtMs: now - 300_000,
    imageUrls: [],
    agentPubkey: PUB_KEY,
    status: "OPEN",
    expiresAtMs: now + 600_000,
    publisherAgentId: pubId,
    ...overrides,
  });

  // ── Task 1: Landing page UX comparison — OPEN ────────────
  const t1 = base({
    id: crypto.randomUUID(),
    question: "Which landing page has better UX and why?",
    context: "Compare these two fintech onboarding landing pages. Page A is trust-focused with a clean layout emphasizing security badges and testimonials. Page B is engagement-focused with progressive disclosure, animated transitions, and an interactive demo widget.",
    imageUrls: ["/assets/landing_a.svg", "/assets/landing_b.svg"],
    bountyLamports: 50_000_000,
    lockTxSig: "MOCK_LOCK_seed_000001",
  });
  store.upsert(t1);

  // ── Task 2: Checkout flow — VERIFIED_PAID ─────────────────
  const t2Id = crypto.randomUUID();
  const t2f = mkFulfillment(t2Id, "The trust signals are present but undersized. The SSL badge is only 16px and the money-back guarantee is below the fold. Moving the guarantee above the payment form and enlarging the review count to a star-rating bar would reduce friction. The form itself is clean but lacks inline validation which adds uncertainty.");
  const t2s = mkScore(t2Id, t2f.id, 82, "Thorough analysis with specific, actionable recommendations. Correctly identified the key friction points.");
  const t2r = mkReview(t2Id, t2f.id, t2s.id, 80, true, "Accurate assessment. The trust signal sizing issue is a real conversion blocker.");
  store.upsert(base({
    id: t2Id,
    question: "Does the checkout flow communicate trust effectively to first-time buyers?",
    context: "This is a 3-step checkout for a direct-to-consumer supplement brand. The agent detected that the cart-abandonment rate is 68% at step 2 (payment info). Evaluate whether the trust signals (SSL badge, money-back guarantee, review count) are prominent enough and whether the form layout reduces perceived friction.",
    imageUrls: ["/assets/checkout_trust.svg"],
    bountyLamports: 45_000_000,
    lockTxSig: "MOCK_LOCK_seed_000002",
    status: "VERIFIED_PAID",
    subscriberAgentId: subId,
    fulfillment: t2f,
    supervisorScore: t2s,
    verifierReview: t2r,
    subscriberPaymentTxSig: "MOCK_SPLIT_SUB_seed002",
    verifierPaymentTxSig: "MOCK_SPLIT_VER_seed002",
    updatedAtMs: now - 30_000,
  }));

  // ── Task 3: Dashboard — VERIFIED_PAID ─────────────────────
  const t3Id = crypto.randomUUID();
  const t3f = mkFulfillment(t3Id, "MRR does not stand out — all four KPI cards are identical in size, color weight, and typography. To fix: make MRR 2x wider, use the primary brand color only for MRR, and set the other three cards to a muted variant. The bar chart below reinforces revenue trend well but the sidebar filters add noise. Consider removing filters from the default view.");
  const t3s = mkScore(t3Id, t3f.id, 88, "Excellent hierarchy analysis with concrete layout suggestions. The 2x width recommendation for MRR is particularly practical.");
  const t3r = mkReview(t3Id, t3f.id, t3s.id, 85, true, "Strong analysis. Agreed that equal sizing is the core problem.");
  store.upsert(base({
    id: t3Id,
    question: "Rate the visual hierarchy of this analytics dashboard — does the most important metric stand out?",
    context: "Enterprise SaaS dashboard showing MRR, churn rate, active users, and NPS. The PM wants MRR to be the hero metric but the current layout gives equal visual weight to all four KPIs. The agent needs a human to judge whether the information architecture matches business priorities and whether the color coding helps or hinders quick scanning.",
    imageUrls: ["/assets/dashboard_kpi.svg"],
    bountyLamports: 80_000_000,
    lockTxSig: "MOCK_LOCK_seed_000003",
    status: "VERIFIED_PAID",
    subscriberAgentId: subId,
    fulfillment: t3f,
    supervisorScore: t3s,
    verifierReview: t3r,
    subscriberPaymentTxSig: "MOCK_SPLIT_SUB_seed003",
    verifierPaymentTxSig: "MOCK_SPLIT_VER_seed003",
    updatedAtMs: now - 25_000,
  }));

  // ── Task 4: Pricing page — FULFILLED ──────────────────────
  const t4Id = crypto.randomUUID();
  const t4f = mkFulfillment(t4Id, "Most visitors will choose Free and stay there. The jump from Free (3 projects) to Pro (unlimited) is too abstract — users don't know if they'll need more than 3 projects until they hit the wall. Recommendation: change Free to '1 active project' so the constraint is felt immediately, and add a '14-day Pro trial' CTA instead of a hard upgrade.");
  store.upsert(base({
    id: t4Id,
    question: "Which pricing tier will most visitors choose, and is the upgrade path from Free to Pro clear?",
    context: "B2B project-management tool with three tiers: Free, Pro (12/mo), and Enterprise (custom). The agent analyzed the feature comparison table but cannot determine whether the value gap between Free and Pro justifies the price jump from a human perception standpoint. The Pro tier includes 'unlimited projects' and 'priority support' — evaluate whether these differentiators are compelling enough to convert free users.",
    imageUrls: ["/assets/pricing_page.svg"],
    bountyLamports: 60_000_000,
    lockTxSig: "MOCK_LOCK_seed_000004",
    status: "FULFILLED",
    subscriberAgentId: subId,
    fulfillment: t4f,
    updatedAtMs: now - 90_000,
  }));

  // ── Task 5: Onboarding — UNDER_REVIEW ─────────────────────
  const t5Id = crypto.randomUUID();
  const t5f = mkFulfillment(t5Id, "Non-technical users will likely drop off at step 2. The OAuth popup is jarring — it opens a new window with unfamiliar branding and permission scopes. The main page gives no preview of what will happen. Fix: add a 3-frame visual preview showing 'You'll see a popup → Click Allow → Done' before the Connect button. Also add a 'Skip for now' option since the integration isn't strictly needed to explore templates.");
  const t5s = mkScore(t5Id, t5f.id, 76, "Good identification of the core UX issue with the OAuth popup. The visual preview suggestion is practical. The skip option is a smart fallback.");
  store.upsert(base({
    id: t5Id,
    question: "Will a non-technical user be able to complete this onboarding without dropping off?",
    context: "A no-code automation platform has a 5-step onboarding wizard: (1) name your workspace, (2) connect an integration (OAuth popup), (3) choose a template, (4) customize the template, (5) run your first automation. Analytics show 40% drop-off at step 2 (OAuth). The agent suspects the OAuth popup is confusing but needs human judgment on whether the instructions and visual cues are sufficient for someone unfamiliar with API integrations.",
    imageUrls: ["/assets/onboarding_oauth.svg"],
    bountyLamports: 55_000_000,
    lockTxSig: "MOCK_LOCK_seed_000005",
    status: "UNDER_REVIEW",
    subscriberAgentId: subId,
    fulfillment: t5f,
    supervisorScore: t5s,
    updatedAtMs: now - 50_000,
  }));

  // ── Task 6: Dark mode — OPEN ──────────────────────────────
  store.upsert(base({
    id: crypto.randomUUID(),
    question: "Does this dark mode implementation have sufficient contrast, or are any elements hard to read?",
    context: "A developer tools platform shipped dark mode. The agent ran automated WCAG contrast checks and most elements pass AA, but three components flagged as borderline: (1) secondary button outlines against the dark surface, (2) disabled input placeholder text, (3) code syntax highlighting for comments. Automated checks cannot account for real-world perception on different monitors — a human should verify readability.",
    imageUrls: ["/assets/dark_mode.svg"],
    bountyLamports: 30_000_000,
    lockTxSig: "MOCK_LOCK_seed_000006",
  }));

  // ── Task 7: Social proof — CLAIMED ────────────────────────
  store.upsert(base({
    id: crypto.randomUUID(),
    question: "Is the social proof on this SaaS homepage convincing, or does it feel manufactured?",
    context: "A cybersecurity startup's homepage shows: a rotating carousel of 6 client logos (3 well-known, 3 obscure), a single blockquote testimonial from a CTO, and a '10,000+ teams trust us' counter. The agent cannot judge whether the overall impression feels credible or whether the mix of strong and weak logos undermines trust. Also evaluate whether the testimonial placement (below the fold, after features) is optimal or should be moved higher.",
    imageUrls: ["/assets/social_proof.svg"],
    bountyLamports: 70_000_000,
    lockTxSig: "MOCK_LOCK_seed_000007",
    status: "CLAIMED",
    subscriberAgentId: subId,
    updatedAtMs: now - 200_000,
  }));

  // ── Task 8: Empty states — OPEN ───────────────────────────
  store.upsert(base({
    id: crypto.randomUUID(),
    question: "Do these empty states guide the user toward their first action, or do they feel like dead ends?",
    context: "A team collaboration app has three empty states: (1) Dashboard with no projects — shows an illustration and 'Create your first project' button, (2) Inbox with no messages — shows 'All caught up!' with a checkmark, (3) Reports page with no data — shows 'No reports yet' with no call to action. The agent identified that state 3 lacks a clear next step but needs human judgment on whether the illustrations are helpful or patronizing, and whether the overall tone matches a professional B2B context.",
    imageUrls: ["/assets/empty_states.svg"],
    bountyLamports: 42_000_000,
    lockTxSig: "MOCK_LOCK_seed_000008",
  }));

  // ── Task 9: Content moderation — DISPUTED ─────────────────
  const t9Id = crypto.randomUUID();
  const t9f = mkFulfillment(t9Id, "Yes, surface it. The educational value outweighs the mild mature themes. Teens aged 13-17 are regularly exposed to similar content in school curricula. The violence references are contextual (historical documentary style) not gratuitous. Add an age-gate interstitial with content warnings rather than blocking entirely.");
  const t9s = mkScore(t9Id, t9f.id, 45, "The analysis is too permissive. It dismisses the substance references without adequate consideration of platform liability.");
  const t9r = mkReview(t9Id, t9f.id, t9s.id, 30, false, "Fulfillment oversimplifies the risk. The substance references alone warrant blocking for under-16, not just a warning interstitial. Needs re-evaluation with stricter criteria.");
  store.upsert(base({
    id: t9Id,
    question: "Should the recommendation algorithm surface this content to users under 18?",
    context: "A video platform's recommendation engine flagged a content item for manual review. The video contains edgy humor with mild violence references and substance mentions, but also has educational value. The AI confidence score is 68% (below the auto-approve threshold). Similar content has been split roughly 60/40 between approved and blocked. The agent cannot make moral judgments about age-appropriateness — a human must decide whether the educational value outweighs the mature themes for a teenage audience.",
    imageUrls: ["/assets/content_moderation.svg"],
    bountyLamports: 65_000_000,
    lockTxSig: "MOCK_LOCK_seed_000009",
    status: "DISPUTED",
    subscriberAgentId: subId,
    fulfillment: t9f,
    supervisorScore: t9s,
    verifierReview: t9r,
    updatedAtMs: now - 20_000,
  }));

  // ── Task 10: Email subject line — FULFILLED ───────────────
  const t10Id = crypto.randomUUID();
  const t10f = mkFulfillment(t10Id, "Variant A is spammy — the all-caps, emoji, and fear tactics violate fintech brand trust. Variant C is too passive for re-engagement. Variant B is the winner: the '80% complete' framing leverages the Zeigarnik effect (desire to finish incomplete tasks) without being manipulative. Recommend B with a minor tweak: add the user's first name for personalization.");
  store.upsert(base({
    id: t10Id,
    question: "Does this email subject line feel compelling or spammy?",
    context: "A fintech app is running a re-engagement campaign targeting users who signed up but never completed onboarding (7+ days inactive). The AI generated three subject line variants: (A) an urgency-driven line with emoji and caps, (B) a progress-nudge referencing their 80% completion, and (C) a conversational question about goals. The agent predicted open rates but cannot judge whether variant A crosses the line into spam territory for a regulated financial brand, or whether variant C is too passive to drive action.",
    imageUrls: ["/assets/email_subject.svg"],
    bountyLamports: 38_000_000,
    lockTxSig: "MOCK_LOCK_seed_000010",
    status: "FULFILLED",
    subscriberAgentId: subId,
    fulfillment: t10f,
    updatedAtMs: now - 80_000,
  }));

  // ── Task 11: Health summary — OPEN ────────────────────────
  store.upsert(base({
    id: crypto.randomUUID(),
    question: "Is this patient-facing health summary medically accurate?",
    context: "A health portal uses AI to convert physician visit notes into plain-language summaries for patients. This summary covers a Type 2 Diabetes follow-up: diagnosis, two medications (Metformin 500mg, Lisinopril 10mg), dietary instructions, and a follow-up date. The AI flagged potential issues: a possible drug interaction not mentioned, an omitted A1C target, and vague exercise guidance. The agent cannot verify clinical accuracy — a human with medical knowledge should assess whether this summary is safe to show a patient.",
    imageUrls: ["/assets/health_summary.svg"],
    bountyLamports: 90_000_000,
    lockTxSig: "MOCK_LOCK_seed_000011",
  }));

  // ── Task 12: Complaint triage — CLAIMED ───────────────────
  store.upsert(base({
    id: crypto.randomUUID(),
    question: "Rank these 4 customer complaints by severity — which needs immediate response?",
    context: "A support queue has 4 open tickets: (1) Billing — enterprise customer charged 499 instead of 49, angry, high churn risk; (2) Feature request — healthcare org needs CSV columns for SOC2 audit in 2 weeks; (3) Bug — free-tier user reports dark mode resets on refresh, mild annoyance; (4) Outage — enterprise customer (48k ARR, 200 seats) reports API 503 errors, production pipeline down. The agent extracted sentiment and churn risk but cannot weigh business impact, customer lifetime value, and urgency the way a human support lead can.",
    imageUrls: ["/assets/complaint_triage.svg"],
    bountyLamports: 55_000_000,
    lockTxSig: "MOCK_LOCK_seed_000012",
    status: "CLAIMED",
    subscriberAgentId: subId,
    updatedAtMs: now - 180_000,
  }));

  // ── Task 13: Resume screening — VERIFIED_PAID ─────────────
  const t13Id = crypto.randomUUID();
  const t13f = mkFulfillment(t13Id, "Candidate B is the best fit. Sarah (A) is overqualified and a flight risk — 3 jobs in 3 years plus above-budget salary signals she'll leave within a year. Priya (C) has great potential but is too junior for a 4-person team that needs someone productive on day one. Marcus (B) has the startup DNA to thrive in a Series B environment, ships fast, and is within budget. His React gap can be closed in 2-3 months with the existing team's mentorship.");
  const t13s = mkScore(t13Id, t13f.id, 91, "Excellent reasoning that weighs retention risk, team dynamics, and growth trajectory — not just technical match. The recommendation is well-justified.");
  const t13r = mkReview(t13Id, t13f.id, t13s.id, 88, true, "Strong analysis. Agreed on Candidate B. The flight risk assessment of Candidate A is spot on.");
  store.upsert(base({
    id: t13Id,
    question: "Which of these 3 candidate resumes is the best fit for this role?",
    context: "Hiring for a mid-level Frontend Engineer at a Series B startup (React/TypeScript/Node, 120-160k budget, 4-person team). Candidate A: 8 years FAANG experience, 90% skills match, but overqualified, job-hopper pattern (3 in 3 years), and asking 185k (above budget). Candidate B: 4 years startup background, 71% match, shipped 0-to-1 product, within budget at 140k, but lacks React depth. Candidate C: 2 years bootcamp-to-agency path, 61% match, strong design sense and impressive portfolio, asking 110k, but junior-level. The agent scored technical fit but cannot assess culture fit, growth potential, or whether the budget stretch for Candidate A is worth it.",
    imageUrls: ["/assets/resume_screen.svg"],
    bountyLamports: 75_000_000,
    lockTxSig: "MOCK_LOCK_seed_000013",
    status: "VERIFIED_PAID",
    subscriberAgentId: subId,
    fulfillment: t13f,
    supervisorScore: t13s,
    verifierReview: t13r,
    subscriberPaymentTxSig: "MOCK_SPLIT_SUB_seed013",
    verifierPaymentTxSig: "MOCK_SPLIT_VER_seed013",
    updatedAtMs: now - 15_000,
  }));

  // ── Ledger entries for all tasks ─────────────────────
  // Every task gets a LOCK entry. Tasks further in the pipeline get additional entries.

  const allTasks = store.list();
  for (const t of allTasks) {
    // LOCK — every task has a bounty lock
    ledgerStore.add(mkLedger("LOCK", t.id, t.lockTxSig || `MOCK_LOCK_${t.id.slice(0, 8)}`, t.bountyLamports, "OPEN", "Bounty locked in escrow", t.agentPubkey, ESCROW_KEY, 0));

    // CHAIN_LOG — tasks with fulfillments have on-chain logging
    if (t.fulfillment) {
      ledgerStore.add(mkLedger("CHAIN_LOG", t.id, `MOCK_CHAINLOG_${t.id.slice(0, 8)}`, 0, "FULFILLED", "Fulfillment logged on-chain", SUB_KEY, undefined, 120_000));
    }

    // VERIFIED_PAID — subscriber + verifier payments
    if (t.status === "VERIFIED_PAID" && t.subscriberPaymentTxSig) {
      const subAmount = Math.floor(t.bountyLamports * 0.7);
      const verAmount = t.bountyLamports - subAmount;
      ledgerStore.add(mkLedger("SUBSCRIBER_PAY", t.id, t.subscriberPaymentTxSig, subAmount, "VERIFIED_PAID", "Payment to subscriber", ESCROW_KEY, SUB_KEY, 240_000));
      if (t.verifierPaymentTxSig) {
        ledgerStore.add(mkLedger("VERIFIER_PAY", t.id, t.verifierPaymentTxSig, verAmount, "VERIFIED_PAID", "Payment to verifier", ESCROW_KEY, VER_KEY, 250_000));
      }
      ledgerStore.add(mkLedger("CHAIN_LOG", t.id, `MOCK_VERIFY_LOG_${t.id.slice(0, 8)}`, 0, "VERIFIED_PAID", "Verification logged on-chain", VER_KEY, undefined, 260_000));
    }

    // DISPUTED — dispute chain log
    if (t.status === "DISPUTED" && t.verifierReview) {
      ledgerStore.add(mkLedger("CHAIN_LOG", t.id, `MOCK_DISPUTE_LOG_${t.id.slice(0, 8)}`, 0, "DISPUTED", "Dispute verification logged on-chain", VER_KEY, undefined, 240_000));
    }
  }

  console.log(`[server] seeded 13 demo tasks + ${ledgerStore.list().length} ledger entries`);
}
