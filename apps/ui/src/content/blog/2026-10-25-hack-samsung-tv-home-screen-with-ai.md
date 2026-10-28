---
id: "blog-hack-samsung-tv-home-screen-with-ai"
slug: "hack-samsung-tv-home-screen-with-ai"
author:
  name: "Ismail Ghallou"
  url: "https://smakosh.com"
date: "2026-10-25"
title: "Hack Your Samsung TV: Replace Smart Hub With an AI Agent"
summary: "How to hack a Samsung Tizen TV so the Home button opens your own Apple TV-style launcher instead of Smart Hub: the sdb and vconf trick that makes it work, what cannot be removed on retail firmware, the $174 and 2,306 model calls it took, and a prompt you can paste into any coding agent with an LLM Gateway key."
categories: ["Guides", "Engineering"]
faqs:
  - question: "Can I hack my Samsung TV to remove Smart Hub?"
    answer: "You cannot uninstall Smart Hub or any preinstalled Samsung app on retail Tizen firmware: sdb uninstall returns error 132 because they are signed system packages on a read-only partition. What you can do is install your own launcher as a Tizen web app and point the Home button at it by writing the vconf key db/appfw/home_appid, which is possible through a backtick-expansion quirk in the package installer. Promotion and telemetry processes can be killed, but they return on every reboot."
  - question: "Does this work on Android TV, Google TV, LG webOS or Fire TV?"
    answer: "No. This guide is for Samsung TVs running Tizen from roughly 2020 onward. Tizen has no adb, no package manager you can uninstall from, and no third-party launcher concept; it exposes sdb and a remote-control REST API on port 8001. For Android-based sets, debloating and installing a custom launcher is a different and much shorter project."
  - question: "How much did it cost to hack the TV with an AI agent?"
    answer: "$173.85 across 2,306 model calls over two days, about 14 hours of active agent time. Claude Opus 5.5 did the building (1,242 calls, $118.51) and Claude Fable 5.1 reviewed plans ($48.58). The other 920 calls, $6.76 in total, went through LLM Gateway: 893 calls to DeepSeek V4.1 Flash for cheap lookups ($3.53), Gemini 3.1 Flash Lite for web lookups ($0.21), and two GPT-6 second opinions ($3.02). 98% of input tokens were cache hits."
  - question: "Which AI model should I use to hack my TV?"
    answer: "Use a strong agentic coding model for the build (the original run used Claude Opus 5.5) and a cheap model for the hundreds of search, naming and summarising calls an agent makes along the way. Routing those through LLM Gateway to DeepSeek V4.1 Flash at $0.15 per million input tokens kept 893 calls under four dollars. If your builder model refuses firmware work, the reverse engineering models page lists Chinese-lab models that will not."
image:
  src: "/blog/hack-samsung-tv-home-screen-with-ai.png"
  alt: "A glowing television showing a minimal app dock mounted on the central chip of a dark circuit board, with a remote, a key and a house icon around it, representing an AI agent replacing a Samsung TV home screen"
  width: 1536
  height: 1024
---

My Samsung TV boots into Smart Hub: a wall of promoted shows, a Bixby banner, a "Samsung TV Plus" row I never asked for, and six tiles of apps I never open. Every press of the Home button goes back there. I wanted the Apple TV experience instead: a clock, a dock with Netflix, YouTube, Prime Video, my PS5, my Switch and my gaming PC, and nothing else.

