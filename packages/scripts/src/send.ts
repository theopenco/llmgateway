/* eslint-disable no-console */
// JSON Schema:
// [
//   {
//     "email": "user@example.com",
//     "first_name": "John",
//     "last_name": "Doe",
//     "email_subject": "Subject line",
//     "email_content": "Email body text"
//   }
// ]
//
// Usage: RESEND_API_KEY=re_xxx npx tsx send.ts emails.json

import { readFileSync } from "fs";

import { Resend } from "resend";
import { z } from "zod";

const resend = new Resend(process.env.RESEND_API_KEY);

const EmailRowSchema = z.object({
	email: z.string().email(),
	first_name: z.string(),
	last_name: z.string(),
	email_subject: z.string().min(1),
	email_content: z.string().min(1),
});

const EmailsSchema = z.array(EmailRowSchema);

type EmailRow = z.infer<typeof EmailRowSchema>;

async function sleep(ms: number) {
	return await new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWithRetry(
	row: EmailRow,
	maxRetries = 5,
): Promise<{ success: boolean; id?: string; error?: unknown }> {
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		const { data, error } = await resend.emails.send({
			from: "Luca from LLMGateway <contact@mail.llmgateway.io>",
			to: row.email,
			subject: row.email_subject,
			text: row.email_content,
			replyTo: "luca.steeb@llmgateway.io",
		});

		if (!error) {
			return { success: true, id: data?.id };
		}

		if (
			typeof error === "object" &&
			error !== null &&
			"statusCode" in error &&
			error.statusCode === 429
		) {
			const backoffMs = Math.pow(2, attempt) * 1000;
			console.log(
				`Rate limited for ${row.email}, waiting ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})`,
			);
			await sleep(backoffMs);
			continue;
		}

		return { success: false, error };
	}

	return { success: false, error: "Max retries exceeded" };
}

async function sendEmails(jsonPath: string) {
	const content = readFileSync(jsonPath, "utf-8");
	const parsed = JSON.parse(content);

	const result = EmailsSchema.safeParse(parsed);
	if (!result.success) {
		console.error("Invalid JSON schema:", result.error.format());
		process.exit(1);
	}

	const rows = result.data;
	console.log(`Found ${rows.length} valid emails`);

	for (const row of rows) {
		const sendResult = await sendWithRetry(row);

		if (sendResult.success) {
			console.log(`Sent to ${row.email}:`, sendResult.id);
		} else {
			console.error(`Failed to send to ${row.email}:`, sendResult.error);
		}

		await sleep(600);
	}
}

void sendEmails(process.argv[2] || "emails.json");
