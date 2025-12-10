/* eslint-disable */

import OpenAI from "openai";

const openai = new OpenAI({
	apiKey: process.env.API_KEY || "test-token",
	baseURL: "http://localhost:4001/v1",
});

const getWeatherTool = {
	type: "function" as const,
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
};

const getWeather = (location: string, unit: "C" | "F") => {
	return {
		location,
		temperature: unit === "C" ? 22 : 72,
		unit,
		condition: "Sunny",
	};
};

async function testToolCalls() {
	console.log(
		"Testing Gemini 3 Pro Preview via local gateway with tool calls...\n",
	);

	const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
		{
			role: "user",
			content: "What's the weather in San Francisco in Celsius?",
		},
	];

	console.log("Making initial request...");
	let response = await openai.chat.completions.create({
		model: "gemini-3-pro-preview",
		messages,
		tools: [getWeatherTool],
	});

	console.log("Response received!");

	let continueLoop = true;
	let iterations = 0;
	const maxIterations = 5;

	while (continueLoop && iterations < maxIterations) {
		iterations++;
		const message = response.choices[0].message;

		if (message.tool_calls && message.tool_calls.length > 0) {
			console.log(`\n=== Iteration ${iterations}: Tool Calls Detected ===`);

			messages.push({
				...message,
				content: message.content || "",
			});

			for (const toolCall of message.tool_calls as any) {
				console.log(`Tool: ${toolCall.function.name}`);
				console.log(`Arguments: ${toolCall.function.arguments}`);

				const args = JSON.parse(toolCall.function.arguments);
				const result = getWeather(args.location, args.unit);

				console.log(`Result:`, result);

				messages.push({
					role: "tool",
					tool_call_id: toolCall.id,
					content: JSON.stringify(result),
				});
			}

			console.log("\nMaking follow-up request with tool results...");
			response = await openai.chat.completions.create({
				model: "gemini-3-pro-preview",
				messages,
				tools: [getWeatherTool],
			});
		} else {
			continueLoop = false;
		}
	}

	console.log("\n=== Final Results ===");
	const finalResponse = response.choices[0].message.content;
	console.log("Final response:", finalResponse);

	// Verify the response is valid
	if (!finalResponse || finalResponse.trim().length === 0) {
		console.error("\n❌ ERROR: Final response is empty!");
		throw new Error("No final response received after tool call");
	}

	// Check if the response includes the expected information
	const hasTemperature = finalResponse.includes("22");
	const hasCelsius =
		finalResponse.toLowerCase().includes("celsius") ||
		finalResponse.includes("°C") ||
		finalResponse.includes("C");
	const hasSanFrancisco = finalResponse.toLowerCase().includes("san francisco");

	console.log("\n=== Verification ===");
	console.log("✓ Has final response:", !!finalResponse);
	console.log("✓ Includes temperature (22):", hasTemperature);
	console.log("✓ Includes unit (Celsius):", hasCelsius);
	console.log("✓ Includes location (San Francisco):", hasSanFrancisco);

	if (hasTemperature && hasCelsius && hasSanFrancisco) {
		console.log(
			"\n✅ SUCCESS: Tool call completed and final response is valid!",
		);
	} else {
		console.log("\n⚠️  WARNING: Final response may be incomplete or incorrect");
	}

	console.log("\n=== Full Conversation ===");
	console.log(JSON.stringify(messages, null, 2));
}

testToolCalls().catch(console.error);
