---
id: blog-nextjs-on-gcp
slug: deploying-nextjs-on-gcp
date: 2025-12-27
title: Deploying Next.js on GCP
summary: How we deploy our Next.js apps on Google Cloud Platform without relying on Vercel.
categories: ["Engineering"]
image:
  src: "/blog/blog-nextjs-on-gcp.png"
  alt: "Deploying Next.js on GCP"
  width: 2282
  height: 1198
---

We recently moved our Next.js deployments to Google Cloud Platform. Here's why and how it went.

## Why GCP?

LLM Gateway is a full-stack application with multiple APIs and frontends. Deploying everything through Vercel meant adding another tool to our stack—one more dashboard, one more set of credentials, one more thing to manage.

By running on GCP directly, we consolidate our infrastructure. Our APIs, databases, and frontends all live in the same place.

## The Setup

All our services run on a Kubernetes cluster on GCP. Each service—API, Gateway, UI, Playground, Docs, Admin, and Worker—is deployed as a separate container. Kubernetes handles autoscaling based on resource usage, so we scale up during traffic spikes and scale down when things are quiet.

The build and deployment pipeline is fully automated via GitHub Actions. On every push to main, we build Docker images for each service and push them to GitHub Container Registry. You can see the workflow here: [`.github/workflows/images.yml`](https://github.com/theopenco/llmgateway/blob/main/.github/workflows/images.yml).

For Next.js specifically, we build in standalone mode and package each app into its own container.

## Performance

The results surprised us. Performance is excellent—response times are consistently fast, and the infrastructure handles our traffic without issues.

The common concern with self-hosted Next.js is SSR latency from running in a single region. In practice, this hasn't been a problem. The slight increase in latency for users far from our region is negligible compared to the operational simplicity we gained.

## How to Self-Host Next.js

Here's how to do it yourself.

### Step 1: Enable Standalone Mode

In your `next.config.js`:

```js
module.exports = {
  output: "standalone",
};
```

This bundles your app into a self-contained folder with all dependencies.

### Step 2: Dockerfile

```dockerfile
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=80

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 80
CMD ["node", "server.js"]
```

Build and push:

```bash
docker build -t gcr.io/your-project/your-app:latest .
docker push gcr.io/your-project/your-app:latest
```

### Step 3a: Deploy to Cloud Run

```bash
gcloud run deploy your-app \
  --image gcr.io/your-project/your-app:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

### Step 3b: Deploy to Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: your-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: your-app
  template:
    metadata:
      labels:
        app: your-app
    spec:
      containers:
        - name: your-app
          image: gcr.io/your-project/your-app:latest
          ports:
            - containerPort: 80
          resources:
            requests:
              memory: "256Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
```

Apply with `kubectl apply -f deployment.yaml`.

#### Bonus: Autoscaling

For automatic scaling based on CPU usage, add a HorizontalPodAutoscaler:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: your-app
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: your-app
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

This scales your deployment between 2 and 10 replicas based on CPU utilization.

#### Bonus: CI/CD with GitHub Actions

Automate builds with GitHub Actions. This workflow builds and pushes to GitHub Container Registry on every push to main:

```yaml
name: Build and Push

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ghcr.io/${{ github.repository }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

Save as `.github/workflows/build.yml`.

## Takeaway

If you're already on GCP and considering whether to add Vercel to your stack, you might not need to. Kubernetes and Cloud Run handle Next.js well, and keeping everything in one place makes operations simpler.
