---
id: "blog-incident-report-october-19-2026"
slug: "incident-report-october-19-2026"
date: "2026-10-20"
title: "Incident Report: LLM Gateway Outage on October 19, 2026"
summary: "On October 19, 2026, from 18:24 to 19:12 UTC, the LLM Gateway dashboard and API were down and the gateway was partially degraded. This incident report covers what customers saw, the timeline, the root cause, why recovery took as long as it did, and what we are changing."
categories: ["Engineering"]
faqs:
  - question: "What caused the LLM Gateway outage on October 19, 2026?"
    answer: "A database migration shipped with a deploy had to wait for table locks. While it waited, other queries queued behind it, health checks restarted our API servers in a loop, and the database ran out of connections. Restarting the database cleared the stuck sessions and restored service."
  - question: "Which services were affected?"
    answer: "From 18:24 to 19:12 UTC the dashboard and the API behind it were down. The gateway at api.llmgateway.io kept serving most requests, but requests that needed an API key or organization settings not already in cache failed."
  - question: "What is LLM Gateway changing after the incident?"
    answer: "Migrations will give up quickly instead of waiting on locks and will run as a separate deploy step, health checks will no longer restart servers because the database is slow, the gateway will keep serving cached keys when the database is unavailable, and new alerts will page us within minutes."
image:
  src: "/blog/incident-report-october-19-2026.png"
  alt: "A glowing database cylinder with a restored heartbeat line on a central chip, surrounded by an open padlock, a stopwatch, a heart monitor and a shield with a checkmark, representing the October 19, 2026 LLM Gateway incident report"
  width: 1536
  height: 1024
---

On Monday, October 19, 2026, the **LLM Gateway** dashboard and API were down for about 48 minutes, from 18:24 to 19:12 UTC. During the same window the gateway was partially degraded: requests that needed data not already in cache failed.

This incident report explains what happened, why it took as long as it did to recover, and what we are changing so it does not happen again. We are sorry. Many of you run production traffic through us, and an outage like this is not acceptable.

## Customer impact

- **Dashboard and API: down.** The dashboard at llmgateway.io and the API behind it returned errors or timed out for the whole window. Signing in, managing API keys, viewing usage and changing settings did not work.
- **Gateway: partially degraded.** The gateway at `https://api.llmgateway.io/v1/...` kept serving requests whose API key and organization settings were already in cache. Requests that needed a database lookup, such as a newly created key or one that had not been used recently, waited about 10 seconds and then failed. These requests returned a 5xx error before reaching a model provider, so they were not billed.

All times below are UTC.

## Timeline

| Time  | Event                                                                                                                        |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| 18:12 | A change that included a database migration was merged.                                                                      |
| 18:21 | The deploy carrying it started.                                                                                              |
| 18:24 | The migration started and began waiting for table locks. The dashboard, the API and uncached gateway requests began failing. |
| 18:26 | API servers started failing health checks and being restarted in a loop.                                                     |
| 18:46 | We reverted the change.                                                                                                      |
| 18:48 | We started a manual rollback deploy.                                                                                         |
| 19:01 | The rolled-back API servers came up.                                                                                         |
| 19:03 | The database ran out of connection slots, and the rolled-back servers could not connect.                                     |
| 19:07 | We restarted the database.                                                                                                   |
| 19:12 | All services were healthy.                                                                                                   |

## Root cause: a migration waiting on table locks

The change added new columns to two tables, one of them the table that holds organization settings. In Postgres, adding a column needs a brief exclusive lock on the table. All three column changes ran in a single transaction, so the migration had to hold or wait for locks on both tables at once.

The migration could not get its locks because another session was already using one of the tables. We are still confirming exactly which query that was. The migration had no lock timeout, so instead of giving up, it waited, and until its transaction finished, every new query on the organization table queued behind it. Nearly every dashboard, API and uncached gateway request reads organization settings, so they all stopped.

Three things turned a stuck migration into an outage:

