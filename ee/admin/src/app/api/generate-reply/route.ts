import { generateText, Output } from "ai";
import { z } from "zod";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";

const emailSchema = z.object({
	subject: z.string().describe("A concise, professional email subject line"),
	body: z.string().describe("The full email body text"),
});

export async function POST(req: Request) {
	const {
		apiKey,
		name,
		email,
		country,
		size,
		message,
	}: {
		apiKey: string;
		name: string;
		email: string;
		country: string;
		size: string;
		message: string;
	} = await req.json();

	if (!apiKey) {
		return Response.json(
			{ error: "Missing LLM Gateway API key" },
			{ status: 400 },
		);
	}

	const gatewayUrl =
		process.env.GATEWAY_URL ??
		(process.env.NODE_ENV === "development"
			? "http://localhost:4001/v1"
			: "https://api.llmgateway.io/v1");

	const llmgateway = createLLMGateway({
		apiKey,
		baseURL: gatewayUrl,
	});

	const leadResearch = await generateText({
		model: llmgateway("openai/gpt-4o-mini"),
		system: `You are a lead research agent. Given a person's name and email address, research them thoroughly.

Produce a structured summary with the following sections:
- **Name**: Full name
- **Company/Role**: Likely job title and company based on available info
- **Country**: ${country}
- **Company Size**: ${size}
- **Key Points**: Notable information that could help personalize a response

If information is limited, work with what you have. Be concise.`,
		prompt: `Research this lead: ${name} (${email}) from ${country}, company size: ${size}. Their inquiry: "${message}"`,
	});

	const emailDraft = await generateText({
		model: llmgateway("openai/gpt-4o-mini"),
		output: Output.object({ schema: emailSchema }),
		system: `You are an email drafting assistant for LLM Gateway, an AI/LLM API gateway service. Draft a professional reply email to an enterprise contact form submission.

Guidelines:
- Write from the perspective of LLM Gateway team
- Be warm, professional, and helpful
- Address their specific inquiry
- Keep paragraphs short and scannable
- Sign off as "The LLM Gateway Team"
- Don't use markdown formatting in the email body, keep it plain text

Here is research about the lead:
${leadResearch.text}`,
		prompt: `Draft a reply email to this enterprise contact submission:

Name: ${name}
Email: ${email}
Country: ${country}
Company Size: ${size}
Message: ${message}`,
	});

	return Response.json(emailDraft.output);
}
