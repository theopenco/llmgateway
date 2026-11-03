---
id: "120"
slug: "organization-projects-view"
date: "2026-11-03"
title: "Every Project on One Page"
summary: "The new organization Projects page shows each project's daily traffic, spend, error rate and last activity as a card, finds idle and never-used projects, and edits or archives several projects in one step."
tags: ["llmgateway"]
image:
  src: "/changelog/organization-projects-view.png"
  alt: "The LLM Gateway Projects page: summary tiles, activity filters and project cards with request sparklines, one of them selected for bulk actions"
  width: 1536
  height: 1024
---

An organization with twenty projects had no single place to see which of them still get traffic. You opened each project's dashboard to check, and cleaning up meant one settings page per project. The new **Projects** page, in the organization section of the sidebar, puts every project on one screen.

## See which projects are busy and which have gone quiet

Each project is a card with a daily request sparkline for the last 7, 30 or 90 days, plus requests, spend, error rate, last activity, routing strategy and API key count. Summary tiles at the top add up projects, active projects, requests and spend across the organization.

| Filter         | Shows projects that                                   |
| -------------- | ----------------------------------------------------- |
| **Active**     | Served at least one request in the selected period    |
| **Idle**       | Have older traffic but nothing in the selected period |
| **Never used** | Have never served a request                           |

Search by name or ID, and sort by requests, spend, most recent activity, name or creation date.

## Edit or archive several projects at once

Select cards, or **Select all** for the current filter, then:

- **Edit settings** changes billing mode, response caching or routing strategy on every selected project. Only the fields you change are applied, and projects that already match are skipped.
- **Archive** removes the selected projects from the project selector and stops their API keys. Usage history and logs are kept. Archiving is limited to organization owners.

Both actions report the outcome per project and add an audit log entry for each one. Developers with project-scoped access see only the projects they were granted, with usage from their own API keys.

---

**[Projects page guide →](https://docs.llmgateway.io/learn/projects)** | **[Open your dashboard →](https://llmgateway.io/dashboard)**
