import { randomUUID } from "crypto";

import { db, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

interface BeaconData {
	uuid: string;
	type: string;
	timestamp: string;
	version: string;
	providers: string[];
}

/**
 * List of provider API key environment variables to track
 */
const PROVIDER_ENV_VARS = [
	"LLM_LLMGATEWAY_API_KEY",
	"LLM_OPENAI_API_KEY",
	"LLM_ANTHROPIC_API_KEY",
	"LLM_GOOGLE_AI_STUDIO_API_KEY",
	"LLM_GOOGLE_VERTEX_API_KEY",
	"LLM_INFERENCE_NET_API_KEY",
	"LLM_TOGETHER_AI_API_KEY",
	"LLM_CLOUD_RIFT_API_KEY",
	"LLM_MISTRAL_API_KEY",
	"LLM_MOONSHOT_API_KEY",
	"LLM_NOVITA_AI_API_KEY",
	"LLM_X_AI_API_KEY",
	"LLM_GROQ_API_KEY",
	"LLM_DEEPSEEK_API_KEY",
	"LLM_PERPLEXITY_API_KEY",
	"LLM_ALIBABA_API_KEY",
	"LLM_NEBIUS_API_KEY",
	"LLM_NANO_GPT_API_KEY",
	"LLM_Z_AI_API_KEY",
	"LLM_ROUTEWAY_API_KEY",
	"LLM_ROUTEWAY_DISCOUNT_API_KEY",
	"LLM_AWS_BEDROCK_API_KEY",
	"LLM_AZURE_API_KEY",
	"LLM_CANOPY_WAVE_API_KEY",
] as const;

/**
 * Detects which provider API keys are configured in the environment
 * Returns a list of provider names (without the LLM_ prefix and _API_KEY suffix)
 */
function detectConfiguredProviders(): string[] {
	const configuredProviders: string[] = [];

	for (const envVar of PROVIDER_ENV_VARS) {
		if (process.env[envVar]) {
			// Extract provider name: LLM_OPENAI_API_KEY -> openai
			const providerName = envVar
				.replace(/^LLM_/, "")
				.replace(/_API_KEY$/, "")
				.toLowerCase()
				.replace(/_/g, "-");
			configuredProviders.push(providerName);
		}
	}

	return configuredProviders;
}

/**
 * Sends installation beacon data to the tracking endpoint
 */
async function sendBeacon(data: BeaconData): Promise<void> {
	const response = await fetch("https://internal.llmgateway.io/beacon", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(data),
		// Add timeout to prevent hanging
		signal: AbortSignal.timeout(5000),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Failed to send beacon: ${response.status} ${response.statusText} - ${errorText}`,
		);
	}
}

/**
 * Retrieves installation data and sends beacon on startup
 */
export async function sendInstallationBeacon(): Promise<void> {
	// Skip beacon in CI environments
	if (process.env.CI) {
		return;
	}

	// Check if telemetry is active via environment variable
	if (process.env.TELEMETRY_ACTIVE !== "true") {
		return;
	}

	logger.info(
		"Sending installation beacon (for anonymous tracking of self-hosted installs. To disable, set TELEMETRY_ACTIVE=false in your environment variables.",
	);

	try {
		// Get or create the installation record
		let installation = await db.query.installation.findFirst({
			where: {
				type: "self-host",
			},
		});

		if (!installation) {
			// Create the installation record if it doesn't exist
			const [newInstallation] = await db
				.insert(tables.installation)
				.values({
					id: "self-hosted-installation",
					uuid: randomUUID(),
					type: "self-host",
				})
				.returning();
			installation = newInstallation;
			logger.info("Created new self-hosted installation record");
		}

		const providers = detectConfiguredProviders();

		await sendBeacon({
			uuid: installation.uuid,
			type: installation.type,
			timestamp: new Date().toISOString(),
			version: process.env.APP_VERSION || "v0.0.0-unknown",
			providers,
		});

		logger.info("Installation beacon sent successfully", {
			providersCount: providers.length,
		});
	} catch (error) {
		logger.warn("Failed to send installation beacon", {
			error: error instanceof Error ? error : new Error(String(error)),
		});
	}
}

let beaconInterval: NodeJS.Timeout | null = null;

/**
 * Starts the daily beacon schedule
 * Sends a beacon once per day (24 hours) to track active installations
 */
export function startDailyBeacon(): void {
	// Skip if telemetry is disabled or in CI
	if (process.env.CI || process.env.TELEMETRY_ACTIVE !== "true") {
		return;
	}

	// Clear any existing interval
	if (beaconInterval) {
		clearInterval(beaconInterval);
	}

	// Send beacon every 24 hours (86400000 ms)
	const DAILY_INTERVAL = 24 * 60 * 60 * 1000;

	beaconInterval = setInterval(() => {
		logger.info("Sending daily installation beacon");
		void sendInstallationBeacon();
	}, DAILY_INTERVAL);

	logger.info("Daily beacon schedule started (runs every 24 hours)");
}

/**
 * Stops the daily beacon schedule
 */
export function stopDailyBeacon(): void {
	if (beaconInterval) {
		clearInterval(beaconInterval);
		beaconInterval = null;
		logger.info("Daily beacon schedule stopped");
	}
}
