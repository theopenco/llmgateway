#!/bin/bash

# Terragon Labs - LLMGateway Development Environment Setup
# This script sets up all dependencies and services needed for E2E testing

set -e  # Exit on any error

echo "🚀 Setting up LLMGateway development environment..."

# Update package lists
echo "📦 Updating package lists..."
apt update -qq

# Install PostgreSQL and Redis
echo "🗄️ Installing PostgreSQL and Redis..."
apt install -y postgresql postgresql-contrib redis-server

# Start services
echo "🔧 Starting PostgreSQL and Redis services..."
service postgresql start
service redis-server start

# Configure PostgreSQL
echo "🔐 Configuring PostgreSQL..."
sudo -u postgres createuser -s postgres 2>/dev/null || echo "✅ Postgres user already exists"
sudo -u postgres createdb postgres 2>/dev/null || echo "✅ Postgres database already exists"
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'pw';" || echo "⚠️ Could not set postgres password"

# Create required databases
echo "📊 Creating test and db databases..."
sudo -u postgres createdb test 2>/dev/null || echo "✅ Test database already exists"
sudo -u postgres createdb db 2>/dev/null || echo "✅ DB database already exists"

# Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
pnpm install

# Set up database schemas and seed data
echo "🌱 Setting up database schemas and seeding data..."
pnpm push-test
pnpm push-dev
pnpm seed

# Verify services are running
echo "🔍 Verifying services..."
service postgresql status --no-pager --lines=0 || echo "⚠️ PostgreSQL status check failed"
service redis-server status --no-pager --lines=0 || echo "⚠️ Redis status check failed"

echo ""
echo "✅ Setup complete! You can now run e2e test, for example:"
echo "   • pnpm dev - Start all development servers"
echo "   • pnpm test:e2e - Run E2E tests"
echo "   • TEST_MODELS=openai/gpt-5-mini pnpm test:e2e - Run E2E tests for specific model"
echo ""
echo "Services running:"
echo "   • PostgreSQL: localhost:5432 (user: postgres, password: pw)"
echo "   • Redis: localhost:6379"
