export interface CopilotCalculatorFaqItem {
	question: string;
	answer: string;
}

/**
 * Shared FAQ source of truth for the Copilot cost calculator page.
 * Used both to render the on-page FAQ and to generate FAQPage JSON-LD,
 * so the two never drift apart.
 */
export const COPILOT_CALCULATOR_FAQ: CopilotCalculatorFaqItem[] = [
	{
		question: "How does GitHub Copilot billing work in 2026?",
		answer:
			"Since June 1, 2026, GitHub Copilot bills chat, agent mode, code review, and CLI usage in AI Credits (1 credit = $0.01) on top of the seat price. Seats cost $10 (Pro), $39 (Pro+), $100 (Max), $19/user (Business), or $39/user (Enterprise). Pro includes $15 of monthly credits, Pro+ $70, and Max $200; usage beyond that bills per token with no ceiling unless you set a manual budget. Inline completions remain flat-fee.",
	},
	{
		question: "How does this calculator estimate Copilot costs?",
		answer:
			"It models a chat session as a ~5-turn conversation totaling about 30,000 input and 4,000 output tokens (history is resent every turn), and an agent task as roughly 150,000 input and 8,000 output tokens. Both Copilot AI Credits and LLM Gateway are priced from the same token volumes at the same per-million-token rates, so the comparison isolates the structural differences: seat fees and included credits versus prompt caching and a flat platform fee.",
	},
	{
		question: "Why is the LLM Gateway estimate usually lower?",
		answer:
			"Three reasons: there's no per-seat fee for API usage, provider token rates pass through with zero markup (a flat 5% fee on credits, or 0% with your own provider keys), and prompt caching bills the repeated context that coding tools resend on every request at roughly 10% of the normal input rate. Agentic workloads resend a lot of context, so caching does most of the work.",
	},
	{
		question: "Can I set a hard cap on what my team spends?",
		answer:
			"Yes. LLM Gateway enforces budgets with hard limits per organization, project, and API key — requests stop at the cap instead of billing past it. Copilot's spending budgets exist in the billing dashboard but are off by default.",
	},
	{
		question: "What if I want a flat monthly price per developer?",
		answer:
			"DevPass plans give each developer a flat monthly allowance ($29–$179/month) usable across coding agents like DevPass Code, Claude Code, and Cline, with roughly 3x the plan price in monthly usage value. It's the predictable-seat model Copilot used to be, but with model choice.",
	},
	{
		question: "How accurate are these estimates?",
		answer:
			"They're planning estimates, not invoices. Real costs depend on your models' exact rates, conversation lengths, agent context sizes, and cache hit rates — all of which vary by team. The assumptions are documented on this page and every knob is adjustable, so you can match the math to your own usage before you commit to anything.",
	},
	{
		question: "Do I have to stop using GitHub Copilot entirely?",
		answer:
			"No. Inline completions weren't moved to usage billing and remain excellent. A common setup keeps Copilot Free or a $10 Pro seat for completions and routes chat and agent workloads through LLM Gateway, where they're cached, capped, and billed at pass-through rates.",
	},
	{
		question: "Is the Copilot cost calculator free to use?",
		answer:
			"Yes — free, no signup, and everything runs in your browser. When you're ready to test real traffic, an LLM Gateway account is free to create and works with any OpenAI-compatible tool.",
	},
];
