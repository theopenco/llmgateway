# Vertex Anthropic Inline Service Account JSON Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace file-path-based GCP service account config (`GCP_SERVICE_ACCOUNT_KEY_FILE`) with inline JSON env var (`LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON`), and auto-extract project ID from the SA JSON so `LLM_VERTEX_ANTHROPIC_PROJECT` is no longer required.

**Architecture:** The SA JSON already contains `project_id`. We parse it once at startup (or on first use), extract `project_id`, `client_email`, `private_key`, and `token_uri`. The only required env vars become `LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON` (inline JSON string) and `LLM_VERTEX_ANTHROPIC_REGION`. `LLM_VERTEX_ANTHROPIC_API_KEY` is kept as a placeholder field for provider validation but its value is irrelevant. `GCP_SERVICE_ACCOUNT_KEY_FILE` and `LLM_VERTEX_ANTHROPIC_PROJECT` are deprecated and removed.

**Tech Stack:** TypeScript, Node.js, Hono, Drizzle ORM, Vitest

---

## File Map

| File | Change |
|------|--------|
| `apps/gateway/src/lib/gcp-token.ts` | Replace file-read logic with inline JSON parsing; expose `getVertexAnthropicProjectId()` |
| `packages/models/src/providers.ts` | Change `required.project` → removed; change `required.apiKey` to optional; add `serviceAccountJson` optional |
| `packages/actions/src/get-provider-endpoint.ts` | Remove `project` env lookup for vertex-anthropic; call `getVertexAnthropicProjectId()` from gcp-token |
| `packages/db/src/schema.ts` | Remove `vertex_anthropic_project_id` from `ProviderKeyOptions` |
| `.env.example` | Update vertex-anthropic section |
| `.env` | Update local config |
| `apps/docs/content/guides/vertex-anthropic.mdx` | Update env var docs |

---

## Task 1: Update `gcp-token.ts` — inline JSON + expose project ID

**Files:**
- Modify: `apps/gateway/src/lib/gcp-token.ts`

- [ ] **Step 1: Replace the module with updated version**

Replace the entire file content with:

```typescript
import * as crypto from "node:crypto";

import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

interface ServiceAccountKey {
	client_email: string;
	private_key: string;
	token_uri: string;
	project_id: string;
}

const REDIS_KEY = "gcp:vertex:access_token";
const TTL_SECONDS = 50 * 60;

let memoryCache: { token: string; expiresAt: number } | null = null;

let serviceAccountKey: ServiceAccountKey | null = null;

function getServiceAccountKey(): ServiceAccountKey | null {
	if (serviceAccountKey) {
		return serviceAccountKey;
	}

	const inlineJson = process.env.LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON;
	if (!inlineJson) {
		return null;
	}

	try {
		serviceAccountKey = JSON.parse(inlineJson) as ServiceAccountKey;
		return serviceAccountKey;
	} catch (err) {
		logger.error("Failed to parse LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON", err);
		return null;
	}
}

export function getVertexAnthropicProjectId(): string | null {
	const sa = getServiceAccountKey();
	return sa?.project_id ?? null;
}

function base64url(data: Buffer | string): string {
	const buf = typeof data === "string" ? Buffer.from(data) : data;
	return buf.toString("base64url");
}

function createSignedJwt(sa: ServiceAccountKey, scope: string): string {
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: "RS256", typ: "JWT" };
	const payload = {
		iss: sa.client_email,
		scope,
		aud: sa.token_uri,
		iat: now,
		exp: now + 3600,
	};

	const segments = [
		base64url(JSON.stringify(header)),
		base64url(JSON.stringify(payload)),
	];
	const signingInput = segments.join(".");

	const sign = crypto.createSign("RSA-SHA256");
	sign.update(signingInput);
	const signature = sign.sign(sa.private_key);

	return `${signingInput}.${base64url(signature)}`;
}

async function fetchNewToken(sa: ServiceAccountKey): Promise<string> {
	const scope = "https://www.googleapis.com/auth/cloud-platform";
	const jwt = createSignedJwt(sa, scope);

	const body = new URLSearchParams({
		grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
		assertion: jwt,
	});

	const res = await fetch(sa.token_uri, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: body.toString(),
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`GCP token exchange failed (${res.status}): ${text}`);
	}

	const data = (await res.json()) as { access_token: string };
	return data.access_token;
}

export async function getGcpAccessToken(): Promise<string | null> {
	const sa = getServiceAccountKey();
	if (!sa) {
		return null;
	}

	if (memoryCache && memoryCache.expiresAt > Date.now()) {
		return memoryCache.token;
	}

	try {
		const cached = await redisClient.get(REDIS_KEY);
		if (cached) {
			memoryCache = { token: cached, expiresAt: Date.now() + 60_000 };
			return cached;
		}
	} catch {
		// Redis unavailable — continue to generate token
	}

	const token = await fetchNewToken(sa);

	try {
		await redisClient.set(REDIS_KEY, token, "EX", TTL_SECONDS);
	} catch {
		// Redis unavailable — in-memory cache still works
	}

	memoryCache = { token, expiresAt: Date.now() + (TTL_SECONDS * 1000) };
	return token;
}
```

