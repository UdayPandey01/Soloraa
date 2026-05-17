# Solora enclave image.
#
# Designed to run inside a Marlin Oyster CVM (AWS Nitro / TDX substrate).
# When SOLORA_ATTESTATION_BACKEND=marlin-oyster, the binary calls Oyster's
# local attestation server at SOLORA_OYSTER_ATTEST_URL (default
# http://127.0.0.1:1300) for the platform attestation document.

FROM rust:1.88-slim-bookworm AS builder
WORKDIR /build

RUN apt-get update \
 && apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml ./
COPY src ./src

RUN cargo build --release --bin solora-enclave \
 && strip target/release/solora-enclave

FROM busybox:1.36 AS busybox

FROM gcr.io/distroless/cc-debian12:nonroot
WORKDIR /app
COPY --from=builder /build/target/release/solora-enclave /app/solora-enclave
COPY --from=busybox /bin/busybox /bin/busybox

# ── Network ──────────────────────────────────────────────────────────────────
# 8080: Solora HTTP API (signing, attestation, pubkey).
#       In an Oyster CVM, expose this via the deploy spec's --port 8080.
ENV SOLORA_ENCLAVE_BIND=0.0.0.0:8080
EXPOSE 8080

# ── Attestation ──────────────────────────────────────────────────────────────
# The Oyster CVM runs its attestation server on port 1300 on the loopback
# interface inside the CVM. The image fetches from this URL whenever
# /attestation is requested. To select Marlin Oyster at runtime:
#   SOLORA_ATTESTATION_BACKEND=marlin-oyster
#   SOLORA_OYSTER_ATTEST_URL=http://127.0.0.1:1300   (default)
ENV SOLORA_ATTESTATION_BACKEND=unattested
ENV SOLORA_OYSTER_ATTEST_URL=http://127.0.0.1:1300

# ── Sealed key ───────────────────────────────────────────────────────────────
# Path the enclave loads / generates its Ed25519 signing key at. Mount a
# persistent volume here. On Marlin Oyster, mount a volume bound to the
# CVM image hash so the key is sealed to this exact image.
ENV SOLORA_ENCLAVE_KEY_PATH=/var/lib/solora/enclave.key
VOLUME ["/var/lib/solora"]

USER nonroot:nonroot
ENTRYPOINT ["/app/solora-enclave"]
