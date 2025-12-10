/* eslint-disable */

import OpenAI from "openai";

const openai = new OpenAI({
	apiKey: process.env.API_KEY || "test-token",
	baseURL: "http://localhost:4001/v1",
});

// Tool functions
const getWeather = (location: string, unit: "C" | "F") => {
	const temps: Record<string, { c: number; f: number }> = {
		"San Francisco": { c: 22, f: 72 },
		"New York": { c: 15, f: 59 },
		Tokyo: { c: 18, f: 64 },
		London: { c: 12, f: 54 },
	};

	const temp = temps[location] || { c: 20, f: 68 };
	return {
		location,
		temperature: unit === "C" ? temp.c : temp.f,
		unit,
		condition: "Sunny",
	};
};

const getTime = (location: string) => {
	const times: Record<string, string> = {
		"San Francisco": "10:30 AM PST",
		"New York": "1:30 PM EST",
		Tokyo: "2:30 AM JST",
		London: "6:30 PM GMT",
	};

	return {
		location,
		currentTime: times[location] || "12:00 PM",
		timezone: location,
	};
};

const searchRestaurants = (location: string, cuisine: string) => {
	return {
		location,
		cuisine,
		restaurants: [
			{ name: `Best ${cuisine} Place`, rating: 4.5, priceRange: "$$" },
			{ name: `${cuisine} Delight`, rating: 4.8, priceRange: "$$$" },
			{ name: `Local ${cuisine} Spot`, rating: 4.2, priceRange: "$" },
		],
	};
};