So I gave an AI coding agent `sdb` access to the TV and let it work. Two days and $173.85 later the Home button opens my launcher and Smart Hub has not appeared since. This is the short version of [the full write-up on smakosh.com](https://smakosh.com/blog/replacing-samsung-tv-home-screen-with-ai): what it takes to hack a Samsung TV's home screen, what cannot be done on retail firmware, the exact model bill, and a prompt you can paste to repeat it.

## What "hack my TV" means on a Samsung

The first thing the agent found was that my TV is not Android. The TU43U8095F runs Tizen: a locked web platform with a remote-control REST API on port 8001 and a restricted shell over `sdb`. There is no `adb`, no package manager you can uninstall from, and no third-party launcher concept. The "debloat Android TV and install a custom launcher" projects you find on GitHub for Xiaomi and TCL sets do not apply.

What does apply:

- **Developer mode** is Home, Apps, gear, type 1 2 3 4 5, then set the Host PC IP to your laptop.
- **A launcher is a Tizen web app**: one HTML file, some CSS, a few hundred lines of JavaScript. Apps open with `tizen.application.launch`; HDMI inputs show full screen through `tizen.tvwindow`.
- **Signing** needs a certificate issued through a Samsung account on 2024+ TVs. The free certificate the Tizen CLI generates is rejected. The agent wrote a small Python script that drives that login flow once and saves the certificate.
- **Installing** goes over `sdb` with `vd_appinstall`, one of the few commands the retail shell allows.

## What you cannot do: uninstall Samsung's apps

`sdb uninstall` on any preinstalled Samsung app returns error 132. They are signed system packages on a read-only partition. The agent tried every package in the bloat list, then the installer's own uninstall path, then gave up honestly. The ceiling on retail firmware without a root exploit is killing the processes (Promotion, the Bixby banner, SecurityCenter, SmartThings, the AI companion launcher) and re-killing them on every boot, which is what the repo's `debloat.sh` does.

## The trick that makes the Home button yours

The Home button is not hardcoded. It opens whatever app is named in a vconf key, `db/appfw/home_appid`, which on my TV still said `com.samsung.tv.csfs`, Samsung's launcher. Only `vconftool` can write it, and the plain `sdb shell` is closed on retail firmware. But the package installer expands backticks in the package name it is handed:

```bash
sdb shell '0 appinstall tpk `vconftool set -t string -f db/appfw/home_appid SmkHomeKey.Go`.tpk'
```

The install fails; the backticks run first. No output, but it works.

One more twist. Pointing Home straight at the launcher left it stuck behind the TV's loading screen after Netflix, because the TV relaunches its home app through a path (`__NO_RAISE_WINDOW`) that does not raise a paused app. So Home points at a second, tiny app instead: it starts, launches the real launcher with an ordinary `tizen.application.launch`, and exits in about 0.2 seconds. Power-on uses `db/appfw/startup_appid` and points at the launcher directly, so a failure in the key app can never leave the TV on a black screen.

The agent spent most of the second day on this. Its first idea, a background "keeper" that relaunches the launcher when it is hidden, is a dead end: Tizen suspends background web apps, so `setTimeout` and `visibilitychange` never fire. It proved that with a logging probe before moving on, which is the kind of thing you want a reviewer model to insist on.

## What the two days cost in model calls

Pulled from the agent's usage log for October 22 and 24:

| Model                                |     Calls |        Cost |
| ------------------------------------ | --------: | ----------: |
| Claude Opus 5.5                      |     1,242 |     $118.51 |
| Claude Fable 5.1                     |       145 |      $48.58 |
| DeepSeek V4.1 Flash                  |       893 |       $3.53 |
| Gemini 3.1 Flash Lite                |        24 |       $0.21 |
| GPT-6 Astra / GPT-6.1 Sol (one each) |         2 |       $3.02 |
| **Total**                            | **2,306** | **$173.85** |

Opus did the building. Fable reviewed plans and the risky changes. Both ran on an Anthropic subscription. Everything else went through **LLM Gateway**: DeepSeek V4.1 Flash handled the cheap lookups (searching, naming, summarising command output) at 893 calls for less than four dollars, Gemini Flash Lite did a handful of web lookups, and the two GPT-6 calls were one-off second opinions on the Home button plan. That is 920 of the 2,306 calls and $6.76 of the $173.85 on one key and one invoice.

Most of the cost is context, not thinking: every call carried the README, the scripts and the TV's app list, and 885M of the 901M input tokens were cache reads, 98% of the total. If your agent lets you route the small calls to a cheaper model, this is the project that shows why it matters. The same 893 lookups on the builder model would have cost more than the whole project.

## Do it yourself: the prompt

This works on Samsung Tizen TVs from roughly 2020 on. It will not work on Android TV, Google TV, LG webOS or Fire TV. Paste this into a coding agent with shell access, on a computer on the same Wi-Fi as the TV:

```text
I have a Samsung Tizen TV at <TV_IP> on my Wi-Fi. Build me an Apple TV style home screen
for it and make the Home button open it instead of Smart Hub. Work on the real device and
verify with screenshots. Ask me before anything that depends on my preferences.

What I want on the dock: <Netflix, YouTube, Prime Video, PS5 on HDMI 1, Switch on HDMI 2, ...>

Rules of the platform, so you do not waste time:
- It is Tizen, not Android. No adb. Use sdb (Tizen Studio) and the REST API on port 8001.
- Developer mode: Home > Apps > gear > type 1 2 3 4 5 > On, Host PC IP = this machine.
- 2024+ TVs need a certificate from a Samsung account; the free Tizen CLI cert is rejected.
- Preinstalled Samsung apps cannot be uninstalled (error 132). Do not loop on it; at most
  kill their processes and re-kill on boot.
- The Home button opens the app named in vconf key db/appfw/home_appid. The sdb shell is
  closed, but `0 appinstall tpk \`<cmd>\`.tpk` expands backticks, so vconftool can run that way.
- Do not point home_appid at the launcher directly: the TV relaunches home apps with
  __NO_RAISE_WINDOW and a paused launcher stays hidden. Point it at a tiny key app that
  launches the launcher with tizen.application.launch and exits. Set
  db/appfw/startup_appid to the launcher itself for power-on.
- Background web apps are suspended; timers and visibilitychange do not fire. Do not build
  a watchdog that relies on them.
- Before changing anything, save the installed app list and the current values of
  home_appid, first_screen/type and startup_appid to a backup folder, and write a
  restore script that puts them back and uninstalls what you added.

Deliverables: the launcher as a Tizen web app, an install script, a restore script, a
README, and a screenshot of the launcher on the TV after pressing Home from Netflix.
```

Expect the certificate step to need you in the browser once, and expect one or two reboots. If the agent starts fighting the Home button with a relaunch loop, paste it the vconf paragraph again.

To run the cheap calls through the gateway, give the agent an LLM Gateway key and a budget model for its search, summarise and naming tasks. Any agent that takes an OpenAI-compatible base URL works:

```bash
export OPENAI_BASE_URL=https://api.llmgateway.io/v1
export OPENAI_API_KEY=$LLM_GATEWAY_API_KEY
# builder stays on your subscription; lookups go to deepseek-v4.1-flash
```

## Three things I would tell past me

- Say "Samsung Tizen" in the first message. My first prompt said Android TV and the agent spent twenty minutes looking for `adb`.
- Write the backup script before the install script. The agent wrote one on day two; it should have been the first thing.
- Have a reviewer model read the final scripts cold. Mine flagged a restore script that reset the Home key but left power-on pointing at an uninstalled app.

The remote still works for everything else: inputs, settings, volume, the guide. Only the Home button changed its mind.

- **[Try LLM Gateway free](https://llmgateway.io/signup)**: one key for DeepSeek, Gemini, GPT and 200+ models, with a cost ledger for every call.
- **[Quick start](https://docs.llmgateway.io/quick-start)**: point any OpenAI-compatible agent at `https://api.llmgateway.io/v1` in two environment variables.
- **[Best models for reverse engineering](/models/reverse-engineering)**: models that finish firmware and binary work, with live prices.
- **Related: [Reverse engineering with AI when Claude and GPT refuse](/blog/reverse-engineering-with-ai-rea)**.
