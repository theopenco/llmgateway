#!/usr/bin/env bash
set -euo pipefail

grep -v '^#' .tool-versions | cut -d' ' -f1 | xargs -I{} asdf plugin add {}

NODE_VERSION=$(awk '$1 == "nodejs" { print $2 }' .tool-versions)
case "$(uname -m)" in
	aarch64 | arm64) NODE_ARCH=arm64 ;;
	x86_64 | amd64) NODE_ARCH=x64 ;;
	*) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac
NODE_TARBALL="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
NODE_DIR="${ASDF_DATA_DIR}/installs/nodejs/${NODE_VERSION}"
TMP_DIR=$(mktemp -d)

curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}" -o "${TMP_DIR}/${NODE_TARBALL}"
curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" -o "${TMP_DIR}/SHASUMS256.txt"
(cd "${TMP_DIR}" && grep " ${NODE_TARBALL}\$" SHASUMS256.txt | sha256sum -c -)
mkdir -p "${NODE_DIR}"
tar -xJf "${TMP_DIR}/${NODE_TARBALL}" -C "${NODE_DIR}" --strip-components=1
rm -rf "${TMP_DIR}"

asdf install
asdf reshim

echo "Final versions installed:"
node -v
pnpm -v
