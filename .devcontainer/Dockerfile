FROM mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm

RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
	&& apt-get update \
	&& apt-get install -y --no-install-recommends nodejs \
	&& apt-get clean \
	&& rm -rf /var/lib/apt/lists/* \
	&& corepack enable \
	&& corepack prepare pnpm@10.28.1 --activate
