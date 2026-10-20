---
id: "115"
slug: "api-key-management"
date: "2026-10-20"
title: "Bulk API Key Management and Insights"
summary: "Manage every API key in your organization from one page, deactivate, reactivate, or delete keys in bulk, see usage for the last 24 hours to 90 days, get warned about keys that have not been used in 30 or 90 days, and cap low-use keys with a one-click spend limit suggestion."
tags: ["llmgateway"]
image:
  src: "/changelog/api-key-management.png"
  alt: "A glowing key ring on a central circuit-board chip, with most keys lit teal and two dimmed amber, surrounded by checkbox, calendar, bar chart, and power switch icons, representing bulk API key management and unused-key insights on LLM Gateway"
  width: 1536
  height: 1024
---

Keys pile up. Old CI jobs, finished demos, and departed teammates leave keys that still authenticate, and cleaning them up meant opening each project and deactivating keys one at a time, with only an all-time usage number to tell whether a key was still in use. The API Keys page now shows **how recently every key was used**, flags the ones that look abandoned, suggests spend limits for keys that have none, and lets you act on many keys at once.

## Every key in one place

**Organization → API Keys** lists the keys of every project in the organization in one table, with a project column and filter. Owners and admins can create keys for any project from the same page. The project API Keys page keeps working as before and shares all the features below.

## Usage for the period you care about

A period selector switches the usage column between **All time** (the default), **Last 24 hours**, **Last 7 days**, **Last 30 days**, and **Last 90 days**, and shows the request count for the period. A new **Last Used** column shows when each key last served a request. Limits keep measuring against all-time and current-window spend.

## Unused key warnings

| Idle for                  | Badge                               |
| ------------------------- | ----------------------------------- |
| 30+ days                  | Amber                               |
| 90+ days                  | Red                                 |
| Never used (30+ days old) | Amber or red, counted from creation |

A banner above the list counts the unused active keys and selects them in one click, so deactivating forgotten keys takes seconds.

## Spend limit suggestions

A low-use key with no spend limit is an easy target if it leaks. Active keys that have spent under $250 and have no limit now show a subtle **Suggest** hint sized to their all-time spend:

| All-time spend | Suggested cap  |
| -------------- | -------------- |
| Under $1       | $10 per week   |
| $1 to $10      | $25 per week   |
| $10 to $50     | $100 per week  |
| $50 to $250    | $500 per month |

Each cap is at least twice the key's all-time spend, so it never blocks traffic the key already sends. Click the hint, then **Set**, to apply it; the confirmation offers **Undo**, and the limit stays editable like any other. Playground keys, unused keys, and keys whose creator has a capped member budget get no suggestion.

## Bulk deactivate, reactivate, and delete

Tick keys, or use the header checkbox to select the current page and then **Select all keys in this view** to include every key matching your filters. Every bulk action asks for confirmation and reports which keys it skipped and why:

- **Reactivate** skips keys whose expiration has passed and stops at your organization's active key limit
- **Delete** is permanent
- Developers can only act on keys they created

Changes apply to the gateway immediately.

---

**[Open your dashboard →](https://llmgateway.io/dashboard)** | **[Read the API Keys docs →](https://docs.llmgateway.io/learn/api-keys)**
