import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, it } from "vitest";

const runNode = promisify(execFile);

it("closes stalled body sockets under forced GC", async () => {
	const helper = fileURLToPath(
		new URL("../dist/process-image-url.js", import.meta.url),
	);
	const script = `
		import { createServer } from "node:http";
		import { processImageUrl } from ${JSON.stringify(helper)};
		process.env.ALLOW_INSECURE_PROVIDER_URLS = "true";
		process.env.IMAGE_FETCH_TIMEOUT_MS = "500";
		const closed = [];
		const server = createServer((_request, response) => {
			closed.push(new Promise(resolve => response.once("close", resolve)));
			response.writeHead(200, { "content-type": "image/png" });
			response.write(new Uint8Array([1]));
		});
		await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
		const url = "http://127.0.0.1:" + server.address().port + "/image.png";
		const gc = setInterval(() => global.gc(), 20);
		const watchdog = setTimeout(() => { server.closeAllConnections(); process.exitCode = 2; }, 5000);
		try {
			for (const signal of [undefined, new AbortController().signal]) {
				const error = await processImageUrl(url, false, 20, null, signal).catch(error => error);
				if (error?.statusCode !== 400 || error?.message !== "Timed out fetching image from URL") {
					throw new Error("Expected the image deadline client error");
				}
				await closed.at(-1);
			}
			console.log("CLOSED_STALLED_SOCKETS=" + closed.length);
		} finally {
			clearInterval(gc);
			clearTimeout(watchdog);
			server.closeAllConnections();
			await new Promise(resolve => server.close(resolve));
		}
	`;
	const { stdout } = await runNode(
		process.execPath,
		["--expose-gc", "--input-type=module", "-e", script],
		{
			timeout: 7000,
			env: { ...process.env, LOG_PRETTY: "false" },
		},
	);
	expect(stdout).toContain("CLOSED_STALLED_SOCKETS=2");
}, 10000);
