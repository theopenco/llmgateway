"use server";

import { headers } from "next/headers";
import { Resend } from "resend";
import { z } from "zod";

const contactFormSchema = z.object({
	name: z.string().min(2, "Name must be at least 2 characters"),
	email: z.string().email("Invalid email address"),
	country: z.string().min(1, "Please select a country"),
	size: z.string().min(1, "Please select company size"),
	message: z.string().min(10, "Message must be at least 10 characters"),
	// Anti-spam fields
	honeypot: z.string().optional(), // Should be empty
	timestamp: z.number().optional(), // Form load timestamp
});

export type ContactFormData = z.infer<typeof contactFormSchema>;

const submissionTracker = new Map<
	string,
	{ count: number; firstSubmission: number }
>();

// Cleanup old entries every hour
setInterval(
	() => {
		const now = Date.now();
		const oneHour = 60 * 60 * 1000;
		for (const [key, value] of Array.from(submissionTracker.entries())) {
			if (now - value.firstSubmission > oneHour) {
				submissionTracker.delete(key);
			}
		}
	},
	60 * 60 * 1000,
);

const disposableEmailDomains = [
	"tempmail.com",
	"10minutemail.com",
	"guerrillamail.com",
	"mailinator.com",
	"throwaway.email",
	"temp-mail.org",
	"getairmail.com",
	"trashmail.com",
	"yopmail.com",
];

const spamKeywords = [
	"casino",
	"viagra",
	"cialis",
	"lottery",
	"bitcoin",
	"cryptocurrency",
	"investment opportunity",
	"click here",
	"buy now",
	"limited time",
];

function checkForSpam(text: string): boolean {
	const lowerText = text.toLowerCase();
	return spamKeywords.some((keyword) => lowerText.includes(keyword));
}

function isDisposableEmail(email: string): boolean {
	const domain = email.split("@")[1]?.toLowerCase();
	return disposableEmailDomains.some((disposable) => domain === disposable);
}

async function checkRateLimit(identifier: string): Promise<boolean> {
	const now = Date.now();
	const limit = 3; // Max 3 submissions per hour
	const window = 60 * 60 * 1000; // 1 hour in milliseconds

	const tracker = submissionTracker.get(identifier);

	if (!tracker) {
		submissionTracker.set(identifier, { count: 1, firstSubmission: now });
		return true;
	}

	// Reset if outside the window
	if (now - tracker.firstSubmission > window) {
		submissionTracker.set(identifier, { count: 1, firstSubmission: now });
		return true;
	}

	// Check if limit exceeded
	if (tracker.count >= limit) {
		return false;
	}

	// Increment count
	tracker.count++;
	return true;
}

export async function sendContactEmail(data: ContactFormData) {
	// Validate the data
	const parseResult = contactFormSchema.safeParse(data);
	if (!parseResult.success) {
		return {
			success: false,
			message: "Invalid form data",
			errors: parseResult.error.flatten().fieldErrors,
		};
	}

	const validatedData = parseResult.data;

	// Anti-spam check 1: Honeypot field (should be empty)
	if (validatedData.honeypot && validatedData.honeypot.trim() !== "") {
		return {
			success: false,
			message: "Invalid submission",
		};
	}

	// Anti-spam check 2: Time-based validation (form should take at least 3 seconds)
	if (validatedData.timestamp) {
		const submissionTime = Date.now();
		const timeTaken = submissionTime - validatedData.timestamp;
		const minTime = 3000; // 3 seconds

		if (timeTaken < minTime) {
			return {
				success: false,
				message: "Please take your time filling out the form",
			};
		}
	}

	// Anti-spam check 3: Rate limiting by IP
	const headersList = await headers();
	const forwardedFor = headersList.get("x-forwarded-for");
	const ip = forwardedFor
		? forwardedFor.split(",")[0]
		: (headersList.get("x-real-ip") ?? "unknown");

	const canSubmit = await checkRateLimit(ip);
	if (!canSubmit) {
		return {
			success: false,
			message: "Too many submissions. Please try again later (max 3 per hour)",
		};
	}

	// Anti-spam check 4: Disposable email check
	if (isDisposableEmail(validatedData.email)) {
		return {
			success: false,
			message: "Please use a valid company email address",
		};
	}

	// Anti-spam check 5: Content spam detection
	const contentToCheck = `${validatedData.name} ${validatedData.message}`;
	if (checkForSpam(contentToCheck)) {
		return {
			success: false,
			message: "Your message contains prohibited content",
		};
	}

	const resendApiKey = process.env.RESEND_API_KEY;
	if (!resendApiKey) {
		return {
			success: false,
			message: "Email service is not configured. Please try again later.",
		};
	}

	// Prepare email content
	const htmlContent = `
		<html>
			<head>
				<style>
					body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
					.container { max-width: 600px; margin: 0 auto; padding: 20px; }
					.header { background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
					.field { margin-bottom: 15px; }
					.label { font-weight: bold; color: #555; }
					.value { color: #333; margin-top: 5px; }
				</style>
			</head>
			<body>
				<div class="container">
					<div class="header">
						<h2 style="margin: 0; color: #2563eb;">New Enterprise Contact Request</h2>
					</div>

					<div class="field">
						<div class="label">Name:</div>
						<div class="value">${validatedData.name}</div>
					</div>

					<div class="field">
						<div class="label">Email:</div>
						<div class="value">${validatedData.email}</div>
					</div>

					<div class="field">
						<div class="label">Country:</div>
						<div class="value">${validatedData.country}</div>
					</div>

					<div class="field">
						<div class="label">Company Size:</div>
						<div class="value">${validatedData.size}</div>
					</div>

					<div class="field">
						<div class="label">Message:</div>
						<div class="value" style="white-space: pre-wrap;">${validatedData.message}</div>
					</div>
				</div>
			</body>
		</html>
	`;

	// Send email via Resend
	const resend = new Resend(resendApiKey);

	const { error } = await resend.emails.send({
		from: "LLMGateway Contact Form <contact@mail.llmgateway.io>",
		to: ["contact@llmgateway.io"],
		replyTo: validatedData.email,
		subject: `Enterprise Contact Request from ${validatedData.name}`,
		html: htmlContent,
	});

	if (error) {
		return {
			success: false,
			message: "Failed to send email. Please try again later.",
		};
	}

	return { success: true, message: "Email sent successfully" };
}
