import { randomUUID } from "crypto";

import { db, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

interface BeaconData {
	uuid: string;
	type: string;
	timestamp: string;
	version: string;
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

		await sendBeacon({
			uuid: installation.uuid,
			type: installation.type,
			timestamp: new Date().toISOString(),
			version: process.env.APP_VERSION || "v0.0.0-unknown",
		});

		logger.info("Installation beacon sent successfully");
	} catch (error) {
		logger.warn("Failed to send installation beacon", {
			error: error instanceof Error ? error : new Error(String(error)),
		});
	}
}
