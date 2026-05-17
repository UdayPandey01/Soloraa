#!/usr/bin/env bash
# Deploy the Solora enclave image to Marlin Oyster CVM.
#
# Prerequisites:
#   - docker, oyster-cvm CLI installed and authenticated
#   - $OYSTER_WALLET_KEY set (private key with USDC for the deployment)
#
# Env (override before running, or set in env/oyster.env):
#   OYSTER_INSTANCE_TYPE    default: c6a.xlarge
#   OYSTER_DURATION         default: 24h
#   OYSTER_REGION           default: us-east-1
#   IMAGE_REPO              default: ghcr.io/<your-org>/solora-enclave
#   IMAGE_TAG               default: $(git rev-parse --short HEAD)
#
# Usage:
#   bash scripts/deploy_oyster.sh build       # docker build + push
#   bash scripts/deploy_oyster.sh deploy      # oyster-cvm deploy
#   bash scripts/deploy_oyster.sh attest      # curl /attestation/raw on the deployed CVM
#   bash scripts/deploy_oyster.sh register    # full on-chain registration
#   bash scripts/deploy_oyster.sh (no arg)    # build + deploy + register, end to end

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Load env if present.
if [[ -f env/oyster.env ]]; then
    set -a
    # shellcheck disable=SC1091
    source env/oyster.env
    set +a
fi

OYSTER_INSTANCE_TYPE="${OYSTER_INSTANCE_TYPE:-c6a.xlarge}"
OYSTER_DURATION="${OYSTER_DURATION:-24h}"
OYSTER_REGION="${OYSTER_REGION:-us-east-1}"
IMAGE_REPO="${IMAGE_REPO:-ghcr.io/solora/enclave}"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo dev)}"
IMAGE="$IMAGE_REPO:$IMAGE_TAG"

log() { printf '\033[36m[deploy_oyster]\033[0m %s\n' "$*" >&2; }
need() {
    command -v "$1" >/dev/null 2>&1 || { echo "missing dep: $1" >&2; exit 1; }
}

cmd_build() {
    need docker
    log "building $IMAGE"
    docker build -f solora_enclave_v2/Dockerfile -t "$IMAGE" solora_enclave_v2
    log "pushing $IMAGE"
    docker push "$IMAGE"
    echo "$IMAGE" > .last-oyster-image
}

cmd_deploy() {
    need oyster-cvm
    local image="${IMAGE:-$(cat .last-oyster-image 2>/dev/null || true)}"
    if [[ -z "$image" ]]; then
        echo "no image — run 'build' first" >&2
        exit 1
    fi
    if [[ -z "${OYSTER_WALLET_KEY:-}" ]]; then
        echo "OYSTER_WALLET_KEY is required (the private key paying for the CVM)" >&2
        exit 1
    fi
    log "deploying $image to Marlin Oyster ($OYSTER_INSTANCE_TYPE / $OYSTER_REGION / $OYSTER_DURATION)"

    oyster-cvm deploy \
        --wallet-private-key "$OYSTER_WALLET_KEY" \
        --image "$image" \
        --instance-type "$OYSTER_INSTANCE_TYPE" \
        --region "$OYSTER_REGION" \
        --duration "$OYSTER_DURATION" \
        --env-file env/enclave.env \
        --port 8080 \
        --port 1300 \
        | tee .last-oyster-deploy.log

    # The deploy command prints the assigned URL. Persist for later steps.
    grep -E 'https?://[^ ]*\.oyster\.marlin\.org' .last-oyster-deploy.log \
        | head -n1 \
        | tr -d '[:space:]' \
        > .last-oyster-url
    log "CVM URL: $(cat .last-oyster-url)"
}

cmd_attest() {
    need curl
    local url
    url="${OYSTER_URL:-$(cat .last-oyster-url 2>/dev/null || true)}"
    if [[ -z "$url" ]]; then
        echo "no Oyster URL — pass OYSTER_URL=... or run 'deploy' first" >&2
        exit 1
    fi
    log "fetching attestation from $url"
    # Use a 32-byte zero pubkey just for the probe.
    local zero_hex
    zero_hex=$(printf '00%.0s' {1..32})
    curl -sS "$url/attestation/raw?public_key=$zero_hex&user_data=$zero_hex&nonce=$zero_hex" \
        | tee .last-oyster-attestation.hex \
        | head -c 200
    echo
    log "wrote .last-oyster-attestation.hex ($(wc -c < .last-oyster-attestation.hex) bytes)"
}

cmd_register() {
    need npx
    local url
    url="${OYSTER_URL:-$(cat .last-oyster-url 2>/dev/null || true)}"
    if [[ -z "$url" ]]; then
        echo "no Oyster URL — pass OYSTER_URL=... or run 'deploy' first" >&2
        exit 1
    fi
    log "registering enclave on-chain (oyster-url=$url)"
    npx --prefix solora_relayer tsx solora_relayer/ops.ts register-oyster-enclave \
        --oyster-url "$url" \
        --enclave-url "$url"
}

case "${1:-all}" in
    build)    cmd_build ;;
    deploy)   cmd_deploy ;;
    attest)   cmd_attest ;;
    register) cmd_register ;;
    all)      cmd_build && cmd_deploy && cmd_attest && cmd_register ;;
    *)
        echo "unknown subcommand: $1" >&2
        echo "usage: $0 [build|deploy|attest|register]" >&2
        exit 1
        ;;
esac
