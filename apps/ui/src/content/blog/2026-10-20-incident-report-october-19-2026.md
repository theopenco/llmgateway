---
id: "blog-incident-report-october-19-2026"
slug: "incident-report-october-19-2026"
date: "2026-10-20"
title: "Incident Report: LLM Gateway Outage on October 19, 2026"
summary: "On October 19, 2026, from 18:24 to 19:12 UTC, the LLM Gateway dashboard and API were down and the gateway was partially degraded. This incident report covers what customers saw, the timeline, the root cause, why recovery took as long as it did, and what we are changing."
categories: ["Engineering"]
faqs:
  - question: "What caused the LLM Gateway outage on October 19, 2026?"
    answer: "A routine database migration that added columns had to wait for a lock on our organization table, because queries from the dashboard's request log view had been running and holding it since that morning. While the migration waited, other queries queued behind it, health checks restarted our API servers in a loop, and the database ran out of connections. Restarting the database cleared the stuck sessions and restored service."
  - question: "Which services were affected?"
    answer: "From 18:24 to 19:12 UTC the dashboard and the API behind it were down. The gateway at api.llmgateway.io kept serving most requests, but requests that needed an API key or organization settings not already in cache failed."
  - question: "What is LLM Gateway changing after the incident?"
    answer: "Dashboard log queries will be bounded so they cannot hold locks for long, migrations will give up quickly instead of waiting on locks and will run as a separate deploy step, health checks will no longer restart servers because the database is slow, the gateway will keep serving cached keys when the database is unavailable, and new alerts will page us within minutes."
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
| 10:54 | Several long-running request log queries from the dashboard started, holding a lock on the organization table.               |
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

## Root cause: a routine migration blocked by long-running queries

The change added new columns to two tables, one of them the table that holds organization settings. It was a routine schema change. In Postgres, adding a nullable column, or one with a constant default, only updates the table definition and normally finishes in milliseconds. It does need a brief exclusive lock on the table, and to get that lock it has to wait for queries already using the table to finish.

The migration could not get its locks because of certain dashboard request log queries that had started at about 10:54 UTC, more than seven hours earlier. For these queries, Postgres chose a plan that walked the entire log table newest-first looking for a few matching rows, instead of using the per-project index. They ran for over seven hours and held their lock on the organization table the whole time. Nothing stopped them, because we had no statement timeout on those queries. The migration had no lock timeout, so instead of giving up, it waited, and until its transaction finished, every new query on the organization table queued behind it. Nearly every dashboard, API and uncached gateway request reads organization settings, so they all stopped.

On any other day this migration would have finished within a second. With a lock timeout, it would have failed after a few seconds and left the dashboard and API running.

Three things turned a blocked migration into an outage:

1. **Health checks restarted the migration over and over.** Our API servers run pending migrations on startup, before they begin serving. The server running the migration was not answering its health check, so it was killed and restarted about every 75 seconds. Each restart started the migration again and queued it behind the same locks.
2. **Health checks restarted the healthy servers too.** The API health check queries the database. On the servers that were already running, those queries were stuck in the same queue, so the health checks failed and those servers were restarted about every two minutes as well.
3. **Restarted servers left their connections behind.** When a server was killed, the queries it had waiting stayed open on the database, because the database was not set up to notice that the client was gone. Each restart leaked more, and the connection count climbed steadily from 18:25 until every slot was in use at 19:03.

Restarting the database at 19:07 ended every stuck session, released the locks, and let the rolled-back servers connect. Service was healthy by 19:12.

## Why recovery took 48 minutes

- **Reverting the code did not release the database.** The stuck sessions and lock queue lived inside Postgres. Rolling the deploy back stopped new migration attempts but did not clear what was already waiting. The rolled-back servers came up at 19:01 into a database that was almost out of connections, and could not connect.
- **Our deploy tooling does not roll back on its own.** It waits for a deploy to become healthy, but when that times out, a person has to roll back by hand.
- **Our monitoring was slow to page.** The gateway uptime check does not touch the database, so it stayed green while uncached requests failed. Our paging alerts for the API and gateway were set to wait out long stretches of failure before paging anyone.
- **We could not see the blocker quickly.** Nothing alerted on queries that had been running for hours, the database was not logging lock waits, and our services did not label their database connections, so finding the session the migration was waiting on took longer than it should have. Once connections ran out, we restarted the database to clear them.
- **Warning signs did not page anyone.** The database had been running unusually hot for more than an hour before the migration started. The long-running queries also held their snapshot open, which blocked routine cleanup (vacuum) for about eight hours. That likely contributed to the load, and neither signal paged anyone.

