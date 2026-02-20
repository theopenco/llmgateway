/* eslint-disable no-console */
import { readFileSync, writeFileSync, existsSync } from "fs";

import initSqlJs, { type Database } from "sql.js";

const DB_PATH = "api-responses.db";
const API_URL = "https://api.llmgateway.io";
const INTERVAL_MS = 1000;

let db: Database;

async function initDb(): Promise<void> {
	const SQL = await initSqlJs();

	if (existsSync(DB_PATH)) {
		const buffer = readFileSync(DB_PATH);
		db = new SQL.Database(buffer);
	} else {
		db = new SQL.Database();
	}

	db.run(`
		CREATE TABLE IF NOT EXISTS responses (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp TEXT NOT NULL,
			status_code INTEGER NOT NULL,
			duration_ms REAL NOT NULL,
			response_payload TEXT NOT NULL
		)
	`);
	saveDb();
}

function saveDb(): void {
	const data = db.export();
	const buffer = Buffer.from(data);
	writeFileSync(DB_PATH, buffer);
}

async function pingApi(): Promise<void> {
	const timestamp = new Date().toISOString();
	const start = performance.now();

	try {
		const response = await fetch(API_URL);
		const duration = performance.now() - start;
		const payload = await response.text();

		db.run(
			"INSERT INTO responses (timestamp, status_code, duration_ms, response_payload) VALUES (?, ?, ?, ?)",
			[timestamp, response.status, duration, payload]
		);
		saveDb();
		console.log(
			`[${timestamp}] Status: ${response.status}, Duration: ${duration.toFixed(2)}ms`
		);
	} catch (error) {
		const duration = performance.now() - start;
		const errorMessage =
			error instanceof Error ? error.message : String(error);

		db.run(
			"INSERT INTO responses (timestamp, status_code, duration_ms, response_payload) VALUES (?, ?, ?, ?)",
			[timestamp, 0, duration, JSON.stringify({ error: errorMessage })]
		);
		saveDb();
		console.log(
			`[${timestamp}] Error: ${errorMessage}, Duration: ${duration.toFixed(2)}ms`
		);
	}
}

async function main(): Promise<void> {
	await initDb();

	console.log(`Starting API ping to ${API_URL} every ${INTERVAL_MS}ms`);
	console.log(`Saving responses to ${DB_PATH}`);
	console.log("Press Ctrl+C to stop\n");

	await pingApi();
	setInterval(pingApi, INTERVAL_MS);
}

void main();
