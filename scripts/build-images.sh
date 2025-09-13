#!/bin/bash

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REGISTRY="ghcr.io"
REPOSITORY_BASE="theopenco/llmgateway"
PLATFORMS=("linux/amd64" "linux/arm64")
SPLIT_APPS=("api" "gateway" "ui" "docs")

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to show help
show_help() {
    cat << EOF
Usage: $0 [OPTIONS]

Build and push Docker images for LLMGateway

OPTIONS:
    --push              Push images to registry (default: false)
    --registry REGISTRY Registry to push to (default: ghcr.io)
    --repo REPO         Repository base name (default: theopenco/llmgateway)
    --platforms PLATFORMS Platforms to build for (default: linux/amd64,linux/arm64)
    --split-only        Build only split images
    --unified-only      Build only unified images
    --tag TAG           Custom tag (default: v0.0.0-{short-sha})
    --help              Show this help message

Examples:
    $0                  # Build both split and unified images locally
    $0 --push           # Build and push with short SHA tag
    $0 --push --tag v1.0.0  # Build and push with custom tag
    $0 --split-only --push  # Build and push only split images
EOF
}

# Parse command line arguments
PUSH=false
SPLIT_ONLY=false
UNIFIED_ONLY=false
CUSTOM_TAG=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --push)
            PUSH=true
            shift
            ;;
        --registry)
            REGISTRY="$2"
            shift 2
            ;;
        --repo)
            REPOSITORY_BASE="$2"
            shift 2
            ;;
        --platforms)
            IFS=',' read -ra PLATFORMS <<< "$2"
            shift 2
            ;;
        --split-only)
            SPLIT_ONLY=true
            shift
            ;;
        --unified-only)
            UNIFIED_ONLY=true
            shift
            ;;
        --tag)
            CUSTOM_TAG="$2"
            shift 2
            ;;
        --help)
            show_help
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Validate mutually exclusive options
if [[ "$SPLIT_ONLY" == true && "$UNIFIED_ONLY" == true ]]; then
    print_error "--split-only and --unified-only cannot be used together"
    exit 1
fi

# Generate image tag
if [[ -n "$CUSTOM_TAG" ]]; then
    IMAGE_TAG="$CUSTOM_TAG"
else
    SHORT_SHA=$(git rev-parse --short HEAD)
    IMAGE_TAG="v0.0.0-${SHORT_SHA}"
fi

print_status "Building images with tag: $IMAGE_TAG"
print_status "Platforms: ${PLATFORMS[*]}"
print_status "Push: $PUSH"

# Check if docker buildx is available
if ! docker buildx version > /dev/null 2>&1; then
    print_error "Docker buildx is required but not available"
    exit 1
fi