## What we're changing

### Shipped

These changes are live in production as of October 20, 2026.

- **Bounded log queries.** The request log queries behind the dashboard and API run read-only with short statement and lock timeouts, a limit on how many can run at once per user and per organization, and a default time range, and the log scan no longer joins other tables. A query like the ones that blocked this migration is now stopped by its statement timeout within seconds.
- **Migrations give up fast.** Each migration runs in its own transaction with a 5 second lock timeout and a statement timeout, and retries with backoff. A migration that cannot get its locks fails cleanly and leaves nothing half-applied, instead of blocking the table.
- **A preflight check before migrations run.** It refuses to run if a pending migration touches a table with a long-running transaction open, and names the session that is blocking it. It also requires new indexes on production to be built ahead of time without locking the table.
- **CI checks for risky migrations.** Lint rules flag migration patterns that take long locks on large tables, a test holds a lock in another session and asserts that the migration fails fast and applies nothing, and migration changes need review from database owners.
- **Session timeouts and labels.** Every database session from our services has a lock timeout and an idle-in-transaction timeout, and carries the name of the service and server that opened it, so we can see a blocking session right away. Services also report how full their connection pools are.
- **The gateway keeps serving when the database does not answer.** It serves API keys and provider settings from cache when the database errors, never caches a failed lookup, and fails fast with a circuit breaker instead of waiting 10 seconds per request.
- **Health endpoints that match what customers see.** Our servers expose a liveness endpoint that only confirms the process is running, ready for our deployments to switch to, and the gateway exposes a deep health check that exercises the database and cache.
- **Public statistics from a shared cache.** Heavy public statistics pages are served from a shared cache, so a burst of unauthenticated traffic cannot fan out into expensive database queries.

### In progress

These need changes to our infrastructure and database configuration, and will land after review.

- **Migrations run as their own deploy step.** They will run once, as a dedicated step before the new version rolls out, instead of inside API server startup where a health check can kill and retry them.
- **Health checks will not restart servers for a slow database.** Our deployments will switch liveness to the process-only check. Database checks move to readiness, which takes a server out of rotation without killing it.
- **Automatic rollback.** Our deploy tooling will roll back on its own when a deploy does not become healthy in time, and notify the team.
- **Statement timeouts everywhere.** Every service will get a statement timeout sized to its workload, with a database-wide default as a backstop.
- **Faster paging.** Uptime alerts will page within a few minutes when at least two of our three check regions see failures. New pages will fire when database connection usage stays at or above 70% for 5 minutes, both in each service's connection pool and on the database server, and when database CPU stays above 90%. Others cover the deep gateway health check, connection pool timeouts, repeated API restarts, failed or slow migrations, and a synthetic completion request every 5 minutes that needs the database.
- **Database settings.** The database will drop sessions whose client has disconnected, so a restarted server cannot leak connections. It will log lock waits and slow queries, and keep connection slots reserved so engineers can always connect, even when applications have used up the rest.
- **A sturdier database setup.** We will move the database to a high-availability configuration with connection pooling in front of it.
- **Safer rollout of schema changes.** Risky migrations will be labeled, deployed on their own, and split into backwards-compatible steps.
- **A runbook and a second escalation level.** The runbook covers finding and ending the blocking session, pausing deploys, and restarting the database only as a last resort. A second on-call level with full infrastructure access will back up the first.

**Update (2026-10-20):** the first set of fixes, listed under "Shipped", is live in production. The items under "In progress" will follow, and we will update this post as each lands.

## We're sorry

For 48 minutes you could not reach your dashboard, and some of your production requests failed. That is on us. Thank you for your patience while we recovered, and for trusting us with your traffic. If this incident affected you and you want to talk it through, reach us at [contact@llmgateway.io](mailto:contact@llmgateway.io).

---

- **[LLM Gateway status page](https://status.llmgateway.io/)**
- **[How we handle LLM provider failover at scale](/blog/how-we-handle-llm-provider-failover)**
