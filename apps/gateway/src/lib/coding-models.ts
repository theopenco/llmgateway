/**
 * The coding-model predicate lives in `@llmgateway/shared` so the gateway's
 * DevPass 403 gate and the DevPass models directory can never disagree about
 * which models a coding plan covers. Re-exported here to keep the gateway's
 * existing import sites stable.
 */
export {
	isCodingModel,
	mappingSupportsCoding,
	providerSupportsCachedInput,
} from "@llmgateway/shared";
