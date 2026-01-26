import { documentLeakageRule } from "./system/document-leakage.js";
import { fileTypesRule } from "./system/files.js";
import { injectionRule } from "./system/injection.js";
import { jailbreakRule } from "./system/jailbreak.js";
import { piiRule } from "./system/pii.js";
import { secretsRule } from "./system/secrets.js";

import type { SystemRule } from "@/types.js";

export { injectionRule } from "./system/injection.js";
export { jailbreakRule } from "./system/jailbreak.js";
export { piiRule, redactPii } from "./system/pii.js";
export { secretsRule } from "./system/secrets.js";
export { fileTypesRule, checkFileType, checkFileSize } from "./system/files.js";
export { documentLeakageRule } from "./system/document-leakage.js";

export { checkBlockedTerms } from "./custom/blocked-terms.js";
export { checkCustomRegex } from "./custom/regex.js";
export { checkTopicRestriction } from "./custom/topic-restriction.js";

export const systemRules: SystemRule[] = [
	injectionRule,
	jailbreakRule,
	piiRule,
	secretsRule,
	fileTypesRule,
	documentLeakageRule,
];
