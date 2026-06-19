export interface CalculatorFaqItem {
	question: string;
	answer: string;
}

/**
 * Shared FAQ source of truth for the token cost calculator page.
 * Used both to render the on-page FAQ and to generate FAQPage JSON-LD,
 * so the two never drift apart.
 */
export const CALCULATOR_FAQ: CalculatorFaqItem[] = [
	{
		question: "How is the cost of LLM tokens calculated?",
		answer:
			"Providers bill separately for input tokens (your prompt) and output tokens (the model's response), priced per million tokens. Your total cost is (input tokens × input price) + (output tokens × output price). This calculator runs that math for every model you add and sums the result.",
	},
	{
		question: "What is the difference between input and output tokens?",
		answer:
			"Input tokens are everything you send to the model, including your prompt, system message, and conversation history. Output tokens are what the model generates back. Output tokens almost always cost more than input tokens, which is why the split matters when you estimate spend.",
	},
	{
		question: "Why do the same model's prices differ between providers?",
		answer:
			"Popular models are often served by several providers at different rates, and prices change as providers compete. LLM Gateway routes each request to the cheapest available provider for that model, so you pay the lowest live rate without changing any code.",
	},
	{
		question: "Does LLM Gateway add a markup or platform fee?",
		answer:
			"No. LLM Gateway passes through provider pricing with zero platform markup, so you pay exactly what the provider charges (and less when a cheaper provider or volume discount is available). You only add a payment method once you start sending real traffic.",
	},
	{
		question: "How accurate are these cost estimates?",
		answer:
			"Estimates use current published per-token prices for each model and provider. Real-world cost depends on your exact token counts, caching, and any negotiated rates, so treat the numbers as a close planning estimate rather than a final invoice.",
	},
	{
		question:
			"What is the cheapest way to call LLMs like GPT-4o, Claude, and Gemini?",
		answer:
			"Route through a gateway that compares providers and picks the lowest price per request. Because LLM Gateway supports 280+ models behind one OpenAI-compatible API, you can switch models or providers based on cost without rewriting your integration.",
	},
	{
		question: "Is the token cost calculator free to use?",
		answer:
			"Yes, the calculator is completely free and requires no signup. You can compare as many models and token volumes as you like, then create a free LLM Gateway account when you are ready to start sending requests.",
	},
];
