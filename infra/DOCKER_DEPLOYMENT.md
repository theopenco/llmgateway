# LLMGateway Docker Deployment

This document describes how to deploy LLMGateway using the unified Docker image that includes all services (API, Gateway, UI, Docs) plus PostgreSQL and Redis in a single container.

## Quick Start

### Using Docker Run

```bash
# Create a volume for persistent data
docker volume create llmgateway_data

# Run the container
docker run -d \
  --name llmgateway \
  --restart unless-stopped \
  -p 3002:3002 \
  -p 3005:3005 \
  -p 4001:4001 \
  -p 4002:4002 \
  -p 5432:5432 \
  -p 6379:6379 \
  -v llmgateway_data:/var/lib/postgresql/data \
  -e POSTGRES_PASSWORD=your_secure_password \
  -e OPENAI_API_KEY=sk-your_openai_key_here \
  -e ANTHROPIC_API_KEY=sk-ant-your_anthropic_key_here \
  -e AUTH_SECRET=your-secret-key-here \
  ghcr.io/your-org/llmgateway:latest
```

### Using Docker Compose (Recommended)

1. **Download the deployment files:**

   ```bash
   # Download from GitHub releases or use the generated files from CI
   curl -O https://github.com/your-org/llmgateway/releases/latest/download/docker-compose.yml
   curl -O https://github.com/your-org/llmgateway/releases/latest/download/.env.example
   ```

2. **Configure environment:**

   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start the services:**
   ```bash
   docker compose up -d
   ```

## Port Mapping

The unified container exposes the following ports:

| Port | Service    | Description                  |
| ---- | ---------- | ---------------------------- |
| 3002 | UI         | Web interface                |
| 3005 | Docs       | Documentation                |
| 4001 | Gateway    | LLM routing service          |
| 4002 | API        | Authentication & billing API |
| 5432 | PostgreSQL | Database                     |
| 6379 | Redis      | Cache & queue                |

## Environment Variables

### Required

- `POSTGRES_PASSWORD`: Password for PostgreSQL database
- `AUTH_SECRET`: Secret key for authentication (generate a secure random string)

### LLM Provider API Keys (add the ones you need)

- `OPENAI_API_KEY`: OpenAI API key
- `ANTHROPIC_API_KEY`: Anthropic API key
- `VERTEX_API_KEY`: Google Vertex AI API key
- `GOOGLE_AI_STUDIO_API_KEY`: Google AI Studio API key
- `INFERENCE_NET_API_KEY`: Inference.net API key
- `KLUSTER_AI_API_KEY`: Kluster.ai API key
- `TOGETHER_AI_API_KEY`: Together.ai API key

### Optional Configuration

- `UI_URL`: URL where UI is accessible (default: http://localhost:3002)
- `API_URL`: URL where API is accessible (default: http://localhost:4002)
- `ORIGIN_URL`: Allowed origin for CORS (default: http://localhost:3002)
- `PASSKEY_RP_ID`: Passkey relying party ID (default: localhost)
- `PASSKEY_RP_NAME`: Passkey relying party name (default: LLMGateway)

### Analytics (Optional)

- `VITE_POSTHOG_KEY`: PostHog project key
- `VITE_POSTHOG_HOST`: PostHog host (default: https://app.posthog.com)

### Stripe (Optional)

- `STRIPE_SECRET_KEY`: Stripe secret key for billing
- `STRIPE_WEBHOOK_SECRET`: Stripe webhook secret

## Data Persistence

The container uses the following paths for persistent data:

- `/var/lib/postgresql/data`: PostgreSQL database files
- `/var/lib/redis`: Redis data files

**Important:** Always mount volumes for these paths to ensure data persistence across container restarts.

## Health Checks

The container includes health checks for all services:

- UI: `http://localhost:3002/health`
- Docs: `http://localhost:3005/health`
- API: `http://localhost:4002/` (returns API status)
- Gateway: `http://localhost:4001/` (returns gateway status)

## Accessing Services

After starting the container, you can access:

- **Web Interface**: http://localhost:3002
- **Documentation**: http://localhost:3005
- **API Endpoint**: http://localhost:4002
- **Gateway Endpoint**: http://localhost:4001

## Production Deployment

For production deployment:

1. **Use a reverse proxy** (nginx, Traefik, etc.) to handle SSL termination
2. **Set proper domain names** in environment variables
3. **Use strong passwords** for database and auth secret
4. **Configure monitoring** and log aggregation
5. **Set up backups** for the PostgreSQL data volume
6. **Use secrets management** for API keys

### Example Nginx Configuration

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://localhost:4002/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /docs/ {
        proxy_pass http://localhost:3005/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Troubleshooting

### Check container logs

```bash
docker logs llmgateway
```

### Check individual service logs

```bash
# API logs
docker exec llmgateway tail -f /var/log/supervisor/api.out.log

# Gateway logs
docker exec llmgateway tail -f /var/log/supervisor/gateway-serve.out.log

# Database logs
docker exec llmgateway tail -f /var/log/supervisor/postgresql.out.log
```

### Access container shell

```bash
docker exec -it llmgateway /bin/bash
```

### Database access

```bash
# Connect to PostgreSQL
docker exec -it llmgateway su postgres -c "psql -d llmgateway"
```

## Building from Source

To build the unified image yourself:

```bash
git clone https://github.com/your-org/llmgateway.git
cd llmgateway
docker build -f Dockerfile.unified -t llmgateway:latest .
```
