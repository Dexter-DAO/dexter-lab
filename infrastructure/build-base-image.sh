#!/bin/bash
# Build the x402 base image
#
# This pre-installs @dexterai/x402 + express + TypeScript tooling
# so per-resource deploys only layer source code on top.
#
# Run this:
#   - On first setup
#   - After bumping @dexterai/x402 version
#   - Periodically to pick up security patches in base deps
#
# Usage:
#   ./infrastructure/build-base-image.sh
#   ./infrastructure/build-base-image.sh --check   # Just check if rebuild needed

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SDK_DIR="/home/branchmanager/websites/dexter-x402-sdk"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

IMAGE_NAME="dexter-x402-base:latest"

# Get current SDK version from the SDK repo
get_sdk_version() {
    if [ -f "$SDK_DIR/package.json" ]; then
        node -e "console.log(require('$SDK_DIR/package.json').version)" 2>/dev/null || echo "unknown"
    else
        echo "unknown"
    fi
}

# Get SDK version baked into the current base image
get_image_sdk_version() {
    docker inspect "$IMAGE_NAME" --format '{{index .Config.Labels "dexter.x402.sdk.version"}}' 2>/dev/null || echo "none"
}

# Check if rebuild is needed
check_staleness() {
    local current_sdk
    current_sdk=$(get_sdk_version)
    local image_sdk
    image_sdk=$(get_image_sdk_version)

    if [ "$image_sdk" = "none" ]; then
        echo -e "${YELLOW}[BASE]${NC} No base image found -- build required"
        return 1
    fi

    if [ "$current_sdk" != "$image_sdk" ]; then
        echo -e "${YELLOW}[BASE]${NC} SDK version mismatch: image has $image_sdk, current is $current_sdk -- rebuild recommended"
        return 1
    fi

    echo -e "${GREEN}[BASE]${NC} Base image is up to date (SDK $image_sdk)"
    return 0
}

# Build the base image
build_image() {
    local sdk_version
    sdk_version=$(get_sdk_version)
    local build_date
    build_date=$(date -u +%Y-%m-%d)

    echo -e "${GREEN}[BASE]${NC} Building $IMAGE_NAME (SDK $sdk_version)..."

    # Update the SDK version in the Dockerfile
    sed -i "s|LABEL dexter.x402.sdk.version=.*|LABEL dexter.x402.sdk.version=\"$sdk_version\"|" "$SCRIPT_DIR/Dockerfile.x402-base"
    sed -i "s|LABEL dexter.x402.base.built=.*|LABEL dexter.x402.base.built=\"$build_date\"|" "$SCRIPT_DIR/Dockerfile.x402-base"
    sed -i "s|\"@dexterai/x402\": \".*\"|\"@dexterai/x402\": \"^$sdk_version\"|" "$SCRIPT_DIR/Dockerfile.x402-base"

    docker build \
        -t "$IMAGE_NAME" \
        -f "$SCRIPT_DIR/Dockerfile.x402-base" \
        "$SCRIPT_DIR"

    echo -e "${GREEN}[BASE]${NC} Built $IMAGE_NAME successfully"
    echo -e "${GREEN}[BASE]${NC}   SDK version: $sdk_version"
    echo -e "${GREEN}[BASE]${NC}   Build date:  $build_date"
    echo -e "${GREEN}[BASE]${NC}   Image size:  $(docker images $IMAGE_NAME --format '{{.Size}}')"
}

# Main
case "${1:-build}" in
    build)
        build_image
        ;;
    --check|check)
        check_staleness
        ;;
    *)
        echo "Usage: $0 [build|--check]"
        exit 1
        ;;
esac
