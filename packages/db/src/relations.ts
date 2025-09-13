import { defineRelations } from "drizzle-orm";

import * as schema from "./schema";

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
}));
