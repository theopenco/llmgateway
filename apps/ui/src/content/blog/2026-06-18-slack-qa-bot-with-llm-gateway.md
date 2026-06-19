---
id: blog-slack-qa-bot-with-llm-gateway
slug: slack-qa-bot-with-llm-gateway
date: 2026-06-18
title: "Building a Slack Q&A Bot with LLM Gateway and Chat SDK"
summary: "A walkthrough of our new open-source template: a Slack bot that streams AI answers, keeps thread context, and searches the web — backed by LLM Gateway so you can switch between 280+ models with one API key."
categories: ["Engineering"]
image:
  src: "/blog/slack-qa-bot-with-llm-gateway.png"
  alt: "Building a Slack Q&A Bot with LLM Gateway and Chat SDK"
  width: 1664
  height: 928
---

Most teams already live in Slack. So when someone has a question — "what's the difference between TCP and UDP?", "summarize this thread for me", "what changed in the latest Next.js release?" — the lowest-friction place to ask it is the channel they're already typing in, not a separate tab.

We built a [Slack Q&A bot template](https://github.com/theopenco/llmgateway-templates/tree/main/templates/slack-qa-bot) for exactly that. Mention it, open its assistant pane, or DM it, and it streams an answer back, remembers the thread, and cites its sources. It's open source, and because it routes through LLM Gateway, you can point it at any of 280+ models with a single API key.

This post is a walkthrough of how it works and the decisions behind it.

## Scaffold it in one command

```bash
npx @llmgateway/cli init --template slack-qa-bot
```

The whole bot is about 200 lines of TypeScript across four files:

```
src/
  index.ts            Hono app with HTTP routes
  bot.ts              Chat SDK bot instance and event handlers
  lib/
    ai.ts             LLM Gateway provider + ToolLoopAgent + answer() stream helper
    state.ts          Redis state adapter (subscriptions + locking)
    local.ts          Local dev server entrypoint
```

The stack: [Chat SDK](https://github.com/vercel/chat) for the Slack plumbing, the [AI SDK](https://ai-sdk.dev) for the agent and streaming, the [LLM Gateway provider](https://www.npmjs.com/package/@llmgateway/ai-sdk-provider) for model access, [Hono](https://hono.dev) for the HTTP server, and Redis for state.

## The webhook: one route, no boilerplate

Slack delivers everything — mentions, DMs, assistant events, interactions — to a single webhook. With Chat SDK, the entire HTTP surface is one Hono handler:

```typescript
import { Hono } from "hono";
import { bot } from "./bot.js";

const app = new Hono();

app.get("/", (c) => c.json({ bot: "qa-bot", status: "ok" }));

app.post("/api/webhooks/:platform", (c) => {
  const platform = c.req.param("platform");
  if (platform !== "slack") {
    return c.json({ error: `Unknown platform: ${platform}` }, 404);
  }
  return bot.webhooks.slack(c.req.raw);
});

export default app;
```

`bot.webhooks.slack` handles the parts of Slack integration that are tedious and easy to get subtly wrong: signature verification, the URL verification challenge, event deduplication, and Slack's infamous three-second acknowledgement window. You hand it the raw request and get back a response.

Notice the route is parameterized as `:platform`. That's deliberate — adding Microsoft Teams or Google Chat later means registering another adapter, not rewriting the server.

## The bot: four handlers cover every entry point

The bot itself is a single `Chat` instance with a Slack adapter and a Redis-backed state store:

```typescript
export const bot = new Chat({
  adapters: {
    slack: createSlackAdapter(),
  },
  state,
  userName: "qa-bot",
});
```

From there, four event handlers cover every way a user can reach the bot.

**Channel mentions** subscribe to the thread, then answer:

```typescript
bot.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await respond(thread, message);
});
```

That `thread.subscribe()` call is the key to good conversational UX. After the first mention, the bot keeps answering follow-up messages in that thread without needing to be re-mentioned every time:

```typescript
bot.onSubscribedMessage(async (thread, message) => {
  if (UNSUBSCRIBE_PATTERN.test(message.text)) {
    await thread.unsubscribe();
    await thread.post(
      "Got it — I'll stop following this thread. Mention me anytime.",
    );
    return;
  }
  await respond(thread, message);
});
```

Reply `stop` or `unsubscribe` and the bot leaves. Direct messages are treated as implicit mentions, so they subscribe and answer too. Finally, `onAssistantThreadStarted` wires up Slack's Assistants API with a few suggested prompts so the assistant pane isn't a blank box.

## Context: turn a Slack thread into model messages

An answer is only as good as the context behind it. Before calling the model, the bot pulls recent thread history and converts it into AI SDK messages:

```typescript
const buildPrompt = async (thread, message) => {
  try {
    const { messages } = await thread.adapter.fetchMessages(thread.id, {
      limit: HISTORY_LIMIT,
    });
    const history = await toAiMessages(messages, { includeNames: true });
    if (history.length > 0) {
      return history;
    }
  } catch (error) {
    console.error(
      "Failed to fetch thread history; using latest message",
      error,
    );
  }
  return message.text;
};
```

`toAiMessages` does the unglamorous-but-important work of mapping Slack's message shape onto the AI SDK's `user`/`assistant` role format. `includeNames: true` prefixes each message with the speaker (`[alice]: ...`), so in a busy multi-person thread the model knows who said what. If the history fetch fails for any reason, the bot falls back to the latest message rather than erroring out — a small reliability touch that matters in production.

## Streaming: use `fullStream`, not `textStream`

The model lives in `ai.ts`, built on the AI SDK's `ToolLoopAgent`:

```typescript
export const gateway = createLLMGateway();
export const model = process.env.AI_MODEL ?? "anthropic/claude-sonnet-4-6";

export const agent = new ToolLoopAgent({
  instructions: SYSTEM_PROMPT,
  model: gateway(
    modelId,
    webSearchEnabled ? { extraBody: { web_search: true } } : {},
  ),
});

export const answer = async (prompt: string | AiMessage[]) => {
  const result = await agent.stream({ prompt });
  return result.fullStream;
};
```

`createLLMGateway()` reads `LLM_GATEWAY_API_KEY` from the environment automatically — there's no key handling in your code. The bot then streams the answer straight into Slack:

```typescript
const respond = async (thread, message) => {
  await thread.startTyping();
  try {
    const prompt = await buildPrompt(thread, message);
    await thread.post(await answer(prompt));
  } catch (error) {
    await thread.post(ERROR_MESSAGE);
  }
};
```

One detail worth calling out: `answer()` returns the agent's `fullStream`, not `textStream`. The full stream includes step boundaries, which Chat SDK turns into clean paragraph breaks as it posts into Slack. Pipe the text-only stream instead and a multi-step answer arrives as one undifferentiated wall of text. Chat SDK uses Slack's native streaming where it's available and falls back to post-then-edit elsewhere, so the implementation stays the same across platforms.

## Web search, served by the gateway

The bot can answer questions about current events and recent releases because LLM Gateway runs web search **server-side**. You opt in by setting one flag on the request body:

```typescript
gateway(modelId, { extraBody: { web_search: true } });
```

The provider passes `extraBody` straight through to the gateway, which performs the search and feeds results back to the model — no search API to integrate, no tool to wire up. It's on by default in the template; set `WEB_SEARCH=false` to turn it off.

There's one sharp edge worth documenting honestly. In streaming mode, the provider doesn't forward `url_citation` annotations as AI SDK `source` parts, so `result.sources` comes back empty. Rather than fight that, the system prompt simply asks the model to cite inline as it writes:

> When you rely on web results, cite your sources inline as markdown links, e.g. `[Anthropic](https://anthropic.com)`.

Slack renders those as clickable links, and you get citations without depending on a stream feature that isn't there yet.

## State: subscriptions and locking, both in Redis

Two distinct jobs run through the Redis state adapter, and the second one is easy to forget until it bites you:

```typescript
export const state = createRedisState();
```

The first job is **thread subscriptions** — the set of threads the bot is actively following, which is what makes the no-re-mention follow-ups work. The second is **distributed locking**. On a serverless platform, Slack's retries and multiple warm instances mean the same webhook event can land twice. The lock guarantees that two instances never process the same event in parallel, so users never get a duplicate answer. `createRedisState()` reads `REDIS_URL` and handles both.

## Deploy anywhere

Because the app is a standard Hono `fetch` handler, it deploys to any fetch-compatible runtime — Vercel, Cloudflare Workers, AWS, or your own box. The `local.ts` entrypoint wraps it with `@hono/node-server` for local development only:

```typescript
import { serve } from "@hono/node-server";
import app from "../index.js";

serve({ fetch: app.fetch, port: Number(process.env.PORT) || 3000 });
```

In development, `ngrok http 3000` gives you a public URL to paste into your Slack app's Event Subscriptions, and you're live.

## Why route through a gateway

The default model is `anthropic/claude-sonnet-4-6`, but it's just an environment variable:

```bash
AI_MODEL=openai/gpt-4o
AI_MODEL=google/gemini-2.5-pro
AI_MODEL=anthropic/claude-opus-4-6
```

That single line of indirection is the whole point. The same `LLM_GATEWAY_API_KEY` reaches every provider, so swapping models is a config change, not a code change or a new vendor contract. You get one bill, one place to watch spend and latency, and built-in [failover](/blog/how-we-handle-llm-provider-failover) if a provider has a bad day. For a bot that a whole team will lean on, being able to chase the best price-performance model without touching the deploy is exactly the kind of leverage a gateway is for.

## One bot, many platforms

Chat SDK's adapters mean the same four handlers can answer on Microsoft Teams, Google Chat, Discord, or Telegram. You register another adapter and extend the webhook route — the answering logic doesn't change:

```typescript
export const bot = new Chat({
  adapters: {
    slack: createSlackAdapter(),
    teams: createTeamsAdapter(),
    gchat: createGoogleChatAdapter(),
  },
  state,
  userName: "qa-bot",
});
```

## Try it

The template is open source and ships with tests, a Slack manifest for one-click app setup, and a Vercel deploy button.

```bash
npx @llmgateway/cli init --template slack-qa-bot
```

Grab an [LLM Gateway API key](https://llmgateway.io), point `AI_MODEL` at whatever you want to try first, and you'll have a question-answering bot in your workspace in a few minutes. Browse the [rest of the templates](https://github.com/theopenco/llmgateway-templates) for more ways to build on LLM Gateway.
