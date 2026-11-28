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

import { isEmailSuppressed } from "@llmgateway/db";

import { sendMarketingEmail, sleep } from "./marketing-email.js";

const resend = new Resend(process.env.RESEND_API_KEY);

const EmailRowSchema = z.object({
	email: z.string().email(),
	first_name: z.string(),
	last_name: z.string(),
	email_subject: z.string().min(1),
	email_content: z.string().min(1),
});

const EmailsSchema = z.array(EmailRowSchema);

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
		if (await isEmailSuppressed(row.email, "marketing")) {
			console.log(`Skipped ${row.email}: unsubscribed from marketing`);
			continue;
		}

		const sendResult = await sendMarketingEmail(resend, {
			to: row.email,
			subject: row.email_subject,
			text: row.email_content,
		});

		if (sendResult.success) {
			console.log(`Sent to ${row.email}:`, sendResult.id);
		} else {
			console.error(`Failed to send to ${row.email}:`, sendResult.error);
		}

		await sleep(600);
	}
}

void sendEmails(process.argv[2] || "emails.json");
