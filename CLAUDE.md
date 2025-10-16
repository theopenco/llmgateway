# CLAUDE.md

This file provides guidance to AI agents when working with code in this repository.

## Development Commands

### Setup and Dependencies

- `pnpm install` - Install all dependencies
- `pnpm setup` - Full development environment setup (starts Docker, syncs DB, seeds data)
- `docker compose up -d` - Start PostgreSQL and Redis services

### Development

NOTE: these commands can only be run in the root directory of the repository, not in individual app directories.

- `pnpm dev` - Start all development servers (UI on :3002, Playground on :3003, API on :4002, Gateway on :4001, Docs on :3005)
- `pnpm build` - Build all applications for production. Always run this after finishing work on a feature.
- `pnpm clean` - Clean build artifacts and cache directories

### Code Quality

NOTE: these commands can only be run in the root directory of the repository, not in individual app directories.

Always run `pnpm format` before committing code. Run `pnpm build` if API routes were modified.

- `pnpm format` - Format code and fix linting issues. Always run this before committing code.
- `pnpm lint` - Check linting and formatting (without fixing)

### Writing code

This is a pure TypeScript project. Never use `any` or `as any` unless absolutely necessary.

### Testing

NOTE: these commands can only be run in the root directory of the repository, not in individual app directories.

- `pnpm test:unit` - Run unit tests (\*.spec.ts files)
- `pnpm test:e2e` - Run end-to-end tests (\*.e2e.ts files)

When running curl commands against the local API, you can use `test-token` as authentication.

#### E2E Test Options

- `TEST_MODELS` - Run tests only for specific models (comma-separated list of `provider/model-id` pairs)
  Example: `TEST_MODELS="openai/gpt-4o-mini,anthropic/claude-3-5-sonnet-20241022" pnpm test:e2e`
  This is useful for quick testing as the full e2e suite can take too long with all models.
- `FULL_MODE` - Include free models in tests (default: only paid models)
- `LOG_MODE` - Enable detailed logging of responses

#### E2E Test Structure

E2E tests are organized for optimal performance:

- **Parallel execution**: Tests run up to 16 in parallel using Vitest's thread pool (minimum 8 threads)
- **Split structure**:
  - `apps/gateway/src/api.e2e.ts` - Contains all `.each()` tests that benefit from parallelization
  - `apps/gateway/src/api-individual.e2e.ts` - Contains individual test cases that need isolation
- **Concurrent mode**: The main test suite uses `{ concurrent: true }` to enable parallel execution of `.each()` tests

### Database Operations

NOTE: these commands can only be run in the root directory of the repository, not in individual app directories.

- `pnpm --filter db push` - Push database schema
- `pnpm --filter db seed` - Seed database with initial data
- `pnpm run setup` – Reset db, sync schema, seed data (use this for development)

## Architecture Overview

**LLM Gateway** is a monorepo containing a full-stack LLM API gateway with multiple services:

### Core Services

- **Gateway** (`apps/gateway`) - LLM request routing and provider management (Hono + Zod + OpenAPI)
- **API** (`apps/api`) - Backend API for user management, billing, analytics (Hono + Zod + OpenAPI)
- **UI** (`apps/ui`) - Frontend dashboard (Next.js App Router)
- **Playground** (`apps/playground`) - Interactive LLM testing environment (Next.js App Router)
- **Docs** (`apps/docs`) - Documentation site (Next.js + Fumadocs)

### Shared Packages

- **@llmgateway/db** - Database schema, migrations, and utilities (Drizzle ORM)
- **@llmgateway/models** - LLM provider definitions and model configurations
- **@llmgateway/auth** - Authentication utilities and session management

## Technology Stack

### Backend

- **Framework**: Hono (lightweight web framework)
- **Database**: PostgreSQL with Drizzle ORM
- **Caching**: Redis
- **Authentication**: Better Auth with passkey support
- **Validation**: Zod schemas
- **API Documentation**: OpenAPI/Swagger

### Frontend

- **Framework**: Next.js App Router (React Server Components)
- **State Management**: TanStack Query
- **UI Components**: Radix UI with Tailwind CSS
- **Build Tool**: Next.js (Turbopack during dev; Node/Edge runtime)
- **Navigation**: Use `next/link` for links and `next/navigation`'s router for programmatic navigation

### Development Tools

- **Monorepo**: Turbo with pnpm workspaces
- **TypeScript**: Strict mode enabled
- **Testing**: Vitest for unit and E2E tests
- **Linting**: ESLint with custom configuration
- **Formatting**: Prettier

## Development Guidelines

### Database Operations

- Use Drizzle ORM with latest object syntax
- For reads: Use `db().query.<table>.findMany()` or `db().query.<table>.findFirst()`
- For schema changes: Use `pnpm run setup` instead of writing migrations which will generate .sql files
- Always sync schema with `pnpm run setup` after table/column changes

### Code Standards

- Always use top-level `import`, never use require or dynamic imports
- Use conventional commit message format and limit the commit message title to max 50 characters
- When writing pull request titles, use the conventional commit message format and limit to max 50 characters
- Always use pnpm for package management
- Use cookies for user-settings which are not saved in the database to ensure SSR works
- Apply DRY principles for code reuse
- No unnecessary code comments

### Testing and Quality Assurance

- Run `pnpm test:unit` and `pnpm test:e2e` after adding features
- Run `pnpm build` to ensure production builds work
- Run `pnpm format` after code changes

### Service URLs (Development)

- UI: http://localhost:3002
- Playground: http://localhost:3003
- API: http://localhost:4002
- Gateway: http://localhost:4001
- Docs: http://localhost:3005
- PostgreSQL: localhost:5432
- Redis: localhost:6379

## Folder Structure

- `apps/ui`: Next.js frontend
- `apps/playground`: Interactive LLM testing environment
- `apps/api`: Hono backend
- `apps/gateway`: API gateway for routing LLM requests
- `apps/docs`: Documentation site
- `packages/db`: Drizzle ORM schema and migrations
- `packages/models`: Model and provider definitions
- `packages/shared`: Shared types and utilities

## Key Features

### LLM Gateway

- Multi-provider support (OpenAI, Anthropic, Google Vertex AI, etc.)
- OpenAI-compatible API interface
- Request routing and load balancing
- Response caching with Redis
- Usage tracking and cost analytics

### Management Platform

- User authentication with passkey support
- API key management
- Project and organization management
- Billing integration with Stripe
- Real-time usage monitoring
- Provider key management

### Database Schema

- Users, organizations, and projects
- API keys and provider configurations
- Usage tracking and billing records
- Analytics and performance metrics

## License

LLM Gateway is available under a dual license:

- **Open Source**: Core functionality is licensed under AGPLv3 - see the [LICENSE](LICENSE) file for details.
- **Enterprise**: Commercial features in the `ee/` directory require an Enterprise license - see [ee/LICENSE](ee/LICENSE) for details.

### Enterprise features include:

- Advanced billing and subscription management
- Extended data retention (90 days vs 3 days)
- Provider API key management (Pro plan)
- Team and organization management
- Priority support
- And more to be defined

For enterprise licensing, please contact us at contact@llmgateway.io