- [ ] **Step 2: Verify no TS errors**

```bash
cd /root/llmgateway && pnpm --filter gateway exec tsc --noEmit 2>&1 | head -30
```

Expected: no errors related to `gcp-token.ts`.

---

## Task 2: Update provider config in `providers.ts`

**Files:**
- Modify: `packages/models/src/providers.ts`

The current vertex-anthropic `env` block is:
```ts
env: {
    required: {
        apiKey: "LLM_VERTEX_ANTHROPIC_API_KEY",
        project: "LLM_VERTEX_ANTHROPIC_PROJECT",
    },
    optional: {
        baseUrl: "LLM_VERTEX_ANTHROPIC_BASE_URL",
        region: "LLM_VERTEX_ANTHROPIC_REGION",
    },
},
```

- [ ] **Step 1: Point `required.apiKey` at the SA JSON env var; remove `project` from required**

`hasProviderEnvironmentToken("vertex-anthropic")` reads `provider.env.required.apiKey` to know whether the provider is active. If we remove `apiKey` from `required`, the provider becomes invisible to the router. Instead, point it at the new env var so presence of the SA JSON is what activates the provider.

Replace the `env` block for `vertex-anthropic` (around line 166-174):

```ts
env: {
    required: {
        apiKey: "LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON",
    },
    optional: {
        baseUrl: "LLM_VERTEX_ANTHROPIC_BASE_URL",
        region: "LLM_VERTEX_ANTHROPIC_REGION",
    },
},
```

This means `LLM_VERTEX_ANTHROPIC_API_KEY` is no longer used anywhere — remove it from `.env` and `.env.example` too.

- [ ] **Step 2: Verify build still compiles**

```bash
cd /root/llmgateway && pnpm --filter models build 2>&1 | tail -10
```

Expected: `dist/` updated, no errors.

---

## Task 3: Update `get-provider-endpoint.ts` — use `getVertexAnthropicProjectId()`

**Files:**
- Modify: `packages/actions/src/get-provider-endpoint.ts`

Currently the `vertex-anthropic` case (around line 356-379) reads project from env or providerKeyOptions. We replace it with `getVertexAnthropicProjectId()` from the gateway lib — but wait: `packages/actions` cannot depend on `apps/gateway`. So we need a different approach.

**Approach:** Pass project ID as a parameter from `chat.ts` where we already call `getVertexAnthropicProjectId()`. But `getProviderEndpoint` doesn't take a projectId override param... 

