import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, it } from "vitest";

const runNode = promisify(execFile);

it("cancels native guarded HTTPS under GC, including late public DNS", async () => {
	const helper = fileURLToPath(
		new URL("../dist/process-image-url.js", import.meta.url),
	);
	const script = `
		import assert from "node:assert/strict";
		import { execFileSync } from "node:child_process";
		import dns from "node:dns";
		import dnsPromises from "node:dns/promises";
		import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
		import { createServer } from "node:https";
		import { syncBuiltinESMExports } from "node:module";
		import { resolve } from "node:path";
		import tls from "node:tls";
		import { setTimeout as delay } from "node:timers/promises";
		mkdirSync(".context", { recursive: true });
		const dir = mkdtempSync(resolve(".context/native-image-tls-"));
		const key = resolve(dir, "key.pem"), certPath = resolve(dir, "cert.pem");
		execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", certPath, "-days", "1", "-subj", "/CN=image-deadline.example.com", "-addext", "subjectAltName=DNS:image-deadline.example.com"], { stdio: "ignore" });
		const cert = readFileSync(certPath);
		const publicAddress = { address: "8.8.8.8", family: 4 };
		let pending, requests = 0, phase = "body", socketLookups = 0, acceptedLookups = 0;
		let socketAnswers = [publicAddress];
		const closures = [];
		dnsPromises.lookup = async () => [publicAddress];
		const lookup = dns.lookup;
		dns.lookup = (_hostname, options, callback) => {
			if (_hostname === "127.0.0.1") return lookup(_hostname, options, callback);
			socketLookups++;
			const complete = () => callback(null, options.all ? socketAnswers : socketAnswers[0].address, socketAnswers[0].family);
			if (phase === "dns") pending = complete;
			else complete();
		};
		// Route accepted public DNS to a local TLS fixture only below the guard.
		// The production Agent, lookup policy, TLS verification and body remain real.
		const connect = tls.connect;
		tls.connect = (options, callback) => connect({
			...options, ca: cert,
			lookup(host, optionsForLookup, done) {
				options.lookup(host, optionsForLookup, (error, address, family) => {
					if (error) return done(error, address, family);
					acceptedLookups++;
					done(null, optionsForLookup.all ? [{ address: "127.0.0.1", family: 4 }] : "127.0.0.1", 4);
				});
			},
		}, callback);
		syncBuiltinESMExports();
		process.env.ALLOW_INSECURE_PROVIDER_URLS = "false";
		process.env.IMAGE_FETCH_TIMEOUT_MS = "250";
		assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "0");
		const { processImageUrl } = await import(${JSON.stringify(helper)});
		const server = createServer({ key: readFileSync(key), cert }, (_request, response) => {
			requests++;
			closures.push(new Promise(resolve => response.once("close", resolve)));
			if (phase === "headers") return;
			if (phase === "redirect") { response.writeHead(302, { location: "https://127.0.0.1/private" }); response.end(); return; }
			response.writeHead(200, { "content-type": "image/png" });
			response.write(new Uint8Array([1]));
			if (phase === "trickle") {
				const timer = setInterval(() => response.write(new Uint8Array([1])), 10);
				response.once("close", () => clearInterval(timer));
			}
		});
		await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
		const url = "https://image-deadline.example.com:" + server.address().port + "/image.png";
		const gc = setInterval(() => global.gc(), 20);
		const watchdog = setTimeout(() => { server.closeAllConnections(); process.exitCode = 2; }, 15000);
		try {
			for (socketAnswers of [[{ address: "127.0.0.1", family: 4 }], [publicAddress, { address: "10.0.0.1", family: 4 }], [{ address: "::ffff:127.0.0.1", family: 6 }]]) {
				const error = await processImageUrl(url).catch(error => error);
				assert.equal(error.statusCode, 400);
				assert.equal(error.message, "Image URL is invalid or points to a disallowed host");
				assert.equal(acceptedLookups, 0, "Policy rejection must precede fixture routing");
				assert.equal(requests, 0);
			}
			socketAnswers = [publicAddress];
			for (const signal of [undefined, new AbortController().signal]) {
				for (phase of ["headers", "body", "trickle"]) {
					const error = await processImageUrl(url, false, 20, null, signal).catch(error => error);
					assert.equal(error.statusCode, 400);
					assert.equal(error.message, "Timed out fetching image from URL");
					await closures.at(-1);
				}
			}
			assert.equal(requests, 6);
			phase = "redirect";
			const redirect = await processImageUrl(url).catch(error => error);
			assert.equal(redirect.statusCode, 400);
			assert.match(redirect.message, /redirect/i);
			assert.equal(requests, 7);
			server.closeAllConnections();
			await delay(20);
			for (const reason of [undefined, new DOMException("caller deadline", "TimeoutError"), { reason: "caller" }, "caller"]) {
				phase = "dns";
				const caller = new AbortController();
				let rejected = false;
				const result = processImageUrl(url, false, 20, null, caller.signal).catch(error => { rejected = true; return error; });
				while (!pending && !rejected) await delay(5);
				assert.ok(pending, "Expected the native guarded socket lookup");
				if (reason !== undefined) caller.abort(reason);
				const error = await result;
				if (reason === undefined) assert.equal(error.message, "Timed out fetching image from URL");
				else assert.equal(error, reason);
				pending(); pending = undefined;
				await delay(75);
				assert.equal(requests, 7, "Late public lookup must not dispatch HTTP");
				server.closeAllConnections();
			}
			assert.ok(socketLookups >= 14);
			console.log("NATIVE_REBINDING_REJECTED_BEFORE_FIXTURE_ROUTING=3 HTTP_REQUESTS=0");
			console.log("NATIVE_GUARDED_HTTPS_CLOSED=6 REDIRECT_BLOCKED=1 LATE_PUBLIC_DNS_NO_HTTP=4 TLS_VERIFIED=true");
		} finally {
			clearInterval(gc); clearTimeout(watchdog);
			server.closeAllConnections();
			await new Promise(resolve => server.close(resolve));
			rmSync(dir, { recursive: true, force: true });
		}
	`;
	const { stdout } = await runNode(
		process.execPath,
		["--expose-gc", "--input-type=module", "-e", script],
		{
			timeout: 20000,
			env: { ...process.env, LOG_PRETTY: "false" },
		},
	);
	expect(stdout).toContain(
		"NATIVE_GUARDED_HTTPS_CLOSED=6 REDIRECT_BLOCKED=1 LATE_PUBLIC_DNS_NO_HTTP=4 TLS_VERIFIED=true",
	);
}, 25000);
