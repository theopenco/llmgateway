const DEV_PLAN_SERVICE_TIER_CUTOFF = Date.parse("2026-08-20T00:00:00Z");

export function canConfigureDevPlanServiceTier(userCreatedAt: string): boolean {
	return new Date(userCreatedAt).getTime() < DEV_PLAN_SERVICE_TIER_CUTOFF;
}
