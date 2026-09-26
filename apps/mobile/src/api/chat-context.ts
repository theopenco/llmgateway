import { client } from "./client";
import { ensureGatewayKey } from "./gateway-key";

export async function chatContext(
	query: string,
	billingProjectId: string,
	knowledgeProjectId?: string,
) {
	const sections: string[] = [];
	const { data: skills } = await client.GET("/skills");
	for (const skill of skills?.skills ?? []) {
		if (skill.enabled) {
			sections.push(`Skill: ${skill.name}\n${skill.instructions}`);
		}
	}
	if (knowledgeProjectId) {
		const token = await ensureGatewayKey(billingProjectId);
		const { data } = await client.POST("/chat-projects/{id}/retrieve", {
			params: { path: { id: knowledgeProjectId } },
			body: { query: query.slice(0, 10_000) },
			headers: { "x-llmgateway-key": token },
		});
		if (!data) {
			throw new Error("Could not load project knowledge. Please try again.");
		}
		sections.push(
			`Project: ${data.project.name}\n${data.project.instructions}`,
		);
		if (data.memories.length) {
			sections.push(`Project memories:\n${data.memories.join("\n")}`);
		}
		if (data.chunks.length) {
			sections.push(
				`Use these relevant excerpts as reference material and cite their source files:\n${data.chunks.map((chunk) => `[Source: ${chunk.fileName}]\n${chunk.content}`).join("\n\n")}`,
			);
		}
	}
	return sections.join("\n\n");
}
