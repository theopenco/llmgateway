---
id: "99"
slug: "vscode-extension"
date: "2026-09-18"
title: "Native VS Code Integration"
summary: "The official LLM Gateway extension is now on the VS Code Marketplace. Use your PAYG or DevPass key to select gateway models directly in Copilot Chat and agent mode."
image:
  src: "/changelog/vscode-extension.png"
  alt: "A glowing plug beside a chat bubble on a circuit-board chip, surrounded by tool and chat icons"
  width: 1536
  height: 1024
---

Keep your coding workflow in VS Code while choosing models through LLM Gateway. The official **LLM Gateway extension** is now available on the VS Code Marketplace, adding gateway models directly to the Copilot Chat model picker.

## Connect Your Key

1. Install [LLM Gateway](https://marketplace.visualstudio.com/items?itemName=llmgateway.llmgateway-vscode) in VS Code 1.134.0 or later.
2. Open the chat model picker, choose **Manage Models…**, and select **LLM Gateway**.
3. Enter your API key, choose a model, and start chatting.

Both **PAYG and DevPass keys** work. The extension discovers chat models using your key, respecting your organization's model access and DevPass plan restrictions. Your key stays in VS Code's secret storage.

## Use Chat and Agent Mode

Responses stream into Copilot Chat. Choose a model with tool calling for agent mode, or one with image input support to attach images. Available capabilities depend on the selected model; browse the [live catalog](https://llmgateway.io/models) for details.

The gateway endpoint is preconfigured. Optional settings let you narrow the model picker, set reasoning effort, or connect a self-hosted gateway.

---

**[VS Code setup guide →](https://docs.llmgateway.io/guides/vscode)** | **[Install the extension →](https://marketplace.visualstudio.com/items?itemName=llmgateway.llmgateway-vscode)**
