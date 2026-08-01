#!/usr/bin/env node
// Ramped load test for api.llmgateway.io
// Linearly warms up from 1 r/s to `RATE` r/s over `WARMUP_SEC`, then holds
// `RATE` r/s for `DURATION_SEC`. Useful for testing cold-start / autoscaling
// behaviour where a sudden flat spike would behave differently than a ramp.

const API_URL =
	process.env.API_URL || "https://api.llmgateway.io/v1/chat/completions";
const API_KEY = process.env.LLMGATEWAY_API_KEY;
const MODEL = process.env.MODEL || "deepseek-v4-flash";

if (!API_KEY) {
	console.error("Missing LLMGATEWAY_API_KEY environment variable");
	process.exit(1);
}

const RATE = Number(process.env.RATE) || 100; // target (peak) requests per second
const DURATION_SEC = Number(process.env.DURATION_SEC) || 60; // hold time at peak
const WARMUP_SEC = Number(process.env.WARMUP_SEC) || 60; // linear ramp duration

const payload = {
	model: MODEL,
	messages: [{ role: "user", content: "Reply with a short response: ping" }],
};

let sent = 0;
let ok = 0;
let failed = 0;
// steady-phase-only counters, so throughput reflects sustained peak, not the ramp
let sentSteady = 0;
let okSteady = 0;
const latencies = []; // successful requests only (steady phase)
const errors = new Map(); // category -> { count, sampleMsg }
const SAMPLES_PER_CATEGORY = 3; // live-log at most this many of each error category

function recordError(category, id, ms, msg) {
	failed++;
	let e = errors.get(category);
	if (!e) {
		e = { count: 0, sampleMsg: msg };
		errors.set(category, e);
	}
	e.count++;
	if (e.count <= SAMPLES_PER_CATEGORY) {
		const t = ms != null ? ` ${ms.toFixed(0)}ms` : "";
		console.error(`[${id}]${t} ${category}: ${msg}`);
	} else if (e.count === SAMPLES_PER_CATEGORY + 1) {
		console.error(
			`[…] further "${category}" errors suppressed (counted in summary)`,
		);
	}
}

async function fireOne(id, steady) {
	const start = performance.now();
	try {
		const res = await fetch(API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${API_KEY}`,
			},
			body: JSON.stringify(payload),
		});
		const ms = performance.now() - start;
		if (res.ok) {
			ok++;
			if (steady) {
				okSteady++;
				latencies.push(ms);
			}
		} else {
			const body = await res.text().catch(() => "");
			recordError(
				`HTTP ${res.status}`,
				id,
				ms,
				body.replace(/\s+/g, " ").trim().slice(0, 200),
			);
		}
	} catch (err) {
		const ms = performance.now() - start;
		// node/undici nests the useful reason in err.cause
		const cause = err.cause
			? `${err.cause.code || err.cause.message || err.cause}`
			: "";
		const category = `NETWORK ${err.cause?.code || err.code || err.message}`;
		recordError(
			category,
			id,
			ms,
			[err.message, cause].filter(Boolean).join(" / "),
		);
	}
}

// Linear ramp: tick 0 fires 1 r/s, the tick at WARMUP_SEC fires RATE r/s.
function rateForTick(tick) {
	if (WARMUP_SEC <= 0 || tick >= WARMUP_SEC) {
		return RATE;
	}
	const frac = tick / WARMUP_SEC; // 0 .. <1 during warmup
	return Math.max(1, Math.round(1 + (RATE - 1) * frac));
}

console.log(
	`Ramped load test ${API_URL} (model: ${MODEL})\n` +
		`  warmup:  1 → ${RATE} r/s over ${WARMUP_SEC}s\n` +
		`  hold:    ${RATE} r/s for ${DURATION_SEC}s`,
);

const TOTAL_TICKS = WARMUP_SEC + DURATION_SEC;
const inFlight = [];
let tick = 0;

function doTick() {
	const steady = tick >= WARMUP_SEC;
	const r = rateForTick(tick);
	for (let i = 0; i < r; i++) {
		const id = ++sent;
		if (steady) {
			sentSteady++;
		}
		inFlight.push(fireOne(id, steady));
	}
	const phase = steady ? "hold " : "ramp ";
	process.stderr.write(`\r[${phase} t=${tick}s] ${r} r/s   `);
	tick++;
}

doTick(); // fire immediately at t=0
const ticker = setInterval(() => {
	if (tick >= TOTAL_TICKS) {
		clearInterval(ticker);
		void finish();
		return;
	}
	doTick();
}, 1000);

async function finish() {
	process.stderr.write("\n");
	await Promise.allSettled(inFlight);

	const sorted = [...latencies].sort((a, b) => a - b);
	const pct = (p) =>
		sorted.length
			? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
			: 0;
	const avg = latencies.length
		? latencies.reduce((a, b) => a + b, 0) / latencies.length
		: 0;
	const successRate = sent ? (ok / sent) * 100 : 0;
	const achieved = okSteady / DURATION_SEC;

	console.log("\n=== results ===");
	console.log(
		`sent (total):   ${sent}  (ramp ${WARMUP_SEC}s + hold ${DURATION_SEC}s)`,
	);
	console.log(`ok (total):     ${ok}  (${successRate.toFixed(1)}%)`);
	console.log(
		`failed (total): ${failed}  (${(100 - successRate).toFixed(1)}%)`,
	);
	console.log(`\nsteady phase (peak ${RATE} r/s):`);
	console.log(`  sent:         ${sentSteady}`);
	console.log(`  ok:           ${okSteady}`);
	console.log(`  throughput:   ${achieved.toFixed(1)} successful r/s`);

	console.log(`\nlatency (steady-phase ok only):`);
	console.log(
		`  avg ${avg.toFixed(0)}ms  |  min ${pct(0).toFixed(0)}ms  |  p50 ${pct(0.5).toFixed(0)}ms  |  p95 ${pct(0.95).toFixed(0)}ms  |  p99 ${pct(0.99).toFixed(0)}ms  |  max ${pct(1).toFixed(0)}ms`,
	);

	if (errors.size) {
		console.log(`\nerror breakdown (total):`);
		const rows = [...errors.entries()].sort((a, b) => b[1].count - a[1].count);
		for (const [category, e] of rows) {
			const share = ((e.count / failed) * 100).toFixed(1);
			console.log(
				`  ${String(e.count).padStart(6)}  ${share.padStart(5)}%  ${category}`,
			);
			if (e.sampleMsg)
				console.log(`          └─ e.g. ${e.sampleMsg.slice(0, 120)}`);
		}
	} else {
		console.log(`\nno errors 🎉`);
	}
}
