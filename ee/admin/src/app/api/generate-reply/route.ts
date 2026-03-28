import { generateText, Output } from "ai";
import { z } from "zod";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";

const emailSchema = z.object({
	subject: z.string().describe("A concise, professional email subject line"),
	body: z.string().describe("The full email body text"),
});

interface GenerateReplyRequest {
	apiKey: string;
	name: string;
	email: string;
	context?: string;
	type: "enterprise" | "signup";
	country?: string;
	size?: string;
	message?: string;
	plan?: string;
	orgName?: string;
}

export async function POST(req: Request) {
	const data: GenerateReplyRequest = await req.json();

	if (!data.apiKey) {
		return Response.json(
			{ error: "Missing LLM Gateway API key" },
			{ status: 400 },
		);
	}

	const llmgateway = createLLMGateway({
		apiKey: data.apiKey,
	});

	try {
		const leadResearch = await generateText({
			model: llmgateway("openai/gpt-4o-mini"),
			system: `You are a lead research agent. Given a person's name or email address, research them thoroughly using your built-in web search capabilities.

Produce a structured summary with the following sections:
- **Name**: Full name
- **Bio**: A brief biography (2-3 sentences)
- **Current Role**: Job title and company
- **Background**: Education, previous roles, notable achievements
- **Social Links**: Any public profiles (LinkedIn, Twitter/X, GitHub, personal website, etc.)

If the person cannot be found or the query is ambiguous, explain what you found and summarize what you know from the provided context.
Format the summary in a clean, readable way.`,
			prompt: `Research this person: ${data.name} (${data.email})${data.country ? `, from ${data.country}` : ""}${data.size ? `, company size: ${data.size}` : ""}${data.orgName ? `, organization: ${data.orgName}` : ""}`,
		});

		const contextBlock =
			data.type === "enterprise"
				? `This is a reply to an enterprise contact form submission.

Submission details:
- Name: ${data.name}
- Email: ${data.email}
- Country: ${data.country ?? "Unknown"}
- Company Size: ${data.size ?? "Unknown"}
- Message: ${data.message ?? "No message provided"}`
				: `This is a welcome/outreach email to a new user who signed up.

User details:
- Name: ${data.name}
- Email: ${data.email}
- Organization: ${data.orgName ?? "Unknown"}
- Plan: ${data.plan ?? "free"}`;

		const emailDraft = await generateText({
			model: llmgateway("openai/gpt-4o-mini"),
			output: Output.object({ schema: emailSchema }),
			system: `You are an email drafting assistant for LLM Gateway, an AI/LLM API gateway service that provides access to 300+ AI models through a single OpenAI-compatible API.

${data.type === "enterprise" ? "Draft a professional reply to their enterprise inquiry." : "Draft a personalized welcome/outreach email to this new user."}

Guidelines:
- Write from the perspective of LLM Gateway team
- Be warm, professional, and helpful
- ${data.type === "enterprise" ? "Address their specific inquiry" : "Welcome them and offer to help with their use case"}
- Keep paragraphs short and scannable
- Sign off as "The LLM Gateway Team"
- Don't use markdown formatting in the email body, keep it plain text
${data.context ? `\nAdditional context: ${data.context}` : ""}

Here is research about the recipient:
${leadResearch.text}`,
			prompt: contextBlock,
		});

		if (!emailDraft.output) {
			return Response.json(
				{ error: "Failed to generate email draft" },
				{ status: 500 },
			);
		}

		return Response.json(emailDraft.output);
	} catch (err) {
		const message =
			err instanceof Error ? err.message : "Failed to generate reply";
		return Response.json({ error: message }, { status: 500 });
	}
}
