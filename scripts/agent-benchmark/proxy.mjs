import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { dirname } from "node:path";
import { TLSSocket } from "node:tls";

const port = Number(process.env.BENCH_PROXY_PORT ?? 0);
const runId = process.env.BENCH_RUN_ID ?? "adhoc";
const logFile = process.env.BENCH_LOG_FILE ?? `${process.cwd()}/${runId}.jsonl`;
const interceptHost = process.env.BENCH_INTERCEPT_HOST ?? "api.llmgateway.io";
const upstream = `https://${interceptHost}`;
const certFile = process.env.BENCH_CERT;
const keyFile = process.env.BENCH_KEY;
mkdirSync(dirname(logFile), { recursive: true });

const dropRequestHeaders = new Set([
	"host",
	"connection",
	"content-length",
	"accept-encoding",
	"keep-alive",
	"transfer-encoding",
]);
const dropResponseHeaders = new Set([
	"content-encoding",
	"content-length",
	"transfer-encoding",
	"connection",
	"keep-alive",
]);

function textLength(value) {
	if (
		value === undefined ||
		value === null ||
		(Array.isArray(value) && value.length === 0)
	) {
		return 0;
	}
	return typeof value === "string"
		? value.length
		: JSON.stringify(value).length;
}

function isToolResultBlock(block) {
	return (
		block?.type === "tool_result" || block?.type === "function_call_output"
	);
}

function describeMessages(messages) {
	const roles = { system: 0, user: 0, assistant: 0, tool: 0 };
	let userChars = 0;
	for (const m of messages) {
		if (m?.type === "function_call_output" || m?.role === "tool") {
			roles.tool++;
		} else if (
			m?.type === "function_call" ||
			m?.type === "reasoning" ||
			m?.role === "assistant"
		) {
			roles.assistant++;
		} else if (m?.role === "system" || m?.role === "developer") {
			roles.system++;
		} else if (m?.role === "user") {
			const blocks = Array.isArray(m.content) ? m.content : [m.content];
			const text = blocks.filter((b) => !isToolResultBlock(b));
			if (text.length < blocks.length) {
				roles.tool++;
			}
			if (text.length > 0) {
				roles.user++;
				userChars += textLength(text.length === 1 ? text[0] : text);
			}
		}
	}
	return { roles, userChars };
}

function describeRequest(body) {
	if (!body || typeof body !== "object") {
		return {};
	}
	const messages = Array.isArray(body.messages)
		? body.messages
		: Array.isArray(body.input)
			? body.input
			: [];
	const systemFromMessages = messages.filter(
		(m) => m?.role === "system" || m?.role === "developer",
	);
	return {
		model: body.model,
		stream: body.stream === true,
		messageCount: messages.length,
		...describeMessages(messages),
		toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
		toolChars: textLength(body.tools),
		systemChars:
			textLength(body.system) +
			textLength(body.instructions) +
			textLength(systemFromMessages),
		bodyChars: textLength(body),
		reasoning: body.reasoning_effort ?? body.reasoning ?? body.thinking ?? null,
	};
}

function mergeUsage(target, usage) {
	for (const [key, value] of Object.entries(usage ?? {})) {
		if (value !== null && value !== undefined) {
			target[key] = value;
		}
	}
	return target;
}

function extractUsage(text, contentType) {
	const raw = {};
	let provider;
	let format;
	const visit = (event) => {
		if (!event || typeof event !== "object") {
			return;
		}
		if (event.type === "message_start" && event.message?.usage) {
			format = "anthropic";
			mergeUsage(raw, event.message.usage);
		} else if (event.type === "message_delta" && event.usage) {
			format = "anthropic";
			mergeUsage(raw, event.usage);
		} else if (event.type === "message" && event.usage) {
			format = "anthropic";
			mergeUsage(raw, event.usage);
		} else if (
			typeof event.type === "string" &&
			event.type.startsWith("response.") &&
			event.response?.usage
		) {
			format = "responses";
			mergeUsage(raw, event.response.usage);
		} else if (event.object === "response" && event.usage) {
			format = "responses";
			mergeUsage(raw, event.usage);
		} else if (
			event.usage &&
			("prompt_tokens" in event.usage || "completion_tokens" in event.usage)
		) {
			format = "chat";
			mergeUsage(raw, event.usage);
		}
		if (event.metadata?.used_provider) {
			provider = event.metadata.used_provider;
		}
	};
	if (contentType?.includes("text/event-stream")) {
		for (const line of text.split("\n")) {
			if (!line.startsWith("data:")) {
				continue;
			}
			const payload = line.slice(5).trim();
			if (!payload || payload === "[DONE]") {
				continue;
			}
			try {
				visit(JSON.parse(payload));
			} catch {}
		}
	} else {
		try {
			visit(JSON.parse(text));
		} catch {}
	}
	return { format, provider, raw, usage: normalizeUsage(format, raw) };
}

