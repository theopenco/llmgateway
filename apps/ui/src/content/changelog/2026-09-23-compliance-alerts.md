---
id: "103"
slug: "compliance-alerts"
date: "2026-09-23"
title: "Compliance Alerts"
summary: "Watch models your compliance policy blocks today and get told the moment a provider that meets your requirements starts serving them — in-app, by email, or in Slack. Downgrade alerts fire when a provider stops meeting the policy. Available on the Enterprise plan."
image:
  src: "/changelog/compliance-alerts.png"
  alt: "A glowing bell on a circuit-board chip surrounded by shield and certificate icons, representing compliance alerts on LLM Gateway"
  width: 1536
  height: 1024
---

When your organization enforces a provider compliance policy, a popular model
is often unusable for months — not because the model is missing, but because
nobody serving it meets your requirements yet. Until now the only way to find
out that changed was to re-check the Models page by hand. **Compliance alerts**
watch the models you care about and tell you the moment one becomes routable
under your policy.

## Watch the models you are waiting on

Open **Compliance** in the dashboard, pick models the policy currently blocks,
and LLM Gateway evaluates them against your saved policy every minute. When a
provider that meets your requirements starts serving one, recipients get a
single alert naming the providers it can now route through. If that model later
loses its last compliant provider, the watch re-arms so the next opening is
announced again.

The same checks run in the other direction. If a provider stops meeting your
policy — a certification lapses, or it starts training on API data — a
downgrade alert names the failed requirements, and for owners and admins it
lists the models your organization ran on that provider in the last 30 days
that no longer have a compliant alternative. Editing your own policy never
triggers a downgrade alert, so tightening a requirement stays quiet.

## Choose who hears about it, and where

| Setting    | Options                                                                              |
| ---------- | ------------------------------------------------------------------------------------ |
| Recipients | Owners only, owners and admins, or everyone — each level includes the roles above it |
| In-app     | The dashboard notification bell, per recipient                                       |
| Email      | Per recipient, to verified addresses only                                            |
| Slack      | One post per organization, to an incoming webhook you save once                      |

Slack is configured under **Preferences → Notification Channels**: paste the
incoming webhook, send a test message, then switch Slack on. The URL is stored
encrypted and only ever shown masked.

Each person can still turn in-app or email delivery off for their own account
from the bell's notification settings, without changing what the rest of the
team receives.

Compliance alerts are available on the **Enterprise plan**, alongside the
provider compliance policy itself. Owners and admins configure them; an
organization can watch up to 100 models.

---

**[Compliance alerts docs →](https://docs.llmgateway.io/features/compliance)** | **[Review your compliance policy →](https://llmgateway.io/dashboard)**