**Simpler approach:** Keep reading project from `LLM_VERTEX_ANTHROPIC_PROJECT` env var as **optional fallback**, but also check the SA JSON directly. Since `getProviderEnvValue` reads process.env, we can just set a derived env var at startup — or better: read `LLM_VERTEX_ANTHROPIC_PROJECT` if set, otherwise parse the SA JSON inline here too (re-parsing is cheap since it's cached in gcp-token module, but that module is in gateway, not actions).

**Cleanest approach that keeps packages decoupled:** In `chat.ts`, before calling `getProviderEndpoint`, set `process.env.LLM_VERTEX_ANTHROPIC_PROJECT` from `getVertexAnthropicProjectId()` if it's not already set. Then `get-provider-endpoint.ts` reads it the same way as before.

- [ ] **Step 1: In `chat.ts`, resolve project ID early from SA JSON**

Find the GCP token override block in `chat.ts` (around line 3087):
```ts
if (usedProvider === "vertex-anthropic" || usedProvider === "google-vertex") {
    const gcpToken = await getGcpAccessToken();
    if (gcpToken) {
        usedToken = gcpToken;
    }
}
```

**Remove `google-vertex` from this condition** — the SA JSON and token refresh is for vertex-anthropic only. `google-vertex` (Gemini) gets its token through its own `LLM_GOOGLE_VERTEX_API_KEY` flow and must not be changed.

Replace with:
```ts
if (usedProvider === "vertex-anthropic") {
    const gcpToken = await getGcpAccessToken();
    if (gcpToken) {
        usedToken = gcpToken;
    }
}
```

Add the import at top of file (already imported `getGcpAccessToken`, add `getVertexAnthropicProjectId`):
```ts
import { getGcpAccessToken, getVertexAnthropicProjectId } from "@/lib/gcp-token.js";
```

Add project ID bootstrap **once at module load** (outside request handlers, at module top level after imports) in `chat.ts`:

```ts
// Populate LLM_VERTEX_ANTHROPIC_PROJECT from SA JSON if not explicitly set
const derivedProjectId = getVertexAnthropicProjectId();
if (derivedProjectId && !process.env.LLM_VERTEX_ANTHROPIC_PROJECT) {
    process.env.LLM_VERTEX_ANTHROPIC_PROJECT = derivedProjectId;
}
```

This runs once at module init, so `getProviderEndpoint` can read it via `getProviderEnvValue` as before.

- [ ] **Step 2: Remove the hard error for missing project in `get-provider-endpoint.ts`**

Currently line ~370-374:
```ts
if (!vaProjectId) {
    throw new Error(
        "LLM_VERTEX_ANTHROPIC_PROJECT environment variable is required for vertex-anthropic provider",
    );
}
```

The project ID is now always populated from SA JSON if SA JSON is configured. The error message is misleading. Update it to:
```ts
if (!vaProjectId) {
    throw new Error(
        "vertex-anthropic provider requires either LLM_VERTEX_ANTHROPIC_PROJECT or a valid LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON containing project_id",
    );
}
```

- [ ] **Step 3: Build and verify**

```bash
cd /root/llmgateway && pnpm --filter actions build 2>&1 | tail -10
```

Expected: no errors.

---

## Task 4: Remove `vertex_anthropic_project_id` from DB schema

**Files:**
- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: Remove the project_id field from ProviderKeyOptions**

Find around line 486-487:
```ts
vertex_anthropic_project_id?: string;
vertex_anthropic_region?: string;
```

Remove only `vertex_anthropic_project_id`, keep `vertex_anthropic_region` (region stays manual since the SA JSON doesn't contain it):
```ts
vertex_anthropic_region?: string;
```

- [ ] **Step 2: Sync DB schema**

```bash
cd /root/llmgateway && pnpm run setup
```

Expected: schema synced, seed data inserted, no errors.

- [ ] **Step 3: Check for any remaining references to `vertex_anthropic_project_id`**

```bash
grep -rn "vertex_anthropic_project_id" /root/llmgateway/apps/ /root/llmgateway/packages/ --include="*.ts" --include="*.tsx"
```

Expected: no results. If any found, remove them.

---

## Task 5: Update env files and docs

**Files:**
- Modify: `.env.example`
- Modify: `.env`
- Modify: `apps/docs/content/guides/vertex-anthropic.mdx`

- [ ] **Step 1: Update `.env.example` vertex-anthropic section**

Find and replace the vertex-anthropic block:
```
# Vertex AI Anthropic (Claude models on Vertex AI)
# Requires: GCP service account JSON + project ID + region
# The gateway auto-generates OAuth2 tokens from the service account file.
# See docs/guides/vertex-anthropic for full setup guide.
GCP_SERVICE_ACCOUNT_KEY_FILE=/path/to/service-account.json
LLM_VERTEX_ANTHROPIC_API_KEY=placeholder
LLM_VERTEX_ANTHROPIC_PROJECT=your_google_cloud_project_id
LLM_VERTEX_ANTHROPIC_REGION=us-east5
```

Replace with:
```
# Vertex AI Anthropic (Claude models on Vertex AI)
# Paste the full contents of your GCP service account JSON as a single-line string.
# Project ID is extracted automatically from the JSON. No separate project env var needed.
# See docs/guides/vertex-anthropic for full setup guide.
LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"your-project","private_key_id":"...","private_key":"-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n","client_email":"vertex-ai-caller@your-project.iam.gserviceaccount.com","token_uri":"https://oauth2.googleapis.com/token"}
LLM_VERTEX_ANTHROPIC_REGION=us-east5
```

- [ ] **Step 2: Update local `.env`**

Remove:
```
GCP_SERVICE_ACCOUNT_KEY_FILE=/root/vertex-marketplace-caller.json
LLM_VERTEX_ANTHROPIC_API_KEY=placeholder-overridden-by-service-account
LLM_VERTEX_ANTHROPIC_PROJECT=llmgatewayio
```

Add (read the actual JSON from the file and inline it):
```bash
SA_JSON=$(cat /root/vertex-marketplace-caller.json | tr -d '\n')
```
Then set `LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON=$SA_JSON` in `.env`.

> Important: The JSON value in `.env` must be on one line. Private key newlines are `\n` literals inside the JSON string — they survive JSON.parse correctly.

- [ ] **Step 3: Update the setup guide docs**

In `apps/docs/content/guides/vertex-anthropic.mdx`, update the "Configure Environment Variables" step to show only two vars:

```mdx
### Configure Environment Variables

Add the following to your `.env` file:

```bash
# Paste the full GCP service account JSON as a single string (escape newlines as \n)
LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"YOUR_PROJECT_ID",...}

# Set your preferred region
LLM_VERTEX_ANTHROPIC_REGION=us-east5
```

<Callout type="info">
  The project ID is extracted automatically from the service account JSON — no
  separate `LLM_VERTEX_ANTHROPIC_PROJECT` variable is needed.
</Callout>
```

Also update the "How Token Refresh Works" section to remove mention of `GCP_SERVICE_ACCOUNT_KEY_FILE`.

Remove the `GCP_SERVICE_ACCOUNT_KEY_FILE` line from the troubleshooting section.

---

## Task 6: Format, build, test

- [ ] **Step 1: Format code**

```bash
cd /root/llmgateway && pnpm format
```

Expected: exits 0, no unformatted files.

- [ ] **Step 2: Full build**

```bash
cd /root/llmgateway && pnpm build 2>&1 | tail -20
```

Expected: all packages build successfully.

- [ ] **Step 3: Run vertex-anthropic e2e tests**

```bash
cd /root/llmgateway && TEST_MODELS="vertex-anthropic/claude-haiku-4-5" pnpm test:e2e 2>&1 | tail -30
```

Expected: tests pass.

- [ ] **Step 4: Commit**

```bash
cd /root/llmgateway && git add -A && git commit -m "$(cat <<'EOF'
feat: inline SA JSON for vertex-anthropic config

Replace GCP_SERVICE_ACCOUNT_KEY_FILE + LLM_VERTEX_ANTHROPIC_PROJECT
with a single LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON env var.
Project ID is auto-extracted from the JSON.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Checklist

- [x] `GCP_SERVICE_ACCOUNT_KEY_FILE` usage removed from `gcp-token.ts` ✓
- [x] `LLM_VERTEX_ANTHROPIC_PROJECT` no longer required — extracted from JSON ✓  
- [x] `vertex_anthropic_project_id` removed from DB schema ✓
- [x] `.env.example` updated with new minimal config ✓
- [x] Docs updated ✓
- [x] `getVertexAnthropicProjectId()` exported and used to seed process.env ✓
- [x] `LLM_VERTEX_ANTHROPIC_REGION` still manual (SA JSON doesn't include region) ✓
- [x] `LLM_VERTEX_ANTHROPIC_API_KEY` no longer required (moved to optional) ✓