# Function to build multi-arch image directly
build_multiarch_image() {
    local dockerfile="$1"
    local target="$2"
    local image_base="$3"

    # Convert platforms array to comma-separated string
    local platforms_str="${PLATFORMS[0]}"
    for i in $(seq 1 $((${#PLATFORMS[@]} - 1))); do
        platforms_str="${platforms_str},${PLATFORMS[i]}"
    done

    print_status "Building multi-arch image for platforms: $platforms_str"

    local build_args=(
        "buildx" "build"
        "--platform" "$platforms_str"
        "--file" "$dockerfile"
    )

    if [[ -n "$target" ]]; then
        build_args+=("--target" "$target")
    fi

    build_args+=(
        "--tag" "${image_base}:${IMAGE_TAG}"
        "--tag" "${image_base}:latest"
        "--build-arg" "APP_VERSION=${IMAGE_TAG}"
    )

    if [[ "$PUSH" == true ]]; then
        build_args+=("--push")
    else
        # For local builds, we can only load single platform
        # When not pushing, build for current platform only
        local current_platform
        if [[ "$(uname -m)" == "x86_64" ]]; then
            current_platform="linux/amd64"
        elif [[ "$(uname -m)" == "aarch64" ]] || [[ "$(uname -m)" == "arm64" ]]; then
            current_platform="linux/arm64"
        else
            current_platform="linux/amd64"  # fallback
        fi
        # Replace the platforms string with current platform only
        platforms_str="$current_platform"
        build_args[3]="$current_platform"
        build_args+=("--load")
    fi

    build_args+=(".")

    docker "${build_args[@]}" || return 1
}


# Function to wait for all background processes and check results
wait_for_builds() {
    local pids=("$@")
    local failed_builds=()

    print_status "Waiting for ${#pids[@]} build processes to complete..."

    # Wait for all processes
    for pid in "${pids[@]}"; do
        wait "$pid"
    done

    # Check results
    for app in "${SPLIT_APPS[@]}"; do
        if [[ -f "/tmp/build_result_$app" ]]; then
            local result=$(cat "/tmp/build_result_$app")
            if [[ "$result" == "FAILED:$app" ]]; then
                failed_builds+=("$app")
            fi
            rm -f "/tmp/build_result_$app"
        fi
    done

    # Check unified build result if it exists
    if [[ -f "/tmp/build_result_unified" ]]; then
        local result=$(cat "/tmp/build_result_unified")
        if [[ "$result" == "FAILED:unified" ]]; then
            failed_builds+=("unified")
        fi
        rm -f "/tmp/build_result_unified"
    fi
    

    # Return failure if any builds failed
    if [[ ${#failed_builds[@]} -gt 0 ]]; then
        print_error "The following builds failed: ${failed_builds[*]}"
        return 1
    fi

    return 0
}

# Build all apps
pnpm build

# Build split images
if [[ "$UNIFIED_ONLY" != true ]]; then
    print_status "Building split images in parallel..."

    declare -a build_pids=()

    for app in "${SPLIT_APPS[@]}"; do
        print_status "Starting build for $app multi-arch image..."
        IMAGE_NAME="${REGISTRY}/${REPOSITORY_BASE}-${app}"

        {
            if build_multiarch_image "infra/split.dockerfile" "$app" "$IMAGE_NAME"; then
                print_success "Successfully built $app image"
                echo "SUCCESS:$app" > "/tmp/build_result_$app"
            else
                print_error "Failed to build $app image"
                echo "FAILED:$app" > "/tmp/build_result_$app"
            fi
        } &
        build_pids+=("$!")
    done

    # Wait for all split builds to complete
    if ! wait_for_builds "${build_pids[@]}"; then
        exit 1
    fi

    print_success "All split images built successfully"
fi

# Build unified image
if [[ "$SPLIT_ONLY" != true ]]; then
    print_status "Building unified multi-arch image..."

    IMAGE_NAME="${REGISTRY}/${REPOSITORY_BASE}-unified"

    {
        if build_multiarch_image "infra/unified.dockerfile" "" "$IMAGE_NAME"; then
            print_success "Successfully built unified image"
            echo "SUCCESS:unified" > "/tmp/build_result_unified"
        else
            print_error "Failed to build unified image"
            echo "FAILED:unified" > "/tmp/build_result_unified"
        fi
    } &
    unified_pid=$!

    # Wait for unified build to complete
    if ! wait_for_builds "${unified_pid}"; then
        exit 1
    fi

    print_success "Unified image built successfully"
fi

# Summary
print_success "Build process completed!"
if [[ "$PUSH" == true ]]; then
    print_success "Images pushed to registry with tag: $IMAGE_TAG"

    if [[ "$UNIFIED_ONLY" != true ]]; then
        echo ""
        print_status "Split images:"
        for app in "${SPLIT_APPS[@]}"; do
            echo "  ${REGISTRY}/${REPOSITORY_BASE}-${app}:${IMAGE_TAG}"
        done
    fi

    if [[ "$SPLIT_ONLY" != true ]]; then
        echo ""
        print_status "Unified image:"
        echo "  ${REGISTRY}/${REPOSITORY_BASE}-unified:${IMAGE_TAG}"
    fi
else
    print_status "Images built locally (not pushed)"
fi
