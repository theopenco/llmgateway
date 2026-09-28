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

The load balancer writes `X-Client-Ip` from the connecting address with `set`,
overwriting caller input, so it is the trusted client address.

- Read client IPs only through `@llmgateway/shared/client-ip` (`packages/shared/src/client-ip.ts`). It reads the single header named by `CLIENT_IP_HEADER` (hosted: `X-Client-Ip`; default `x-forwarded-for` for self-hosting). Add new variants there.
- Read country through `getCountryFromHeaders` (`apps/api/src/utils/request-country.ts`), which uses the load balancer's region headers.
- A server-rendered page or proxy route calling the API for a visitor spreads `forwardedIpHeaders(headers)`, so rate limits stay per visitor.
