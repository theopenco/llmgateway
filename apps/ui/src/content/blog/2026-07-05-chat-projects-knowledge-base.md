---
id: "blog-chat-projects-knowledge-base"
slug: "chat-projects-knowledge-base"
date: "2026-07-05"
title: "Projects: A Knowledge Base for Your AI Chats"
summary: "LLM Gateway Chat now has Projects: group related chats, upload files — PDFs and spreadsheets included — as a knowledge base, and get answers grounded in your own documents via RAG, with source citations, on any of 280+ models. Projects also remember durable facts across chats. Available to every Chat user."
categories: ["Announcements", "Product"]
image:
  src: "/blog/chat-projects-knowledge-base.png"
  alt: "A glossy 3D circuit board with a glowing folder holding documents at its center, representing a project knowledge base feeding AI chats"
  width: 1536
  height: 1024
---

Every new chat starts from zero. You paste the same product spec for the third time this week, re-upload the same README, and re-explain the same context the model forgot the moment you closed the tab. The model is smart; your setup is amnesiac.

Today we're adding **Projects** to [LLM Gateway Chat](https://chat.llmgateway.io) — a knowledge base and workspace for your chats. Create a project, drop in your files once — PDFs, spreadsheets, docs, code — and every chat inside it answers from those documents, with the source file cited in the reply. It's retrieval-augmented generation (RAG) without standing up a vector database, and it works with any of the 280+ models in the picker.

Projects also have memory. Mention once that you're hiring for the Stockholm team, and a brand-new chat in the same project next week still knows — without you repeating it and without the fact living in any uploaded file.

## What's in a project

A project is four things:

- **A knowledge base.** Upload PDF, Excel, text, markdown, code, CSV, JSON, or YAML files. Each file is indexed automatically and marked when it's ready.
- **Memory.** Durable facts the assistant picks up as you chat — preferences, names, constraints — saved to the project automatically and editable on the project page. You can add memories by hand too.
- **Instructions.** Per-project guidance that applies to every chat in it — "answer from the knowledge base and cite the file", "respond in French", "assume the reader is on the enterprise plan".
- **Its chats.** Chats started in a project stay grouped there, so the research for one client, one codebase, or one launch doesn't scatter across your history.

Open a chat inside a project and a banner shows what context it's running with. Switch models mid-conversation like always — the knowledge base follows the project, not the model.

## How the knowledge base answers

When you send a message in a project chat, LLM Gateway Chat embeds your question, pulls the most relevant passages from your files by similarity, and hands the model those passages plus your project instructions before it answers. The model responds from your documents and names the file it used.

Ask "what did we decide about retry behavior?" and instead of a confident guess, you get the actual decision — with `(architecture-notes.md)` at the end of the sentence.

Under the hood:

| Step   | What happens                                                                                |
| ------ | ------------------------------------------------------------------------------------------- |
| Upload | PDFs are extracted to text and spreadsheets converted sheet-by-sheet to CSV, automatically  |
| Chunk  | Text is split into ~1,500-character passages along paragraph boundaries                     |
| Index  | Passages are embedded with `text-embedding-3-small` through the gateway itself              |
| Ask    | Your question is embedded and the top-matching passages are retrieved per message           |
| Answer | The model gets instructions + memory + passages in its system prompt and cites source files |

Retrieval runs on every message, so follow-up questions pull fresh passages instead of reusing whatever the first question happened to surface.

## Memory that carries across chats

Knowledge bases hold what your files say. Memory holds what your conversations establish.

After each reply in a project chat, a small model scans the exchange for durable facts worth keeping — preferences, names, constraints, decisions — and saves up to three of them to the project, deduplicated against what it already knows. They show up in the Memory section of the project page with an "Auto" badge, and every chat in the project gets them in its context from then on.

You stay in control: edit any memory, delete it, or add your own by hand ("always answer in Swedish", "our fiscal year starts in April"). Projects hold up to 50 memories, extraction runs in the background after the reply streams — it never slows a response down or breaks one if it fails — and it's billed like any other request on your balance, with a model call small enough to cost a fraction of a cent.

## No separate bill, no separate infrastructure

Indexing and retrieval run through the same gateway and the same balance as the chat itself. Embedding a 500 KB file costs fractions of a cent with `text-embedding-3-small`; there's no vector-database add-on, no per-seat knowledge fee, and no plan gate. Projects are available to every LLM Gateway Chat user today — on the Chat plan context or under a dashboard organization.

Current limits: 20 files per project, up to 500 KB of extracted text per file (binary uploads up to 10 MB). PDF and Excel files are converted to text automatically on upload.

## Get started in three steps

1. Open [chat.llmgateway.io/projects](https://chat.llmgateway.io/projects) and create a project.
2. Add files to its knowledge base — a PDF is fine as-is — and optionally write instructions.
3. Hit **New chat** and ask a question your documents can answer.

## Frequently Asked Questions

### How is a project knowledge base different from attaching a file to a chat?

An attachment lives and dies with one conversation, and large files eat your context window on every message. A knowledge base is indexed once and shared by every chat in the project — only the passages relevant to each question are sent to the model, so a 500 KB handbook doesn't cost you 500 KB of context per message.

### Which models work with project knowledge bases?

All of them. Retrieval happens before the model is called, so the grounded context works the same whether the chat runs GPT-5, Claude, Gemini, or any other model on the gateway — and you can switch models mid-project.

### What file types can I upload?

PDF and Excel (.xlsx/.xls) files, plus any text-based format: plain text, markdown, source code, CSV, JSON, YAML, XML, HTML, and logs. PDF text is extracted on upload; spreadsheets are converted sheet-by-sheet to CSV. Scanned image-only PDFs aren't supported yet.

### How does project memory work?

After each assistant reply in a project chat, a small model extracts durable facts from the exchange — up to three per reply, deduplicated, capped at 50 per project — and saves them with an "Auto" badge on the project page. Every chat in the project sees them from then on. You can edit or delete any memory, or add your own manually; extraction runs after the reply streams, so it never slows a response down.

### Does RAG cost extra?

No. Embeddings and memory extraction are billed to the same credits as your chats at standard gateway rates — for `text-embedding-3-small`, indexing a file works out to fractions of a cent.

---

**Try it now:**

- **[Open LLM Gateway Chat](https://chat.llmgateway.io/projects)** — create your first project free
- **[Chat plans](https://chat.llmgateway.io/pricing)** — more credits for heavy use, from $9/mo
- **[DevPass Code](/blog/devpass-code)** — our terminal coding agent, if your knowledge base is a codebase
