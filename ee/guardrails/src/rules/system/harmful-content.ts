/**
 * Harmful-content categories scored by the classifier, one yes/no question
 * each. Ids match the OpenAI moderation categories.
 */
export const harmfulContentQuestions: Record<string, string> = {
	harassment:
		"Language that insults, demeans, threatens, or encourages harassment of a person or group.",
	hate: "Attacks or promotes hatred of people based on race, gender, ethnicity, religion, nationality, sexual orientation, disability, or caste. Mere discussion or condemnation of hate does not qualify.",
	illicit:
		"Requests, gives, or encourages actionable advice for committing illegal acts, including obtaining weapons. Prevention, refusal, and non-actionable discussion do not qualify.",
	"self-harm":
		"Promotes, encourages, gives instructions for, or expresses intent of self-injury, suicide, or eating-disorder behavior. Prevention and recovery support do not qualify.",
	sexual:
		"Content intended for sexual arousal, including requests for explicit sexual descriptions. Sex education and health information do not qualify.",
	"sexual/minors":
		"Sexual content involving a person under 18. Nonsexual references to children do not qualify.",
	violence:
		"Depicts, threatens, or promotes physical violence, death, or injury in graphic or encouraging terms. Computing terminology, news reporting and harmless figurative phrases do not qualify.",
};

export const harmfulContentRule = {
	id: "system:harmful_content",
	name: "Harmful Content",
	category: "harmful_content",
	defaultEnabled: false,
	defaultAction: "block",
} as const;
