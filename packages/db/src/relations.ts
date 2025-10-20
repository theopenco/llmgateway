import { defineRelations } from "drizzle-orm";

import * as schema from "./schema.js";

export const relations = defineRelations(schema, (r) => ({
	user: {
		userOrganizations: r.many.userOrganization(),
		passkeys: r.many.passkey({
			from: r.user.id,
			to: r.passkey.userId,
		}),
		chats: r.many.chat({
			from: r.user.id,
			to: r.chat.userId,
		}),
		createdApiKeys: r.many.apiKey({
			from: r.user.id,
			to: r.apiKey.createdBy,
		}),
	},
	organization: {
		userOrganizations: r.many.userOrganization(),
		projects: r.many.project(),
		providerKeys: r.many.providerKey(),
	},
	userOrganization: {
		user: r.one.user({
			from: r.userOrganization.userId,
			to: r.user.id,
		}),
		organization: r.one.organization({
			from: r.userOrganization.organizationId,
			to: r.organization.id,
		}),
	},
	project: {
		organization: r.one.organization({
			from: r.project.organizationId,
			to: r.organization.id,
		}),
		apiKeys: r.many.apiKey(),
		logs: r.many.log(),
	},
	apiKey: {
		project: r.one.project({
			from: r.apiKey.projectId,
			to: r.project.id,
		}),
		logs: r.many.log(),
		iamRules: r.many.apiKeyIamRule(),
		creator: r.one.user({
			from: r.apiKey.createdBy,
			to: r.user.id,
		}),
	},
	apiKeyIamRule: {
		apiKey: r.one.apiKey({
			from: r.apiKeyIamRule.apiKeyId,
			to: r.apiKey.id,
		}),
	},
	providerKey: {
		organization: r.one.organization({
			from: r.providerKey.organizationId,
			to: r.organization.id,
		}),
	},
	log: {
		project: r.one.project({
			from: r.log.projectId,
			to: r.project.id,
		}),
		apiKey: r.one.apiKey({
			from: r.log.apiKeyId,
			to: r.apiKey.id,
		}),
	},
	passkey: {
		user: r.one.user({
			from: r.passkey.userId,
			to: r.user.id,
		}),
	},
	chat: {
		user: r.one.user({
			from: r.chat.userId,
			to: r.user.id,
		}),
		messages: r.many.message({
			from: r.chat.id,
			to: r.message.chatId,
		}),
	},
	message: {
		chat: r.one.chat({
			from: r.message.chatId,
			to: r.chat.id,
		}),
	},
	provider: {
		modelProviderMappings: r.many.modelProviderMapping({
			from: r.provider.id,
			to: r.modelProviderMapping.providerId,
		}),
	},
	model: {
		modelProviderMappings: r.many.modelProviderMapping({
			from: r.model.id,
			to: r.modelProviderMapping.modelId,
		}),
	},
	modelProviderMapping: {
		model: r.one.model({
			from: r.modelProviderMapping.modelId,
			to: r.model.id,
		}),
		provider: r.one.provider({
			from: r.modelProviderMapping.providerId,
			to: r.provider.id,
		}),
	},
}));
