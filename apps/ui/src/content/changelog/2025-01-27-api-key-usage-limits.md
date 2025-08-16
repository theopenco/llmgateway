---
id: "13"
slug: "api-key-usage-limits"
date: "2025-08-11"
title: "API Key Usage Limits & Credit Controls"
summary: "Set individual credit limits for API keys to better control spending and prevent unexpected overages."
image:
  src: "/changelog/api-key-usage-limits.png"
  alt: "API Keys dashboard showing usage limits and credit controls"
  width: 1768
  height: 677
---

We're excited to introduce **API Key Usage Limits**, giving you granular control over spending by setting individual credit limits for each API key in your project.

## 🎯 Key Features

**Individual Credit Limits**: Set specific spending limits for each API key to prevent unexpected overages and maintain budget control.

**Flexible Controls**: Leave limits empty for unrestricted usage, or set precise dollar amounts to match your budget requirements.

**Real-time Updates**: Usage limits are enforced in real-time - when a key reaches its limit, requests using that key will return an error.

## 💰 How It Works

**Dashboard View**: Your API Keys table now displays current usage alongside configurable usage limits, making it easy to monitor spending at a glance.

**Quick Editing**: Click the edit button next to any usage limit to modify the credit limit for that specific API key.

**Smart Defaults**: New API keys can be created with or without limits, and existing keys default to "No limit" for backward compatibility.

## 🔧 Setting Usage Limits

1. Navigate to your **API Keys** section in the dashboard
   ![API keys dashboard](/changelog/api-key-usage-limits-step-1.png)

2. Locate the API key you want to limit
3. Click the edit button in the "Usage Limit" column
   ![API keys edit](/changelog/api-key-usage-limits-step-2.png)

4. Enter your desired credit limit (e.g., $10.00) or leave empty for no limit
   ![API keys limit dialog](/changelog/api-key-usage-limits-step-3.png)
5. Click "Save changes" to apply the limit

Usage includes both costs from LLM Gateway credits and usage from your own provider keys when applicable, giving you complete visibility into total spending per key.

---

This feature helps teams and individuals maintain better cost control and prevents accidental overspending while maintaining the flexibility to adjust limits as needs change.
