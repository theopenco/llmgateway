export interface InferencePath {
	path: string;
	body?: Record<string, unknown>;
	multipart?: () => FormData;
}

function transcriptionBody() {
	const audio = Buffer.alloc(364);
	audio.write("RIFF", 0);
	audio.writeUInt32LE(356, 4);
	audio.write("WAVEfmt ", 8);
	audio.writeUInt32LE(16, 16);
	audio.writeUInt16LE(1, 20);
	audio.writeUInt16LE(1, 22);
	audio.writeUInt32LE(16000, 24);
	audio.writeUInt32LE(32000, 28);
	audio.writeUInt16LE(2, 32);
	audio.writeUInt16LE(16, 34);
	audio.write("data", 36);
	audio.writeUInt32LE(320, 40);
	const form = new FormData();
	form.set("model", "grok-stt-1-0");
	form.set("file", new Blob([audio], { type: "audio/wav" }), "fixture.wav");
	return form;
}

function imageEditBody() {
	const form = new FormData();
	form.set("model", "gpt-image-2");
	form.set("prompt", "A security fixture");
	form.set(
		"image",
		new Blob(
			[
				Buffer.from(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJXcAAAAASUVORK5CYII=",
					"base64",
				),
			],
			{ type: "image/png" },
		),
		"fixture.png",
	);
	return form;
}

export const inferencePaths: InferencePath[] = [
	{
		path: "/v1/chat/completions",
		body: {
			model: "gpt-4o-mini",
			messages: [{ role: "user", content: "Security fixture" }],
		},
	},
	{
		path: "/v1/responses",
		body: { model: "gpt-4o-mini", input: "Security fixture", store: false },
	},
	{
		path: "/v1/responses/compact",
		body: {
			model: "gpt-4o-mini",
			input: [
				{
					role: "user",
					content: [{ type: "input_text", text: "Security fixture" }],
				},
			],
		},
	},
	{
		path: "/v1/messages",
		body: {
			model: "gpt-4o-mini",
			max_tokens: 10,
			messages: [{ role: "user", content: "Security fixture" }],
		},
	},
	{
		path: "/v1/embeddings",
		body: { model: "text-embedding-3-small", input: "Security fixture" },
	},
	{
		path: "/v1/moderations",
		body: { model: "omni-moderation-latest", input: "Security fixture" },
	},
	{
		path: "/v1/ocr",
		body: {
			model: "mistral-ocr-latest",
			document: {
				type: "image_url",
				image_url: "https://example.com/fixture.png",
			},
		},
	},
	{
		path: "/v1/rerank",
		body: {
			model: "qwen3-reranker-0.6b",
			query: "Security fixture",
			documents: ["Fixture"],
		},
	},
	{
		path: "/v1/search",
		body: { model: "perplexity-search", query: "Security fixture" },
	},
	{
		path: "/v1/images/generations",
		body: { model: "gpt-image-2", prompt: "Security fixture" },
	},
	{ path: "/v1/images/edits", multipart: imageEditBody },
	{
		path: "/v1/audio/speech",
		body: {
			model: "gemini-2.5-flash-preview-tts",
			input: "Security fixture",
			voice: "Kore",
		},
	},
	{ path: "/v1/audio/transcriptions", multipart: transcriptionBody },
	{
		path: "/v1/decisions",
		body: {
			model: "jev-1.13.0",
			input: "Security fixture",
			questions: [
				{ type: "predicate", name: "approved", instructions: "Approve?" },
			],
		},
	},
	{
		path: "/v1/systemone",
		body: {
			model: "jev-1.13.0",
			state: "Security fixture",
			questions: { approved: { type: "noul", instructions: "Approve?" } },
		},
	},
	{
		path: "/v1/realtime/client_secrets",
		body: { session: { type: "realtime", model: "gpt-realtime-mini" } },
	},
	{
		path: "/v1/videos",
		body: {
			model: "atlascloud/kling-v3-0",
			prompt: "Security fixture",
			size: "1280x720",
			seconds: 5,
		},
	},
	...[1, 2, 3, 4].map((version) => ({
		path: `/v${version}/ai/language-model`,
		body: {
			modelId: "gpt-4o-mini",
			prompt: [
				{ role: "user", content: [{ type: "text", text: "Security fixture" }] },
			],
		},
	})),
];