function normalizeUsage(format, u) {
	if (!format) {
		return null;
	}
	if (format === "anthropic") {
		const uncached = u.input_tokens ?? 0;
		const cacheRead = u.cache_read_input_tokens ?? 0;
		const cacheWrite = u.cache_creation_input_tokens ?? 0;
		return {
			input: uncached + cacheRead + cacheWrite,
			cacheRead,
			cacheWrite,
			output: u.output_tokens ?? 0,
			reasoning: null,
			gatewayCost: typeof u.cost === "number" ? u.cost : null,
		};
	}
	if (format === "responses") {
		return {
			input: u.input_tokens ?? 0,
			cacheRead: u.input_tokens_details?.cached_tokens ?? 0,
			cacheWrite:
				u.input_tokens_details?.cache_write_tokens ??
				u.input_tokens_details?.cache_creation_tokens ??
				0,
			output: u.output_tokens ?? 0,
			reasoning: u.output_tokens_details?.reasoning_tokens ?? null,
			gatewayCost: typeof u.cost === "number" ? u.cost : null,
		};
	}
	const details = u.prompt_tokens_details ?? {};
	return {
		input: u.prompt_tokens ?? 0,
		cacheRead: details.cached_tokens ?? 0,
		cacheWrite:
			details.cache_write_tokens ?? details.cache_creation_tokens ?? 0,
		output: u.completion_tokens ?? 0,
		reasoning: u.completion_tokens_details?.reasoning_tokens ?? null,
		gatewayCost: typeof u.cost === "number" ? u.cost : null,
	};
}

const server = createServer(async (req, res) => {
	const started = Date.now();
	const rawUrl = req.url ?? "/";
	const path = rawUrl.startsWith("http")
		? new URL(rawUrl).pathname + new URL(rawUrl).search
		: rawUrl;
	const chunks = [];
	for await (const chunk of req) {
		chunks.push(chunk);
	}
	const requestBody = Buffer.concat(chunks);
	let parsedBody;
	try {
		parsedBody = requestBody.length
			? JSON.parse(requestBody.toString("utf8"))
			: undefined;
	} catch {}
	const headers = {};
	for (const [key, value] of Object.entries(req.headers)) {
		if (!dropRequestHeaders.has(key.toLowerCase()) && value !== undefined) {
			headers[key] = Array.isArray(value) ? value.join(", ") : value;
		}
	}
	headers["x-llmgateway-benchmark-run"] = runId;
	let status = 0;
	let responseText = "";
	let contentType = "";
	let error;
	try {
		const upstreamRes = await fetch(upstream + path, {
			method: req.method,
			headers,
			body: ["GET", "HEAD"].includes(req.method ?? "GET")
				? undefined
				: requestBody,
		});
		status = upstreamRes.status;
		contentType = upstreamRes.headers.get("content-type") ?? "";
		const outHeaders = {};
		upstreamRes.headers.forEach((value, key) => {
			if (!dropResponseHeaders.has(key.toLowerCase())) {
				outHeaders[key] = value;
			}
		});
		res.writeHead(status, outHeaders);
		const decoder = new TextDecoder();
		if (upstreamRes.body) {
			for await (const chunk of upstreamRes.body) {
				res.write(chunk);
				responseText += decoder.decode(chunk, { stream: true });
			}
		}
		responseText += decoder.decode();
		res.end();
	} catch (err) {
		error = String(err);
		if (!res.headersSent) {
			res.writeHead(502, { "content-type": "application/json" });
		}
		res.end(
			JSON.stringify({
				error: { message: "benchmark proxy upstream error", detail: error },
			}),
		);
	}
	const isModelCall = /\/(messages|chat\/completions|responses)$/.test(
		path.split("?")[0],
	);
	const extracted = isModelCall
		? extractUsage(responseText, contentType)
		: { usage: null };
	const record = {
		ts: new Date(started).toISOString(),
		runId,
		method: req.method,
		path,
		status,
		ms: Date.now() - started,
		modelCall: isModelCall,
		request: describeRequest(parsedBody),
		format: extracted.format ?? null,
		usedProvider: extracted.provider ?? null,
		usage: extracted.usage,
		rawUsage: extracted.raw ?? null,
		error: error ?? (status >= 400 ? responseText.slice(0, 2000) : undefined),
	};
	appendFileSync(logFile, JSON.stringify(record) + "\n");
});

const tlsOptions =
	certFile && keyFile
		? { cert: readFileSync(certFile), key: readFileSync(keyFile) }
		: null;

server.on("connect", (req, clientSocket, head) => {
	const [host, targetPort = "443"] = (req.url ?? "").split(":");
	if (host === interceptHost && tlsOptions) {
		clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
		if (head?.length) {
			clientSocket.unshift(head);
		}
		const tlsSocket = new TLSSocket(clientSocket, {
			isServer: true,
			...tlsOptions,
			ALPNProtocols: ["http/1.1"],
		});
		server.emit("connection", tlsSocket);
		return;
	}
	const target = connect(Number(targetPort), host, () => {
		clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
		if (head?.length) {
			target.write(head);
		}
		target.pipe(clientSocket);
		clientSocket.pipe(target);
	});
	target.on("error", () => clientSocket.destroy());
	clientSocket.on("error", () => target.destroy());
});

server.listen(port, "127.0.0.1", () => {
	const address = server.address();
	console.log(
		JSON.stringify({
			port: typeof address === "object" && address ? address.port : port,
			runId,
			logFile,
		}),
	);
});
