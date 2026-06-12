#!/usr/bin/env node
// Simple load test for api.llmgateway.io
// Fires `RATE` requests per second using parallel fetch() calls.

const API_URL = "https://api.llmgateway.io/v1/chat/completions";
const API_KEY = "llmgtwy_gLZGvfIDaxr1tYbzvVSbZ797IXmuglDGOaLiPexZ";
const MODEL = "deepseek-v4-flash";

const RATE = 100;          // requests per second
const DURATION_SEC = 60;   // how long to run (set to Infinity for forever)

const payload = {
  model: MODEL,
  messages: [{ role: "user", content: "Reply with a short response: ping" }],
};

let sent = 0;
let ok = 0;
let failed = 0;
const latencies = [];

async function fireOne(id) {
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
    latencies.push(ms);
    if (res.ok) {
      ok++;
    } else {
      failed++;
      const body = await res.text();
      console.error(`[${id}] HTTP ${res.status} (${ms.toFixed(0)}ms): ${body.slice(0, 200)}`);
    }
  } catch (err) {
    failed++;
    console.error(`[${id}] ERROR: ${err.message}`);
  }
}

console.log(`Load testing ${API_URL} @ ${RATE} r/s for ${DURATION_SEC}s (model: ${MODEL})`);

const inFlight = [];
function tick() {
  for (let i = 0; i < RATE; i++) {
    inFlight.push(fireOne(++sent));
  }
}
tick();                              // fire immediately at t=0
const ticker = setInterval(tick, 1000);  // then 59 more ticks over 59s

setTimeout(async () => {
  clearInterval(ticker);
  await Promise.allSettled(inFlight);

  const avg = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;

  console.log("\n--- results ---");
  console.log(`sent:   ${sent}`);
  console.log(`ok:     ${ok}`);
  console.log(`failed: ${failed}`);
  console.log(`avg latency: ${avg.toFixed(0)}ms`);
  console.log(`p95 latency: ${p95.toFixed(0)}ms`);
}, DURATION_SEC * 1000);