1. **Health checks restarted the migration over and over.** Our API servers run pending migrations on startup, before they begin serving. The server running the migration was not answering its health check, so it was killed and restarted about every 75 seconds. Each restart started the migration again and queued it behind the same locks.
2. **Health checks restarted the healthy servers too.** The API health check queries the database. On the servers that were already running, those queries were stuck in the same queue, so the health checks failed and those servers were restarted about every two minutes as well.
3. **Restarted servers left their connections behind.** When a server was killed, the queries it had waiting stayed open on the database, because the database was not set up to notice that the client was gone. Each restart leaked connections. At 19:03, with the rollback deploy adding new servers, the database ran out of connection slots entirely.

Restarting the database at 19:07 ended every stuck session, released the locks, and let the rolled-back servers connect. Service was healthy by 19:12.

## Why recovery took 48 minutes

- **Reverting the code did not release the database.** The stuck sessions and lock queue lived inside Postgres. Rolling the deploy back stopped new migration attempts but did not clear what was already waiting, and the rollback itself added connections at the worst moment.
- **Our deploy tooling does not roll back on its own.** It waits for a deploy to become healthy, but when that times out, a person has to roll back by hand.
- **Our monitoring was slow to page.** The gateway uptime check does not touch the database, so it stayed green while uncached requests failed. Our paging alerts for the API and gateway were set to wait out long stretches of failure before paging anyone.
- **We could not see the blocker quickly.** The database was not logging lock waits, and our services did not label their database connections, so finding the session the migration was waiting on took longer than it should have. Once connections ran out, we restarted the database to clear them.

## What we're changing

### Preventing stuck migrations

- **Migrations give up fast.** Each migration will run in its own transaction with a 5 second lock timeout and a statement timeout, and retry with backoff. A migration that cannot get its locks fails cleanly and leaves nothing half-applied, instead of blocking the table.
- **A preflight check before migrations run.** It refuses to run if a pending migration touches a table with a long-running transaction open, and names the session that is blocking it. It also requires new indexes on production to be built ahead of time without locking the table.
- **CI checks for risky migrations.** Lint rules flag migration patterns that take long locks on large tables, and a test holds a lock in another session and asserts that the migration fails fast and applies nothing.
- **Migrations run as their own deploy step.** They will run once, as a dedicated step before the new version rolls out, instead of inside API server startup where a health check can kill and retry them.
- **Database timeouts on every connection.** Our services will set statement, lock and idle-in-transaction timeouts on their database sessions, and the database will drop sessions whose client has disconnected, so a restarted server cannot leak connections.
- **Safer rollout of schema changes.** Risky migrations are labeled, deployed on their own, and split into backwards-compatible steps.

### Detecting and paging faster

- **Uptime alerts page within a few minutes** when at least two of our three check regions see failures.
- **A deep gateway health check** that exercises the database and cache, so monitoring sees what uncached requests see.
- **New pages** for database connection pool timeouts, database connection count, repeated API restarts, failed or slow migrations, and a synthetic completion request every 5 minutes that needs the database.
- **Better visibility during an incident.** The database will log lock waits and slow queries, and every connection will carry the name of the service and server that opened it, so we can see a blocking session right away.

### Recovering faster

- **Health checks will not restart servers for a slow database.** The liveness check will only confirm the process is running. Database checks move to readiness, which takes a server out of rotation without killing it.
- **The gateway keeps serving when the database does not answer.** It will serve API keys and provider settings from cache when the database errors, never cache a failed lookup, and fail fast with a circuit breaker instead of waiting 10 seconds per request.
- **Automatic rollback.** Our deploy tooling will roll back on its own when a deploy does not become healthy in time, and notify the team.
- **Reserved access for responders.** The database will keep connection slots reserved so engineers can always connect, even when applications have used up the rest.
- **A runbook and a second escalation level.** The runbook covers finding and ending the blocking session, pausing deploys, and restarting the database only as a last resort. A second on-call level with full infrastructure access backs up the first.
- **A sturdier database setup.** We are moving the database to a high-availability configuration with connection pooling in front of it.

We will post an update here as these changes land.

## We're sorry

For 48 minutes you could not reach your dashboard, and some of your production requests failed. That is on us. Thank you for your patience while we recovered, and for trusting us with your traffic. If this incident affected you and you want to talk it through, reach us at [contact@llmgateway.io](mailto:contact@llmgateway.io).

---

- **[LLM Gateway status page](https://status.llmgateway.io/)**
- **[How we handle LLM provider failover at scale](/blog/how-we-handle-llm-provider-failover)**
