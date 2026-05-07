import { generateText, Output } from "ai";
import { cookies } from "next/headers";
import { z } from "zod";

import { getConfig } from "@/lib/config-server";
import { getUser } from "@/lib/getUser";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";

const COOKIE_NAME = "llmgateway_admin_key";

const emailSchema = z.object({
	subject: z.string().describe("A concise, professional email subject line"),
	body: z.string().describe("The full email body text"),
});

interface GenerateReplyRequest {
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

async function getApiKey(): Promise<{
	token: string;
	setCookie?: { name: string; value: string };
} | null> {
	const cookieStore = await cookies();
	const existing = cookieStore.get(COOKIE_NAME)?.value;
	if (existing) {
		return { token: existing };
	}

	const user = await getUser();
	if (!user) {
		return null;
	}

	const config = getConfig();
	const key = "better-auth.session_token";
	const sessionCookie = cookieStore.get(`${key}`);
	const secureSessionCookie = cookieStore.get(`__Secure-${key}`);
	const cookieHeader = secureSessionCookie
		? `__Secure-${key}=${secureSessionCookie.value}`
		: sessionCookie
			? `${key}=${sessionCookie.value}`
			: "";

	// Get user's first org
	const orgsRes = await fetch(`${config.apiBackendUrl}/orgs`, {
		headers: { Cookie: cookieHeader },
	});
	if (!orgsRes.ok) {
		return null;
	}
	const orgsData = (await orgsRes.json()) as {
		organizations: { id: string }[];
	};
	const org = orgsData.organizations?.[0];
	if (!org) {
		return null;
	}

	// Get first project
	const projectsRes = await fetch(
		`${config.apiBackendUrl}/orgs/${org.id}/projects`,
		{ headers: { Cookie: cookieHeader } },
	);
	if (!projectsRes.ok) {
		return null;
	}
	const projectsData = (await projectsRes.json()) as {
		projects: { id: string }[];
	};
	const project = projectsData.projects?.[0];
	if (!project) {
		return null;
	}

	// Ensure a key exists for this project
	const ensureRes = await fetch(
		`${config.apiBackendUrl}/playground/ensure-key`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: cookieHeader },
			body: JSON.stringify({ projectId: project.id }),
		},
	);
	if (!ensureRes.ok) {
		return null;
	}
	const ensureData = (await ensureRes.json()) as {
		ok: boolean;
		token?: string;
	};
	if (!ensureData.token) {
		return null;
	}

	return {
		token: ensureData.token,
		setCookie: { name: COOKIE_NAME, value: ensureData.token },
	};
}

export async function POST(req: Request) {
	let data: GenerateReplyRequest;
	try {
		data = await req.json();
	} catch {
		return Response.json(
			{ error: "Invalid JSON in request body" },
			{ status: 400 },
		);
	}

	if (!data.name || !data.email || !data.type) {
		return Response.json(
			{ error: "Missing required fields: name, email, type" },
			{ status: 400 },
		);
	}

	const keyResult = await getApiKey();
	if (!keyResult) {
		return Response.json(
			{ error: "Could not obtain API key. Please ensure you are logged in." },
			{ status: 401 },
		);
	}

	const gatewayUrl =
		process.env.GATEWAY_URL ??
		(process.env.NODE_ENV === "development"
			? "http://localhost:4001/v1"
			: "https://api.llmgateway.io/v1");

	const llmgateway = createLLMGateway({
		apiKey: keyResult.token,
		baseURL: gatewayUrl,
	});

	try {
		const leadResearch = await generateText({
			model: llmgateway("auto"),
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
			model: llmgateway("auto"),
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

		const response = Response.json(emailDraft.output);

		// Cache the API key in a cookie for future requests
		if (keyResult.setCookie) {
			response.headers.append(
				"Set-Cookie",
				`${keyResult.setCookie.name}=${keyResult.setCookie.value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
			);
		}

		return response;
	} catch (err) {
		const message =
			err instanceof Error ? err.message : "Failed to generate reply";
		return Response.json({ error: message }, { status: 500 });
	}
}
