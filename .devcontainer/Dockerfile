FROM docker:28-dind

ARG NODE_VERSION=24.13.0
ARG PNPM_VERSION=10.28.1
ARG USERNAME=node
ARG USER_UID=1000
ARG USER_GID=${USER_UID}

RUN apk add --no-cache \
		bash \
		curl \
		git \
		libstdc++ \
		sudo \
		shadow \
		nano \
		openssh-client \
		ca-certificates \
		python3 \
		make \
		g++ \
		libc6-compat \
		nodejs \
		npm \
	&& npm install -g corepack@latest \
	&& corepack enable \
	&& corepack prepare pnpm@${PNPM_VERSION} --activate \
	&& addgroup -g ${USER_GID} ${USERNAME} \
	&& adduser -D -u ${USER_UID} -G ${USERNAME} -s /bin/bash ${USERNAME} \
	&& addgroup ${USERNAME} docker \
	&& echo "${USERNAME} ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/${USERNAME} \
	&& chmod 0440 /etc/sudoers.d/${USERNAME} \
	&& mkdir -p /home/${USERNAME}/.local/share/pnpm /workspaces \
	&& chown -R ${USERNAME}:${USERNAME} /home/${USERNAME} /workspaces

ENV PNPM_HOME=/home/${USERNAME}/.local/share/pnpm
ENV PATH=${PNPM_HOME}:$PATH
ENV NODE_VERSION=${NODE_VERSION}

WORKDIR /workspaces

VOLUME ["/var/lib/docker"]
