---
id: "90"
slug: "airside-model-verification"
date: "2026-09-05"
title: "Airside: Model Verification and Crew Invites"
summary: "Airside now runs a preflight against your endpoint before a model can be filed: every capability you declare is probed live, and the results become the capability badges developers see. Carriers can also pick the upstream API format per model, invite crew by email, file per-model fares, and rename their carrier under review."
image:
  src: "/changelog/airside-model-verification.png"
  alt: "A glowing airport control tower beside an inspection clipboard with lit checkmarks on a circuit board, surrounded by paper planes, an envelope, and a price tag"
  width: 1536
  height: 1024
---

A model listing is a set of claims: this endpoint streams, accepts images, calls tools, returns JSON. When one of those claims is wrong, developers find out through a `400` and routing quietly sends their traffic elsewhere. **Model verification** checks the claims before the listing goes live: Airside runs a preflight against your endpoint and records what actually works.

## Preflight Before Filing

When you register a model under **Fleet**, Airside queues a preflight against your upstream API before the filing can be submitted. You paste a provider API key that is used only by that run and erased when it finishes. Each declared capability gets its own check, so a failure tells you exactly which flag to fix rather than rejecting the whole listing:

| Check            | Runs when you declare    |
| ---------------- | ------------------------ |
| Basic completion | Always                   |
| Streaming        | Streaming                |
| Vision input     | Vision                   |
| Audio input      | Audio input              |
| Tool calls       | Tools                    |
| JSON output      | JSON output              |
| Structured JSON  | JSON schema output       |
| Reasoning        | Reasoning                |
| Reasoning budget | A reasoning token budget |
| Web search       | Web search               |

Results update in the dialog as the checks complete. Editing a model after its preflight invalidates the run, so a listing can never ship with checks that were made against different settings, and a running verification cannot be queued twice. Existing listings get a **Run verification** button, and the verified capabilities appear as badges on the model's provider page on llmgateway.io.

## Choose the Upstream API

Not every provider speaks Chat Completions. Each model now declares the **upstream API** the gateway should use: the carrier default, OpenAI Chat Completions, OpenAI Responses, or Google Vertex `generateContent`, with the same Vertex OAuth handling the static catalogue uses. The preflight runs through that format, so what passes verification is what serves traffic.

## Crew, Fares, and Branding

- **Crew invites** go out by email to new and existing users. A teammate with an account joins immediately; anyone else joins the first time they sign in with the invited address. Failed sends roll back so owners can retry, and pending invites can be revoked.
- **Per-model fares** let a single model carry its own traffic discount and landing fee instead of inheriting the carrier's, filed for review like every other fare change.
- **Renaming your carrier** files a branding change that the LLM Gateway team reviews before it appears on the public providers and models pages.

---

**[Airside docs →](https://docs.llmgateway.io/features/airside)** | **[Open the carrier console →](https://airside.llmgateway.io)**
