---
name: infrastructure
description: Production infrastructure and request-origin facts for LLM Gateway — GCP hosting, production hostnames and which app serves each, deploy ordering, client IP extraction, forwarded headers, and visitor country. Use when touching client IP or geolocation code, IP rate limits or allow-lists, X-Forwarded-For or X-Client-Ip, server-side calls on a visitor's behalf, deployment assumptions, or when reasoning about api.llmgateway.io versus internal.llmgateway.io.
---

# Infrastructure

## Hosting

Production runs entirely on GCP: GKE behind Google's external Application Load
Balancer, configured with the Gateway API. `infra/helm/` and
`infra/docker-compose*.yml` in this repository describe self-hosting, not
production.

| Host                     | App            | Dev port |
| ------------------------ | -------------- | -------- |
| `api.llmgateway.io`      | `apps/gateway` | 4001     |
| `internal.llmgateway.io` | `apps/api`     | 4002     |

Deploys apply migrations before rolling out new api, gateway, worker, and
frontend images; new code may rely on new columns and backfills at startup.

## Client IP and country

The GCP load balancer is the only edge, so request-origin data comes only from
headers it sets. It writes `X-Client-Ip` from the connecting address with `set`,
overwriting caller input; it appends to `X-Forwarded-For`, so that header's
first hop is caller-supplied on the hosted deployment.

- Read client IPs only through `@llmgateway/shared/client-ip` (`getClientIp`, `getClientIpFromHeaders`, `getClientIpFromContext`, `getClientIpFromRequest`, `getClientIpFromNodeHeaders`, `getClientIpFromForwardedFor`, `isPublicIp`, `ipMatchesCidr`, `anyCidrMatches`, `forwardedIpHeaders`). Add new variants there.
- The helper trusts exactly one header, named by `CLIENT_IP_HEADER`, with no fallback chain, so a caller cannot pick its identity by sending a different header. It defaults to `X-Forwarded-For` for self-hosting behind an overwriting proxy. Hosted sets it to `X-Client-Ip`; with `HOSTED=true`, `assertClientIpHeaderConfigured()` (api and gateway `serve.ts`, each Next.js app's `instrumentation.ts`) refuses to start without it.
- Better Auth resolves its own IP (session `ipAddress`, its rate limiter) from `advanced.ipAddress.ipAddressHeaders`, set to the same header in `apps/api/src/auth/config.ts`. It rejects a multi-hop chain, so its `X-Forwarded-For` default yields no IP behind the load balancer.
- Read country through `getCountryFromHeaders` (`apps/api/src/utils/request-country.ts`), which uses the load balancer's `X-Client-Region` / `X-Client-Geo-Location`.
- Frontends reach the API over the in-cluster Service (`API_BACKEND_URL`). A server-rendered page or proxy route calling the API for a visitor spreads `forwardedIpHeaders(headers)`, so rate limits stay per visitor.