// Tool definitions
const tools: OpenAI.Chat.ChatCompletionTool[] = [
	{
		type: "function",
		function: {
			name: "getWeather",
			description: "Get the current weather for a location",
			parameters: {
				type: "object",
				properties: {
					location: {
						type: "string",
						description: "The city name",
					},
					unit: {
						type: "string",
						enum: ["C", "F"],
						description: "The temperature unit",
					},
				},
				required: ["location", "unit"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "getTime",
			description: "Get the current time for a location",
			parameters: {
				type: "object",
				properties: {
					location: {
						type: "string",
						description: "The city name",
					},
				},
				required: ["location"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "searchRestaurants",
			description: "Search for restaurants in a location by cuisine type",
			parameters: {
				type: "object",
				properties: {
					location: {
						type: "string",
						description: "The city name",
					},
					cuisine: {
						type: "string",
						description:
							"The type of cuisine (e.g., Italian, Japanese, Mexican)",
					},
				},
				required: ["location", "cuisine"],
			},
		},
	},
];

async function testToolCalls() {
	console.log(
		"Testing Gemini 3 Pro Preview with complex multi-turn tool calls...\n",
	);

	const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
		{
			role: "user",
			content:
				"I'm planning a trip to San Francisco. Can you tell me the weather in Celsius, what time it is there, and recommend some good Italian restaurants?",
		},
	];

	let iteration = 0;
	const maxIterations = 5;
	let continueLoop = true;
	const toolCallsHistory: Array<{ tool: string; args: any; result: any }> = [];

	console.log("Initial prompt:", messages[0].content);
	console.log("\n" + "=".repeat(80) + "\n");

	while (continueLoop && iteration < maxIterations) {
		iteration++;
		console.log(`### Round ${iteration} ###\n`);

		console.log("Making request to Gemini...");
		const response = await openai.chat.completions.create({
			model: "gemini-3-pro-preview",
			messages,
			tools,
		});

		const message = response.choices[0].message;

		if (message.tool_calls && message.tool_calls.length > 0) {
			console.log(`✓ Received ${message.tool_calls.length} tool call(s)\n`);

			// Add assistant message to conversation
			messages.push({
				...message,
				content: message.content || "",
			});

			// Process each tool call
			for (const toolCall of message.tool_calls as any) {
				const args = JSON.parse(toolCall.function.arguments);
				console.log(`Tool: ${toolCall.function.name}`);
				console.log(`Arguments:`, args);

				let result: any;
				switch (toolCall.function.name) {
					case "getWeather":
						result = getWeather(args.location, args.unit);
						break;
					case "getTime":
						result = getTime(args.location);
						break;
					case "searchRestaurants":
						result = searchRestaurants(args.location, args.cuisine);
						break;
					default:
						result = { error: "Unknown tool" };
				}

				console.log(`Result:`, result);
				console.log();

				toolCallsHistory.push({
					tool: toolCall.function.name,
					args,
					result,
				});

				// Add tool result to conversation
				messages.push({
					role: "tool",
					tool_call_id: toolCall.id,
					content: JSON.stringify(result),
				});
			}

			console.log("─".repeat(80) + "\n");
		} else {
			// No more tool calls, got final response
			continueLoop = false;
			console.log("✓ Final response received\n");
			console.log("=".repeat(80) + "\n");
		}
	}

	// Final results
	const finalMessage = messages[
		messages.length - 1
	] as OpenAI.Chat.ChatCompletionAssistantMessageParam;
	const finalResponse =
		typeof finalMessage.content === "string" ? finalMessage.content : "";

	console.log("### FINAL RESULTS ###\n");
	console.log("Response:", finalResponse);
	console.log();

	// Verification
	console.log("### VERIFICATION ###\n");

	if (!finalResponse || finalResponse.trim().length === 0) {
		console.error("❌ ERROR: Final response is empty!");
		throw new Error("No final response received after tool calls");
	}

	console.log(`✓ Total tool calls made: ${toolCallsHistory.length}`);
	console.log(`✓ Tools used:`);
	toolCallsHistory.forEach(({ tool, args }) => {
		console.log(`  - ${tool}(${JSON.stringify(args)})`);
	});

	console.log();

	// Check if response mentions key information
	const checks = [
		{
			name: "Weather mentioned",
			test: () =>
				finalResponse.includes("22") ||
				finalResponse.toLowerCase().includes("weather"),
		},
		{
			name: "Temperature unit mentioned",
			test: () =>
				finalResponse.includes("°C") ||
				finalResponse.toLowerCase().includes("celsius"),
		},
		{
			name: "Time mentioned",
			test: () =>
				finalResponse.includes("10:30") ||
				finalResponse.toLowerCase().includes("time"),
		},
		{
			name: "Restaurants mentioned",
			test: () =>
				finalResponse.toLowerCase().includes("restaurant") ||
				finalResponse.toLowerCase().includes("italian"),
		},
		{
			name: "Location mentioned",
			test: () => finalResponse.toLowerCase().includes("san francisco"),
		},
	];

	let passedChecks = 0;
	checks.forEach((check) => {
		const passed = check.test();
		passedChecks += passed ? 1 : 0;
		console.log(`${passed ? "✓" : "✗"} ${check.name}: ${passed}`);
	});

	console.log();

	if (passedChecks === checks.length) {
		console.log(`✅ SUCCESS: All ${checks.length} verification checks passed!`);
		console.log(
			"Multi-turn tool calling with Gemini 3 Pro Preview works correctly!",
		);
	} else {
		console.log(
			`⚠️  WARNING: Only ${passedChecks}/${checks.length} checks passed`,
		);
	}

	console.log("\n" + "=".repeat(80) + "\n");
	console.log("### FULL CONVERSATION ###\n");
	console.log(
		JSON.stringify(
			messages.map((m) => ({
				role: m.role,
				content:
					typeof m.content === "string"
						? m.content.substring(0, 100) +
							(m.content.length > 100 ? "..." : "")
						: m.content,
				tool_calls: "tool_calls" in m ? m.tool_calls?.length : undefined,
				tool_call_id: "tool_call_id" in m ? m.tool_call_id : undefined,
			})),
			null,
			2,
		),
	);
}

testToolCalls().catch(console.error);
