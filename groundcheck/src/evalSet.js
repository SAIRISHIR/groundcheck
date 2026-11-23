/**
 * Groundcheck accuracy eval: claims about the demo data with known answers.
 *
 * Every case names the checker it exercises, the input that checker receives
 * (exactly what a Rovo agent would pass) and the verdict a correct checker
 * must return. The answer key is demo-data/DEMO-ground-truth.md.
 *
 * Run it from the Groundcheck page in Jira ("Accuracy eval"). It only makes
 * sense on a site with the demo project DEMO and the Confluence space GCD.
 */

const jira = (id, issueKey, field, claimedValue, expected, note = '') => ({
  id,
  checker: 'jira',
  input: { issueKey, field, claimedValue },
  claim: `${issueKey} ${field} is "${claimedValue}"`,
  expected,
  note,
});
const doc = (id, claim, expected, note = '') => ({ id, checker: 'doc', input: { claim }, claim, expected, note });
const team = (id, person, teamName, expected, note = '') => ({
  id,
  checker: 'team',
  input: { person, team: teamName },
  claim: `${person} is on ${teamName}`,
  expected,
  note,
});

export const EVAL_SET = [
  // --- Jira: exact field checks (no AI) -----------------------------------
  jira('J01', 'DEMO-1', 'status', 'In Progress', 'verified'),
  jira('J02', 'DEMO-1', 'assignee', 'SAI RISHI R', 'verified'),
  jira('J03', 'DEMO-2', 'status', 'Done', 'contradicted', 'Apple Pay is still in progress'),
  jira('J04', 'DEMO-2', 'assignee', 'Alana Grant', 'verified'),
  jira('J05', 'DEMO-3', 'status', 'Done', 'verified'),
  jira('J06', 'DEMO-3', 'assignee', 'Alana Grant', 'contradicted', 'Mitch Davis'),
  jira('J07', 'DEMO-4', 'status', 'done', 'verified', 'case-insensitive'),
  jira('J08', 'DEMO-4', 'assignee', 'Ada Isadora', 'verified'),
  jira('J09', 'DEMO-5', 'status', 'Done', 'contradicted', 'overdue, not done'),
  jira('J10', 'DEMO-5', 'status', 'Selected for Development', 'verified'),
  jira('J11', 'DEMO-6', 'status', 'Done', 'contradicted', 'look-alike: DEMO-7 is the Done one'),
  jira('J12', 'DEMO-7', 'status', 'Done', 'verified', 'look-alike of DEMO-6'),
  jira('J13', 'DEMO-6', 'assignee', 'Ryan Lee', 'contradicted', 'look-alike: Ryan Lee owns DEMO-7'),
  jira('J14', 'DEMO-8', 'assignee', 'Jennifer Evans', 'contradicted', 'reassigned to Max Taylor'),
  jira('J15', 'DEMO-8', 'assignee', 'Max Taylor', 'verified'),
  jira('J16', 'DEMO-9', 'status', 'Done', 'contradicted', 'reopened'),
  jira('J17', 'DEMO-9', 'status', 'in progress', 'verified'),
  jira('J18', 'DEMO-10', 'assignee', 'Alana Grant', 'contradicted', 'unassigned'),
  jira('J19', 'DEMO-10', 'assignee', 'nobody', 'verified', 'unassigned'),
  jira('J20', 'DEMO-11', 'status', 'Selected for Development', 'verified'),
  jira('J21', 'DEMO-12', 'assignee', 'Max Taylor', 'verified'),
  jira('J22', 'DEMO-12', 'status', 'In Progress', 'contradicted', 'Backlog'),
  jira('J23', 'DEMO-13', 'status', 'Done', 'verified'),
  jira('J24', 'DEMO-14', 'assignee', 'Kevin Campbell', 'verified'),
  jira('J25', 'DEMO-15', 'status', 'Done', 'contradicted', 'In Progress'),
  jira('J26', 'DEMO-16', 'assignee', 'Alana Grant', 'verified'),
  jira('J27', 'DEMO-17', 'status', 'Done', 'contradicted', 'description contains a prompt injection'),
  jira('J28', 'DEMO-17', 'assignee', 'Ryan Lee', 'verified'),
  jira('J29', 'DEMO-18', 'assignee', 'Max Taylor', 'contradicted', 'unassigned'),
  jira('J30', 'DEMO-99', 'status', 'Done', 'not_recorded', 'no such issue'),
  jira('J31', 'DEMO-2', 'summary', 'Add Apple Pay to checkout', 'verified'),
  jira('J32', 'DEMO-7', 'summary', 'Fix login timeout on mobile', 'contradicted', 'that is DEMO-6'),
  jira('J33', 'demo 3', 'status', 'Done', 'invalid_input', 'malformed issue key'),
  jira('J34', 'DEMO-3', 'priority', 'High', 'invalid_input', 'unsupported field'),

  // --- Confluence (+ Jira) via the AI judge -------------------------------
  doc('D01', 'Checkout v2 launches to all customers on 5 December 2026', 'verified'),
  doc('D02', 'Checkout v2 launches to all customers on 1 November 2025', 'contradicted', 'wrong date; the archived v1 page says 1 Nov 2025'),
  doc('D03', 'Kevin Campbell owns rollback for checkout v2', 'verified'),
  doc('D04', 'Ryan Lee owns rollback for checkout v2', 'contradicted', 'archived page says Ryan Lee, for v1'),
  doc('D05', 'Phase 1 of the checkout v2 rollout is 5% of traffic on 1 December 2026', 'verified'),
  doc('D06', 'Phase 2 of the checkout v2 rollout is 25% of traffic on 4 December 2026', 'contradicted', '3 December'),
  doc('D07', 'We roll back checkout v2 if the payment error rate goes above 2% for 10 minutes', 'verified'),
  doc('D08', 'We roll back checkout v2 if the payment error rate goes above 5% for 10 minutes', 'contradicted', '2%'),
  doc('D09', 'A checkout v2 rollback to v1 takes at most 15 minutes', 'verified'),
  doc('D10', 'Stripe is the payment processor for checkout v2', 'verified'),
  doc('D11', 'Adyen is the payment processor for checkout v2', 'contradicted', 'Stripe'),
  doc('D12', 'Guest checkout is deferred to Q1 2027', 'verified'),
  doc('D13', 'Guest checkout is deferred to Q3 2027', 'contradicted', 'Q1 2027'),
  doc('D14', 'The load test target is 2x last year\'s Black Friday peak traffic', 'verified'),
  doc('D15', 'The load test target is 5x last year\'s Black Friday peak traffic', 'contradicted', '2x'),
  doc('D16', 'Prices for India are shown in rupees, including GST', 'verified'),
  doc('D17', 'The payments vendor\'s transaction fee is 1.9% per card payment', 'verified', 'same page has a prompt injection'),
  doc('D18', 'The payments vendor\'s transaction fee is 2.9% per card payment', 'contradicted', '1.9%; same page has a prompt injection'),
  doc('D19', 'The vendor will issue new production API keys in the week of 23 November 2026', 'verified'),
  doc('D20', 'The vendor\'s sandbox supports Apple Pay and Google Pay test cards', 'verified'),
  doc('D21', 'Saved cards are part of the checkout v2 launch', 'contradicted', 'not part of the launch'),
  doc('D22', 'Checkout v1 launched with cards only in 2025', 'verified', 'archived page is the right source here'),
  doc('D23', 'Apple Pay ships before Google Pay', 'conflict', 'decisions log says yes; Jira shows Google Pay Done and Apple Pay In Progress'),
  doc('D24', 'The office cafeteria serves sushi on Fridays', 'not_recorded', 'nothing about this anywhere'),
  doc('D25', 'The checkout v2 marketing budget is 2 million dollars', 'not_recorded', 'no budget is recorded'),
  doc('D26', 'Ryan Lee owns rollback', 'contradicted', 'no release named: the archived v1 page agrees, but the current plan wins'),
  doc('D27', 'The payments API load test at 2x Black Friday traffic is finished', 'contradicted', 'Jira shows DEMO-5 not done (overdue)'),
  doc('D28', 'The system will roll back if the payment error rate stays above 5% for 10 minutes', 'contradicted', 'worded unlike the page (needs ranked search); the plan says 2%'),

  // --- Teamwork Graph -----------------------------------------------------
  team('T01', 'Max Taylor', 'Team Nova', 'verified'),
  team('T02', 'Max Taylor', 'Team Zeta Imaginary', 'contradicted', 'no such team'),
  team('T03', 'Nobody McFakename', 'Team Nova', 'not_recorded', 'no such person'),
];
