#!/bin/bash

# Terragon Labs - LLMGateway Development Environment Setup
# This script sets up all dependencies and services needed for E2E testing

set -e  # Exit on any error

echo "🚀 Setting up LLMGateway development environment..."

pnpm install
pnpm build:core
pnpm run setup

echo "✅ Setup complete!"
