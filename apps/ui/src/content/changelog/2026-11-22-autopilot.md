---
id: "126"
slug: "autopilot"
date: "2026-11-22"
title: "Autopilot for the Dashboard"
summary: "Ask the dashboard where something is, or tell it to do it, by text or voice. Autopilot opens the page and points at the control, and every change it makes waits for your approval. Available to owners and admins of organizations with a credit balance."
tags: ["llmgateway"]
image:
  src: "/changelog/autopilot.png"
  alt: "A circuit board with a glowing glass control dock on the central chip showing a voice waveform, surrounded by a microphone, a compass, a key, an approval shield and a cursor, representing an assistant that navigates and acts in the dashboard"
  width: 1536
  height: 1024
---

The dashboard has dozens of pages, and finding the one setting you need usually means knowing where it lives. Now you can ask. **Autopilot** is an assistant docked at the bottom of the dashboard: tell it what you are looking for and it takes you there, or tell it what you want done and it does it, after you approve.

<video src="/changelog/autopilot-demo.webm" poster="/changelog/autopilot.png" controls playsinline preload="metadata" style="width: 100%; border-radius: 12px; margin: 1.5rem 0;">
</video>

## Ask Where, or Ask It to Do It

Open Autopilot from the pill at the bottom of any dashboard page, or press <kbd>⌘J</kbd> (<kbd>Ctrl+J</kbd> on Windows and Linux).

| You say                               | Autopilot does                                              |
| ------------------------------------- | ----------------------------------------------------------- |
| "Where do I add a provider key?"      | Opens the page and spotlights the button                    |
| "Where do I invite a teammate?"       | Reads the page to find the right control, then points at it |
| "How many credits do I have left?"    | Answers from your organization's balance                    |
| "Create an API key called Production" | Opens the API Keys page and asks you to approve the new key |
| "Create a project called Mobile App"  | Asks you to approve, then creates it                        |

## Type It or Say It

Select the microphone and speak. Recording stops on its own when you stop talking, and replies to spoken requests are read aloud. The glow around the dock shows what Autopilot is doing: listening, thinking, working, or waiting for your approval.

## Every Change Waits for You

Navigating, pointing and reading never ask for anything. A request that changes data stops at an approval dialog that shows exactly what is about to change:

- **Approve** and it runs with your own session, so it can only do what your role allows.
- **Deny** and nothing changes.
- **A new API key's secret is shown once, to you.** It is never sent to the model.

## Built on WebMCP

Each dashboard page describes what it can do as [WebMCP](https://webmachinelearning.github.io/webmcp/) tools on `document.modelContext`, and Autopilot uses the tools of the page that is open. Browser agents that support WebMCP see the same tools, with the same approval rule for anything that is not read-only.

## Availability and Billing

Autopilot appears for **owners and admins of organizations with a credit balance**, on every plan. Its model and transcription requests are billed to those credits like any other gateway request, through a managed **Autopilot** API key in the current project, so they show up in your usage alongside everything else.

---

**[Autopilot guide →](https://docs.llmgateway.io/learn/autopilot)** | **[Open your dashboard →](https://llmgateway.io/dashboard)**
