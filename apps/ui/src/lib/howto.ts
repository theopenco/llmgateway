import { plainTextFromMarkdown } from "@/lib/utils/plain-text";

export interface HowToStep {
	name: string;
	text: string;
}

const STEP_HEADING = /^### \d+\. (.+)$/;

/**
 * Reads numbered `### 1. Title` headings from a guide and pairs each with
 * the first paragraph under it, for HowTo structured data.
 */
export function extractHowToSteps(markdown: string): HowToStep[] {
	const steps: HowToStep[] = [];
	const lines = markdown.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const heading = lines[i].match(STEP_HEADING);
		if (!heading) {
			continue;
		}
		const paragraph: string[] = [];
		let inCode = false;
		for (let j = i + 1; j < lines.length; j++) {
			const line = lines[j];
			if (line.startsWith("```")) {
				inCode = !inCode;
				if (paragraph.length > 0) {
					break;
				}
				continue;
			}
			if (inCode) {
				continue;
			}
			if (line.startsWith("#")) {
				break;
			}
			if (line.trim() === "") {
				if (paragraph.length > 0) {
					break;
				}
				continue;
			}
			paragraph.push(line.trim());
		}
		const name = heading[1].trim();
		steps.push({
			name,
			text: plainTextFromMarkdown(paragraph.join(" ")) || name,
		});
	}
	return steps;
}

export function buildHowToSchema(options: {
	name: string;
	description: string;
	url: string;
	steps: HowToStep[];
}) {
	return {
		"@context": "https://schema.org",
		"@type": "HowTo",
		name: options.name,
		description: options.description,
		url: options.url,
		step: options.steps.map((step, index) => ({
			"@type": "HowToStep",
			position: index + 1,
			name: step.name,
			text: step.text,
		})),
	};
}
