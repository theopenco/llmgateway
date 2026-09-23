---
id: "blog-compliance-alerts"
slug: "compliance-alerts"
date: "2026-09-23"
title: "Compliance Alerts for Blocked AI Models"
summary: "Compliance alerts watch the models your provider compliance policy blocks today and notify your team the moment a provider that meets your requirements starts serving one — in-app, by email, or in Slack. Downgrade alerts fire when a provider stops meeting the policy. Available on the Enterprise plan."
categories: ["Announcements", "Product"]
faqs:
  - question: "How do I know when a blocked model becomes compliant?"
    answer: "Watch the model on the Compliance page in the LLM Gateway dashboard. Every minute, the gateway re-evaluates each watched model against your saved provider compliance policy, and sends one alert as soon as a provider that meets your requirements serves it. The alert names the compliant providers, so you can route to it immediately."
  - question: "Who receives compliance alerts?"
    answer: "You pick the lowest organization role that receives them: owners only, owners and admins, or everyone in the organization. Each level includes the roles above it, so membership changes take effect automatically without editing a recipient list. Individual recipients can turn in-app or email delivery off for their own account."
  - question: "Can compliance alerts go to Slack?"
    answer: "Yes. Save a Slack incoming webhook under Notification Channels on the organization Preferences page, send a test message, and enable Slack in the alert settings. Slack receives one post per organization, while in-app and email are delivered per recipient. The webhook URL is stored encrypted and only shown masked."
  - question: "What happens if a provider loses a certification?"
    answer: "A downgrade alert fires. It names the requirements the provider now fails, and for owners and admins it lists the models your organization used on that provider in the last 30 days that no longer have a compliant alternative. Changes you make to your own policy never trigger downgrade alerts."
image:
  src: "/blog/compliance-alerts.png"
  alt: "Glossy circuit board with a glowing notification bell on a central chip, surrounded by shield, certificate, padlock and envelope icons representing compliance alerts"
  width: 1536
  height: 1024
---

A new model lands, your team wants it, and the answer is no — not because the
model is unavailable, but because no provider serving it meets your compliance
requirements. No training on prompts. SOC 2 Type 2 or ISO 27001. Headquarters
in an approved country. Weeks later a provider that does meet all three quietly
starts serving that model, and nobody notices, because the only way to find out
was for someone to re-open the Models page and check by hand.

**Compliance alerts** close that gap. Pick the models your policy blocks today,
and **LLM Gateway** tells your team the moment one becomes routable under your
[provider compliance policy](https://docs.llmgateway.io/features/compliance).

## Watch the models your policy blocks

On the Compliance page, the model picker only offers models your saved policy
currently blocks — the ones worth waiting for. Every minute, each watched model
is re-evaluated against that policy, and the first time a compliant provider
serves it, recipients get one alert naming the providers it can now route
through.

The check is a live evaluation, not a catalogue diff. That matters, because a
model becomes usable for several different reasons:

| What changed                                  | What you see                             |
| --------------------------------------------- | ---------------------------------------- |
| A compliant provider starts serving the model | "now available under your policy"        |
| An existing provider earns a certification    | Same alert, no catalogue change involved |
| You relax a requirement yourself              | Same alert, so the team hears about it   |
| The model loses its last compliant provider   | The watch re-arms for the next opening   |

Because it is evaluated rather than diffed, a watch survives the messy cases:
providers added and removed, regional variants, and models that briefly appear
and disappear.

## Hear about downgrades too

Compliance moves in both directions. When a provider stops meeting your policy
— a certification lapses, or its data policy changes to allow training on API
data — routing silently narrows. A downgrade alert names the failed
requirements, and for owners and admins it lists the models your organization
ran on that provider in the last 30 days that no longer have a compliant
alternative, so you know what to migrate before someone's request 403s.

Edits to your own policy never trigger downgrade alerts. Tightening a
requirement is a decision you already made; only a change on the provider's
side is news.

## Recipients by role, not by checkbox

Instead of ticking individual people — unworkable once an org has dozens of
members — you choose the lowest role that should hear about it:

| Audience                     | Who receives alerts                         |
| ---------------------------- | ------------------------------------------- |
| Owners only                  | Organization owners                         |
| Owners and admins (default)  | Owners and admins                           |
| Everyone in the organization | All members, including project-scoped roles |

Each level includes the roles above it, and membership is resolved when the
alert fires, so new hires and role changes are picked up without anyone
revisiting the settings. Individual recipients can still turn off in-app or
email delivery for their own account from the notification bell.

## Delivery: in-app, email, and Slack

In-app and email alerts go to each recipient; email only ever goes to verified
addresses. Slack is org-wide: save an incoming webhook once under **Preferences
→ Notification Channels**, send a test message to confirm it, then enable Slack
in the alert settings. Slack receives one post per event no matter how large
the audience, which makes it the right channel for a shared
`#ai-platform` room.

The webhook URL is stored encrypted and only ever displayed masked, and only
`https://hooks.slack.com/services/…` URLs are accepted.

## Getting started

1. Enable a [provider compliance policy](https://docs.llmgateway.io/features/compliance) on the Compliance page — requirements, allowed headquarters countries, and any provider or model restrictions.
2. Scroll to **Compliance Alerts** and watch the models you are waiting on. The first watch saves the defaults: owners and admins, in-app and email, downgrade alerts on.
3. Optionally connect Slack, then adjust the audience.

Compliance alerts are available on the **Enterprise plan**, alongside the
compliance policy itself. Owners and admins configure them, every change is
recorded in the [audit log](https://docs.llmgateway.io/features/audit-logs), and
an organization can watch up to 100 models.

---

- **[Try LLM Gateway free](https://llmgateway.io/signup)**
- **[Compliance alerts documentation](https://docs.llmgateway.io/features/compliance)**
- **[The LLM compliance checklist](/blog/llm-compliance-checklist)**
