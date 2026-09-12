---
id: "89"
slug: "zero-data-retention"
date: "2026-09-04"
title: "Zero Data Retention Controls"
summary: "Enterprise organizations can now enforce zero data retention across provider routing, LLM Gateway storage, response caches, and the Responses API. Conflicting retention and caching settings are blocked before they can weaken the policy."
image:
  src: "/changelog/zero-data-retention.png"
  alt: "A glowing privacy vault on a circuit board with data routes passing through without entering storage chips"
  width: 1536
  height: 1024
---

Avoiding prompt logs at one layer is not enough when a gateway, cache, or upstream provider may still retain the same data elsewhere. **Zero data retention (ZDR)** is now a separate Enterprise compliance rule that keeps those layers aligned and blocks incompatible changes before they can weaken the guarantee.

## Route Only Through ZDR Providers

Enable ZDR under **Settings → Compliance** to route only through providers whose published policy states that they do not log prompts and retain them for zero days. Unknown attributes fail closed, and the policy applies to initial routing, retries, and fallbacks.

Some common providers temporarily retain API data for legal or safety purposes without using it for training. ZDR excludes those providers too, so models available under normal routing may become unavailable while the rule is active.

## Keep Storage Settings Compatible

ZDR can only be enabled after organization retention is set to **Metadata Only** and response caching is disabled in every project. Once active, those conflicting settings stay unavailable until ZDR is turned off.

| Surface                   | Behavior while ZDR is active                                      |
| ------------------------- | ----------------------------------------------------------------- |
| Provider routing          | Allows only providers with no prompt logging and zero-day storage |
| Gateway logs              | Never retain prompt or response payloads                          |
| Gateway response cache    | Bypassed                                                          |
| Provider prompt caches    | Cache markers and cache-routing keys are removed                  |
| Responses API             | Requires an explicit `store: false`                               |
| Asynchronous video        | Unavailable because jobs require temporary output storage         |
| Organization and projects | Payload retention and response caching cannot be enabled          |

The Responses API rejects storage-enabled requests with a `400` instead of silently changing their behavior:

```bash
curl https://api.llmgateway.io/v1/responses \
	-H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
	-H "Content-Type: application/json" \
	-d '{
		"model": "gpt-5-mini",
		"store": false,
		"input": "Summarize this document without retaining it."
	}'
```

Existing policies that use the deprecated **No prompt logging** rule keep their original routing behavior. The rule can be turned off to reset an old policy, but it cannot be added to new policies; use ZDR for the complete storage guarantee.

Available on the **Enterprise plan**.

---

**[Compliance docs →](https://docs.llmgateway.io/features/compliance)** | **[Enterprise plans →](https://llmgateway.io/enterprise)**
