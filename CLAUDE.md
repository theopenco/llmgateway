# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Setup and Dependencies

- `pnpm install` - Install all dependencies
- `pnpm setup` - Full development environment setup (starts Docker, syncs DB, seeds data)
- `docker compose up -d` - Start PostgreSQL and Redis services

### Development

- `pnpm dev` - Start all development servers (UI on :3002, API on :4002, Gateway on :4001, Docs on :3005)
- `pnpm build` - Build all applications for production
- `pnpm clean` - Clean build artifacts and cache directories

### Code Quality

Always run `pnpm format` before committing code. Run `pnpm generate` if API routes were modified.

- `pnpm format` - Format code and fix linting issues
- `pnpm lint` - Check linting and formatting (without fixing)
- `pnpm generate` - Regenerate OpenAPI schemas from API routes

### Testing

- `pnpm test:unit` - Run unit tests (\*.spec.ts files)
- `pnpm test:e2e` - Run end-to-end tests (\*.e2e.ts files)

### Database Operations

- `pnpm push-dev` - Push schema changes to development database
- `pnpm push-test` - Push schema changes to test database
- `pnpm migrate` - Run database migrations
- `pnpm seed` - Seed database with initial data
- `pnpm reset` - Reset database (destructive)
- `pnpm sync` - Sync both dev and test databases

## Architecture Overview

**LLMGateway** is a monorepo containing a full-stack LLM API gateway with multiple services:

### Core Services

- **Gateway** (`apps/gateway`) - LLM request routing and provider management (Hono + Zod + OpenAPI)
- **API** (`apps/api`) - Backend API for user management, billing, analytics (Hono + Zod + OpenAPI)
- **UI** (`apps/ui`) - Frontend dashboard (React + TanStack Router + Vite)
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

- **Framework**: React with TanStack Router
- **State Management**: TanStack Query
- **UI Components**: Radix UI with Tailwind CSS
- **Build Tool**: Vite
- **Navigation**: Use `navigate()` for programmatic navigation

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
- For schema changes: Use `pnpm push` instead of writing migrations which will generate .sql files
- Always sync schema with `pnpm push` after table/column changes

### Code Standards

- Use conventional commit message format
- Always use pnpm for package management
- Use localStorage instead of cookies for client-side data persistence
- Apply DRY principles for code reuse
- No unnecessary code comments

### Testing and Quality Assurance

- Run `pnpm test:unit` and `pnpm test:e2e` after adding features
- Run `pnpm build` to ensure production builds work
- Run `pnpm format` after code changes
- Run `pnpm generate` after API route changes to update OpenAPI schemas

### Service URLs (Development)

- UI: http://localhost:3002
- API: http://localhost:4002
- Gateway: http://localhost:4001
- Docs: http://localhost:3005
- PostgreSQL: localhost:5432
- Redis: localhost:6379

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
