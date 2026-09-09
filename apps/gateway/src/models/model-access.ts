import { HTTPException } from "hono/http-exception";

import { isModelTrulyFree } from "@/chat/tools/is-model-truly-free.js";
import { assertMemberProjectAccess } from "@/lib/api-key-usage-limits.js";
import {
	findActiveCustomModels,
	findActiveProviderKeys,
	findApiKeyByToken,
	findOrganizationById,
	findProjectById,
} from "@/lib/cached-queries.js";
import { getClientIpFromRequest } from "@/lib/client-ip.js";
import {
	isCodingModel,
	providerSupportsCachedInput,
} from "@/lib/coding-models.js";
import {
	getActiveCompliancePolicy,
	isModelIdCompliant,
	isProviderIdCompliant,
} from "@/lib/compliance.js";
import { customModelToProviderMapping } from "@/lib/custom-model.js";
import {
	assertOriginAllowed,
	loadEndUserWallet,
} from "@/lib/end-user-session.js";
import { extractApiToken } from "@/lib/extract-api-token.js";
import { findRequestIamRules, validateRequestModelAccess } from "@/lib/iam.js";
import { assertOrganizationUsable } from "@/lib/organization-access.js";

import { customModelRef } from "@llmgateway/models";
import { isChatPlanModelAllowed } from "@llmgateway/shared";

import type { ComplianceCheckContext } from "@/lib/compliance.js";
import type { ModelDefinition } from "@llmgateway/models";
import type { Context } from "hono";

export async function getModelsAccess(c: Context) {
	if (
		!c.req.raw.headers.has("Authorization") &&
		!c.req.raw.headers.has("x-api-key")
	) {
		return undefined;
	}

	c.header("Cache-Control", "private, no-store");
	const apiKey = await findApiKeyByToken(extractApiToken(c));
	if (!apiKey || apiKey.status !== "active") {
		throw new HTTPException(401, { message: "Invalid or inactive API key" });
	}
	if (apiKey.keyType !== "user" && !apiKey.endUserSession) {
		throw new HTTPException(403, {
			message: "Model discovery requires a regular API key or end-user session",
		});
	}
	if (apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() <= Date.now()) {
		throw new HTTPException(401, { message: "API key has expired" });
	}

	const project = await findProjectById(apiKey.projectId);
	if (!project) {
		throw new HTTPException(500, { message: "Could not find project" });
	}
	if (project.status === "deleted") {
		throw new HTTPException(410, { message: "Project has been archived" });
	}
	const organization = await findOrganizationById(project.organizationId);
	if (!organization) {
		throw new HTTPException(500, { message: "Could not find organization" });
	}
	assertOrganizationUsable(organization);
	await assertMemberProjectAccess(apiKey, organization.id);
	const wallet = await loadEndUserWallet(apiKey);
	if (wallet) {
		assertOriginAllowed(c, project);
	}
	const iamRules = await findRequestIamRules(apiKey, organization.id);
	return {
		apiKey,
		project,
		organization,
		wallet,
		iamRules,
		clientIp: getClientIpFromRequest(c),
	};
}

type ModelsAccess = NonNullable<Awaited<ReturnType<typeof getModelsAccess>>>;

export async function filterAccessibleModels(
	models: ModelDefinition[],
	access: ModelsAccess,
	options: {
		mapped: boolean;
		noTraining: boolean;
		includeDeactivated: boolean;
		excludeDeprecated: boolean;
		currentDate: Date;
	},
): Promise<ModelDefinition[]> {
	const { apiKey, organization, project, wallet, iamRules, clientIp } = access;
	const policy = getActiveCompliancePolicy(organization);
	const isDevPlan =
		organization.kind === "devpass" && organization.devPlan !== "none";
	const providerKeys = await findActiveProviderKeys(organization.id);
	const providerIds = new Set(providerKeys.map((key) => key.provider));
	const candidates: {
		model: ModelDefinition;
		context?: ComplianceCheckContext;
	}[] = models.map((model) => ({ model }));

	if (!isDevPlan && !wallet && project.mode !== "credits") {
		const keysById = new Map(providerKeys.map((key) => [key.id, key]));
		for (const custom of await findActiveCustomModels(organization.id)) {
			const key = keysById.get(custom.providerKeyId);
			if (
				key?.provider !== "custom" ||
				!key.name ||
				(options.noTraining && key.complianceAttestation?.apiTraining !== false)
			) {
				continue;
			}
			candidates.push({
				model: {
					id: custom.modelName,
					name: custom.displayName ?? custom.modelName,
					family: "custom",
					providers: [customModelToProviderMapping(custom)],
				},
				context: {
					customProviderName: key.name,
					customAttestation: key.complianceAttestation,
				},
			});
		}
	}

	const result: ModelDefinition[] = [];
	for (const { model, context } of candidates) {
		const activeModel = {
			...model,
			providers: model.providers.filter(
				(provider) =>
					(options.includeDeactivated ||
						!provider.deactivatedAt ||
						options.currentDate <= provider.deactivatedAt) &&
					(!options.excludeDeprecated ||
						!provider.deprecatedAt ||
						options.currentDate <= provider.deprecatedAt),
			),
		};
		if (
			activeModel.providers.length === 0 ||
			(isDevPlan && (!isCodingModel(activeModel) || options.mapped)) ||
			(organization.kind === "chat" &&
				organization.chatPlan === "starter" &&
				!isChatPlanModelAllowed("starter", model.id)) ||
			(wallet?.mode === "test" && !isModelTrulyFree(activeModel)) ||
			(policy && !isModelIdCompliant(model.id, policy, context))
		) {
			continue;
		}
		const validate = (requestedProvider?: string) =>
			validateRequestModelAccess({
				apiKey,
				organizationId: organization.id,
				requestedModel: model.id,
				requestedProvider,
				customProviderName: context?.customProviderName,
				activeModelInfo: activeModel,
				clientIp,
				iamRules,
			});
		const validation = options.mapped
			? undefined
			: await validate(context ? "custom" : undefined);
		if (validation && !validation.allowed) {
			continue;
		}
		const allowedProviders = [];
		for (const provider of activeModel.providers) {
			if (
				(validation?.allowedProviders &&
					!validation.allowedProviders.includes(provider.providerId)) ||
				(options.mapped && !(await validate(provider.providerId)).allowed) ||
				(policy &&
					!isProviderIdCompliant(provider.providerId, policy, context)) ||
				(isDevPlan && !providerSupportsCachedInput(provider)) ||
				(!wallet &&
					project.mode === "api-keys" &&
					provider.providerId !== "llmgateway" &&
					!providerIds.has(provider.providerId))
			) {
				continue;
			}
			allowedProviders.push(provider);
		}
		if (allowedProviders.length > 0) {
			result.push({
				...model,
				id: context?.customProviderName
					? customModelRef(context.customProviderName, model.id)
					: model.id,
				providers: allowedProviders,
			});
		}
	}
	return result;
}
