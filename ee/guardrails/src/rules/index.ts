import { documentLeakageRule } from "./system/document-leakage.js";
import { injectionRule } from "./system/injection.js";
import { jailbreakRule } from "./system/jailbreak.js";
import { piiRule } from "./system/pii.js";
import { secretsRule } from "./system/secrets.js";

import type { SystemRule } from "@/types.js";

export { injectionRule, injectionQuestion } from "./system/injection.js";
export { jailbreakRule, jailbreakQuestion } from "./system/jailbreak.js";
export { piiRule, redactPii, detectPii } from "./system/pii.js";
export { secretsRule, redactSecrets, detectSecrets } from "./system/secrets.js";
export {
	fileTypesRule,
	checkMessageFiles,
	isFileTypeAllowed,
} from "./system/files.js";
export { documentLeakageRule } from "./system/document-leakage.js";
export {
	harmfulContentRule,
	harmfulContentQuestions,
} from "./system/harmful-content.js";

export { checkBlockedTerms } from "./custom/blocked-terms.js";
export { checkCustomRegex } from "./custom/regex.js";
export {
	checkTopicRestriction,
	presetTopics,
	topicLabel,
} from "./custom/topic-restriction.js";
export { checkSensitiveData } from "./custom/sensitive-data.js";

/** Pattern rules run on message text; files and harmful content run separately. */
export const systemRules: SystemRule[] = [
	injectionRule,
	jailbreakRule,
	piiRule,
	secretsRule,
	documentLeakageRule,
];
