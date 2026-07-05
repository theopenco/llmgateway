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
		chatShares: r.many.chatShare({
			from: r.user.id,
			to: r.chatShare.userId,
		}),
		createdApiKeys: r.many.apiKey({
			from: r.user.id,
			to: r.apiKey.createdBy,
		}),
		createdMasterKeys: r.many.masterKey({
			from: r.user.id,
			to: r.masterKey.createdBy,
		}),
		auditLogs: r.many.auditLog({
			from: r.user.id,
			to: r.auditLog.userId,
		}),
		favoriteModels: r.many.userFavoriteModel({
			from: r.user.id,
			to: r.userFavoriteModel.userId,
		}),
		modelRatings: r.many.modelRating({
			from: r.user.id,
			to: r.modelRating.userId,
		}),
		skills: r.many.skill({
			from: r.user.id,
			to: r.skill.userId,
		}),
		imageHistory: r.many.playgroundImageHistory({
			from: r.user.id,
			to: r.playgroundImageHistory.userId,
		}),
		videoHistory: r.many.playgroundVideoHistory({
			from: r.user.id,
			to: r.playgroundVideoHistory.userId,
		}),
	},
	organization: {
		userOrganizations: r.many.userOrganization(),
		projects: r.many.project(),
		providerKeys: r.many.providerKey(),
		masterKeys: r.many.masterKey({
			from: r.organization.id,
			to: r.masterKey.organizationId,
		}),
		videoJobs: r.many.videoJob({
			from: r.organization.id,
			to: r.videoJob.organizationId,
		}),
		referralsGiven: r.many.referral({
			from: r.organization.id,
			to: r.referral.referrerOrganizationId,
		}),
		auditLogs: r.many.auditLog({
			from: r.organization.id,
			to: r.auditLog.organizationId,
		}),
		guardrailConfig: r.one.guardrailConfig({
			from: r.organization.id,
			to: r.guardrailConfig.organizationId,
		}),
		guardrailRules: r.many.guardrailRule({
			from: r.organization.id,
			to: r.guardrailRule.organizationId,
		}),
		guardrailViolations: r.many.guardrailViolation({
			from: r.organization.id,
			to: r.guardrailViolation.organizationId,
		}),
		discounts: r.many.discount({
			from: r.organization.id,
			to: r.discount.organizationId,
		}),
		rateLimits: r.many.rateLimit({
			from: r.organization.id,
			to: r.rateLimit.organizationId,
		}),
		followUpEmails: r.many.followUpEmail({
			from: r.organization.id,
			to: r.followUpEmail.organizationId,
		}),
		paymentFailures: r.many.paymentFailure({
			from: r.organization.id,
			to: r.paymentFailure.organizationId,
		}),
		endCustomers: r.many.endCustomer({
			from: r.organization.id,
			to: r.endCustomer.organizationId,
		}),
		wallets: r.many.wallet({
			from: r.organization.id,
			to: r.wallet.organizationId,
		}),
		endUserSessions: r.many.endUserSession({
			from: r.organization.id,
			to: r.endUserSession.organizationId,
		}),
	},
	referral: {
		referrerOrganization: r.one.organization({
			from: r.referral.referrerOrganizationId,
			to: r.organization.id,
		}),
		referredOrganization: r.one.organization({
			from: r.referral.referredOrganizationId,
			to: r.organization.id,
		}),
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
		userProjects: r.many.userProject({
			from: r.userOrganization.id,
			to: r.userProject.userOrganizationId,
		}),
	},
	userProject: {
		userOrganization: r.one.userOrganization({
			from: r.userProject.userOrganizationId,
			to: r.userOrganization.id,
		}),
		project: r.one.project({
			from: r.userProject.projectId,
			to: r.project.id,
		}),
	},
	project: {
		organization: r.one.organization({
			from: r.project.organizationId,
			to: r.organization.id,
		}),
		userProjects: r.many.userProject({
			from: r.project.id,
			to: r.userProject.projectId,
		}),
		apiKeys: r.many.apiKey(),
		logs: r.many.log(),
		videoJobs: r.many.videoJob({
			from: r.project.id,
			to: r.videoJob.projectId,
		}),
		routingConfig: r.one.routingConfig({
			from: r.project.id,
			to: r.routingConfig.projectId,
		}),
		endCustomers: r.many.endCustomer({
			from: r.project.id,
			to: r.endCustomer.projectId,
		}),
		wallets: r.many.wallet({
			from: r.project.id,
			to: r.wallet.projectId,
		}),
		endUserSessions: r.many.endUserSession({
			from: r.project.id,
			to: r.endUserSession.projectId,
		}),
		webhookEndpoints: r.many.webhookEndpoint({
			from: r.project.id,
			to: r.webhookEndpoint.projectId,
		}),
	},
	webhookEndpoint: {
		organization: r.one.organization({
			from: r.webhookEndpoint.organizationId,
			to: r.organization.id,
		}),
		project: r.one.project({
			from: r.webhookEndpoint.projectId,
			to: r.project.id,
		}),
		deliveries: r.many.platformWebhookDelivery({
			from: r.webhookEndpoint.id,
			to: r.platformWebhookDelivery.webhookEndpointId,
		}),
	},
	platformWebhookDelivery: {
		endpoint: r.one.webhookEndpoint({
			from: r.platformWebhookDelivery.webhookEndpointId,
			to: r.webhookEndpoint.id,
		}),
	},
	endCustomer: {
		organization: r.one.organization({
			from: r.endCustomer.organizationId,
			to: r.organization.id,
		}),
		project: r.one.project({
			from: r.endCustomer.projectId,
			to: r.project.id,
		}),
		wallet: r.one.wallet({
			from: r.endCustomer.id,
			to: r.wallet.endCustomerId,
		}),
		ledger: r.many.walletLedger({
			from: r.endCustomer.id,
			to: r.walletLedger.endCustomerId,
		}),
		sessions: r.many.endUserSession({
			from: r.endCustomer.id,
			to: r.endUserSession.endCustomerId,
		}),
	},
	wallet: {
		endCustomer: r.one.endCustomer({
			from: r.wallet.endCustomerId,
			to: r.endCustomer.id,
		}),
		project: r.one.project({
			from: r.wallet.projectId,
			to: r.project.id,
		}),
		organization: r.one.organization({
			from: r.wallet.organizationId,
			to: r.organization.id,
		}),
		ledger: r.many.walletLedger({
			from: r.wallet.id,
			to: r.walletLedger.walletId,
		}),
		sessions: r.many.endUserSession({
			from: r.wallet.id,
			to: r.endUserSession.walletId,
		}),
	},
	endUserSession: {
		organization: r.one.organization({
			from: r.endUserSession.organizationId,
			to: r.organization.id,
		}),
		project: r.one.project({
			from: r.endUserSession.projectId,
			to: r.project.id,
		}),
		endCustomer: r.one.endCustomer({
			from: r.endUserSession.endCustomerId,
			to: r.endCustomer.id,
		}),
		wallet: r.one.wallet({
			from: r.endUserSession.walletId,
			to: r.wallet.id,
		}),
		creator: r.one.user({
			from: r.endUserSession.createdBy,
			to: r.user.id,
		}),
		logs: r.many.log({
			from: r.endUserSession.id,
			to: r.log.endUserSessionId,
		}),
	},
	walletLedger: {
		wallet: r.one.wallet({
			from: r.walletLedger.walletId,
			to: r.wallet.id,
		}),
		endCustomer: r.one.endCustomer({
			from: r.walletLedger.endCustomerId,
			to: r.endCustomer.id,
		}),
		organization: r.one.organization({
			from: r.walletLedger.organizationId,
			to: r.organization.id,
		}),
	},
	routingConfig: {
		project: r.one.project({
			from: r.routingConfig.projectId,
			to: r.project.id,
		}),
	},
	apiKey: {
		project: r.one.project({
			from: r.apiKey.projectId,
			to: r.project.id,
		}),
		logs: r.many.log(),
		videoJobs: r.many.videoJob({
			from: r.apiKey.id,
			to: r.videoJob.apiKeyId,
		}),
		iamRules: r.many.apiKeyIamRule(),
		creator: r.one.user({
			from: r.apiKey.createdBy,
			to: r.user.id,
		}),
		// Browser-session wallet binding now lives on end_user_session.
		wallet: r.one.wallet({
			from: r.apiKey.endCustomerWalletId,
			to: r.wallet.id,
		}),
	},
	apiKeyIamRule: {
		apiKey: r.one.apiKey({
			from: r.apiKeyIamRule.apiKeyId,
			to: r.apiKey.id,
		}),
	},
	masterKey: {
		organization: r.one.organization({
			from: r.masterKey.organizationId,
			to: r.organization.id,
		}),
		creator: r.one.user({
			from: r.masterKey.createdBy,
			to: r.user.id,
		}),
	},
	providerKey: {
		organization: r.one.organization({
			from: r.providerKey.organizationId,
			to: r.organization.id,
		}),
		customModels: r.many.customModel({
			from: r.providerKey.id,
			to: r.customModel.providerKeyId,
		}),
	},
	customModel: {
		providerKey: r.one.providerKey({
			from: r.customModel.providerKeyId,
			to: r.providerKey.id,
		}),
		organization: r.one.organization({
			from: r.customModel.organizationId,
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
	videoJob: {
		organization: r.one.organization({
			from: r.videoJob.organizationId,
			to: r.organization.id,
		}),
		project: r.one.project({
			from: r.videoJob.projectId,
			to: r.project.id,
		}),
		apiKey: r.one.apiKey({
			from: r.videoJob.apiKeyId,
			to: r.apiKey.id,
		}),
		endUserSession: r.one.endUserSession({
			from: r.videoJob.endUserSessionId,
			to: r.endUserSession.id,
		}),
		webhookDeliveryLogs: r.many.webhookDeliveryLog({
			from: r.videoJob.id,
			to: r.webhookDeliveryLog.videoJobId,
		}),
	},
	webhookDeliveryLog: {
		videoJob: r.one.videoJob({
			from: r.webhookDeliveryLog.videoJobId,
			to: r.videoJob.id,
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
		shares: r.many.chatShare({
			from: r.chat.id,
			to: r.chatShare.chatId,
		}),
		project: r.one.chatProject({
			from: r.chat.projectId,
			to: r.chatProject.id,
		}),
	},
	chatProject: {
		user: r.one.user({
			from: r.chatProject.userId,
			to: r.user.id,
		}),
		files: r.many.chatProjectFile({
			from: r.chatProject.id,
			to: r.chatProjectFile.projectId,
		}),
		chats: r.many.chat({
			from: r.chatProject.id,
			to: r.chat.projectId,
		}),
	},
	chatProjectFile: {
		project: r.one.chatProject({
			from: r.chatProjectFile.projectId,
			to: r.chatProject.id,
		}),
		chunks: r.many.chatProjectFileChunk({
			from: r.chatProjectFile.id,
			to: r.chatProjectFileChunk.fileId,
		}),
	},
	chatProjectFileChunk: {
		file: r.one.chatProjectFile({
			from: r.chatProjectFileChunk.fileId,
			to: r.chatProjectFile.id,
		}),
		project: r.one.chatProject({
			from: r.chatProjectFileChunk.projectId,
			to: r.chatProject.id,
		}),
	},
	chatShare: {
		chat: r.one.chat({
			from: r.chatShare.chatId,
			to: r.chat.id,
		}),
		user: r.one.user({
			from: r.chatShare.userId,
			to: r.user.id,
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
	auditLog: {
		user: r.one.user({
			from: r.auditLog.userId,
			to: r.user.id,
		}),
		organization: r.one.organization({
			from: r.auditLog.organizationId,
			to: r.organization.id,
		}),
	},
	guardrailConfig: {
		organization: r.one.organization({
			from: r.guardrailConfig.organizationId,
			to: r.organization.id,
		}),
	},
	guardrailRule: {
		organization: r.one.organization({
			from: r.guardrailRule.organizationId,
			to: r.organization.id,
		}),
	},
	guardrailViolation: {
		organization: r.one.organization({
			from: r.guardrailViolation.organizationId,
			to: r.organization.id,
		}),
	},
	discount: {
		organization: r.one.organization({
			from: r.discount.organizationId,
			to: r.organization.id,
		}),
	},
	rateLimit: {
		organization: r.one.organization({
			from: r.rateLimit.organizationId,
			to: r.organization.id,
		}),
	},
	followUpEmail: {
		organization: r.one.organization({
			from: r.followUpEmail.organizationId,
			to: r.organization.id,
		}),
	},
	paymentFailure: {
		organization: r.one.organization({
			from: r.paymentFailure.organizationId,
			to: r.organization.id,
		}),
	},
	skill: {
		user: r.one.user({
			from: r.skill.userId,
			to: r.user.id,
		}),
	},
	playgroundImageHistory: {
		user: r.one.user({
			from: r.playgroundImageHistory.userId,
			to: r.user.id,
		}),
	},
	playgroundVideoHistory: {
		user: r.one.user({
			from: r.playgroundVideoHistory.userId,
			to: r.user.id,
		}),
	},
}));
