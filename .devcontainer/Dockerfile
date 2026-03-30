FROM docker:28-dind

ARG NODE_VERSION=24.13.0
ARG PNPM_VERSION=10.28.1
ARG USERNAME=node
ARG USER_UID=1000
ARG USER_GID=${USER_UID}

RUN apk add --no-cache \
		bash \
		binutils \
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
		xz \
	&& ARCH="$(apk --print-arch)" \
	&& case "${ARCH}" in \
		x86_64) NODE_ARCH='x64' ;; \
		aarch64) NODE_ARCH='arm64' ;; \
		*) echo "Unsupported Alpine architecture: ${ARCH}" >&2; exit 1 ;; \
	esac \
	&& mkdir -p /usr/local/lib/nodejs \
	&& curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" -o /tmp/node.tar.xz \
	&& curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" -o /tmp/SHASUMS256.txt \
	&& grep " node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz$" /tmp/SHASUMS256.txt | sha256sum -c - \
	&& tar -xJf /tmp/node.tar.xz -C /usr/local/lib/nodejs --strip-components=1 --no-same-owner \
	&& rm -f /usr/bin/node /usr/bin/npm /usr/bin/npx \
	&& ln -sf /usr/local/lib/nodejs/bin/node /usr/local/bin/node \
	&& ln -sf /usr/local/lib/nodejs/bin/npm /usr/local/bin/npm \
	&& ln -sf /usr/local/lib/nodejs/bin/npx /usr/local/bin/npx \
	&& ln -sf /usr/local/lib/nodejs/bin/node /usr/bin/node \
	&& ln -sf /usr/local/lib/nodejs/bin/npm /usr/bin/npm \
	&& ln -sf /usr/local/lib/nodejs/bin/npx /usr/bin/npx \
	&& rm -f /tmp/node.tar.xz /tmp/SHASUMS256.txt \
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
ENV PATH=/usr/local/lib/nodejs/bin:${PNPM_HOME}:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ENV NODE_VERSION=${NODE_VERSION}

WORKDIR /workspaces

VOLUME ["/var/lib/docker"]
