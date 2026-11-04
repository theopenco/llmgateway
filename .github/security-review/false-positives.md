Do not report:

- Rate limiting, denial of service, or resource exhaustion on the request path;
  `apps/gateway/src/middleware/org-rate-limit.ts` owns that.
- Missing input validation where a Zod schema already validates the route.
- Seeded fixtures already in the repository (`admin@example.com`,
  `test-token`, `Test Organization`) or public provider pricing.
- Test files (`*.spec.ts`, `*.e2e.ts`) and `vitest/` fixtures.
- Dependency version advisories; Dependabot owns those.
