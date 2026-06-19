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
		question: "How do I count the tokens in my prompt?",
		answer:
			"Paste your text into the calculator and it counts the exact tokens in your browser using a real BPE tokenizer (the GPT-4o / o200k_base encoding), the same kind of tokenizer the models use to bill you. Nothing is uploaded — the counting happens locally. You instantly see the token count alongside characters and words, plus what that text costs on every major model.",
	},
	{
		question: "How many tokens is 1,000 words or one page of text?",
		answer:
			"As a rule of thumb, 1,000 English words is roughly 1,300–1,500 tokens, and one token is about four characters, so 1,000 tokens is around 750 words. Code, JSON, and non-English text tokenize less efficiently and use more tokens per word, which is exactly why pasting your real text into the tokenizer gives a far more accurate count than a word-based estimate.",
	},
	{
		question: "How is the cost of LLM tokens calculated?",
		answer:
			"Providers bill separately for input tokens (your prompt) and output tokens (the model's response), priced per million tokens. Your total cost is (input tokens × input price) + (output tokens × output price). This calculator counts your input tokens exactly, lets you set an expected output length, and runs that math for every model.",
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
			"Input token counts come from a real BPE tokenizer running on your exact text, so they closely match what providers measure. Costs use each model's current published per-token prices. The main variables are output length (you estimate it, since it isn't known until the model responds), prompt caching, reasoning tokens on thinking models, and any negotiated rates. Treat the numbers as a tight planning estimate rather than a final invoice.",
	},
	{
		question: "Do different models count tokens differently?",
		answer:
			"Yes. Each model family has its own tokenizer, so the same text can produce slightly different counts. This tool standardizes on the GPT-4o (o200k_base) tokenizer, which is the modern OpenAI standard and lands within roughly ±15% of other families like Claude, Gemini, and Llama — close enough for accurate budgeting, since none of those providers ship a tokenizer that runs in the browser.",
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
