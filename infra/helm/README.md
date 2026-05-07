# LLM Gateway Helm Chart

This is the Helm chart for LLM Gateway. It is used to deploy LLM Gateway on a Kubernetes cluster.

The chart is published as an OCI artifact to GitHub Container Registry on every release.

## Installation

```bash
helm install llmgateway oci://ghcr.io/theopenco/charts/llmgateway
```

This installs the latest published version. To pin to a specific release, append `--version <version>` (matching a published release tag without the `v` prefix, e.g. `1.2.3`). Available versions are listed at https://github.com/theopenco/llmgateway/pkgs/container/charts%2Fllmgateway.

## Local development

To install directly from a checkout of this repository:

```bash
helm install llmgateway ./infra/helm/llmgateway
```
