/* eslint-disable no-console */
import { writeFileSync, appendFileSync, existsSync, unlinkSync } from "fs";

import { models } from "@llmgateway/models";

const GATEWAY_URL = "http://localhost:4001/v1/chat/completions";
const AUTH_TOKEN = "test-token";
const PERPLEXITY_MODEL = "sonar";

const SUCCESS_FILE = "success.csv";
const FAILED_FILE = "failed.csv";

interface ReleaseDateResponse {
	date: string | null;
	reason?: string;
}

interface ChatResponse {
	choices: Array<{
		message: {
			content: string;
		};
	}>;
}

const responseSchema = {
	type: "json_schema",
	json_schema: {
		name: "release_date_response",
		strict: true,
		schema: {
			type: "object",
			properties: {
				date: {
					type: ["string", "null"],
					description: "Release date in YYYY-MM-DD format, or null if unknown",
				},
				reason: {
					type: ["string", "null"],
					description: "Explanation if date could not be determined",
				},
			},
			required: ["date"],
			additionalProperties: false,
		},
	},
};

function initFiles(): void {
	if (existsSync(SUCCESS_FILE)) {unlinkSync(SUCCESS_FILE);}
	if (existsSync(FAILED_FILE)) {unlinkSync(FAILED_FILE);}

	writeFileSync(SUCCESS_FILE, "id,date\n");
	writeFileSync(FAILED_FILE, "id,error\n");
}

function logSuccess(id: string, date: string): void {
	appendFileSync(SUCCESS_FILE, `${id},${date}\n`);
	console.log(`✓ ${id}: ${date}`);
}

function logFailure(id: string, error: string): void {
	const sanitizedError = error.replace(/"/g, '""').replace(/\n/g, " ");
	appendFileSync(FAILED_FILE, `"${id}","${sanitizedError}"\n`);
	console.log(`✗ ${id}: ${error}`);
}

async function queryReleaseDate(modelId: string): Promise<ReleaseDateResponse> {
	const response = await fetch(GATEWAY_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${AUTH_TOKEN}`,
		},
		body: JSON.stringify({
			model: PERPLEXITY_MODEL,
			messages: [
				{
					role: "user",
					content: `What is the release date of the AI model "${modelId}"?

If you cannot find the exact date, use the first day of the month or year if only month/year is known.
If you cannot determine the date at all, set date to null and provide a reason.`,
				},
			],
			response_format: responseSchema,
			max_tokens: 150,
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`HTTP ${response.status}: ${text}`);
	}

	const data = (await response.json()) as ChatResponse;
	const content = data.choices[0]?.message?.content;

	if (!content) {
		throw new Error("No content in response");
	}

	return JSON.parse(content) as ReleaseDateResponse;
}

function validateDate(dateStr: string): Date {
	const date = new Date(dateStr);
	if (isNaN(date.getTime())) {
		throw new Error(`Invalid date format: ${dateStr}`);
	}

	const cutoff = new Date("2022-01-01");
	if (date < cutoff) {
		throw new Error(`Date ${dateStr} is before 2022`);
	}

	return date;
}

async function sleep(ms: number): Promise<void> {
	return await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
	initFiles();

	const modelIds = models.map((m) => m.id);
	console.log(`Processing ${modelIds.length} models...\n`);

	let successCount = 0;
	let failCount = 0;

	for (const modelId of modelIds) {
		try {
			const parsed = await queryReleaseDate(modelId);

			if (!parsed.date) {
				throw new Error(parsed.reason ?? "Date not found");
			}

			const date = validateDate(parsed.date);
			const isoDate = date.toISOString().split("T")[0]!;
			logSuccess(modelId, isoDate);
			successCount++;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logFailure(modelId, message);
			failCount++;
		}

		await sleep(1000);
	}

	console.log(`\nDone! Success: ${successCount}, Failed: ${failCount}`);
	console.log(`Results saved to ${SUCCESS_FILE} and ${FAILED_FILE}`);
}

void main();
