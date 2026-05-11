# Multi-stage build for Solora's secure-execution enclave.
#
# This image is intended to run inside a CVM:
#   - Marlin Oyster: built directly, run inside a Marlin Confidential VM. The
#     Marlin runtime exposes /dev/marlin-attestation for AttestationProvider
#     to consume.
#   - AWS Nitro: convert to an EIF via `nitro-cli build-enclave --docker-uri ...`
#     on the parent host. Inside, /dev/nsm provides attestation; vsock-proxy on
#     the parent forwards the relayer's HTTP traffic.
#
# The runtime image is intentionally minimal — distroless-ish — so the
# enclave's measurement (PCRs / Marlin image-hash) stays small and stable.

# ---- builder ----
FROM rust:1.83-slim-bookworm AS builder
WORKDIR /build

RUN apt-get update \
 && apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Cache dep build by copying manifests first.
COPY Cargo.toml ./
COPY src ./src

RUN cargo build --release --bin solora-enclave \
 && strip target/release/solora-enclave

# ---- busybox (for healthcheck) ----
FROM busybox:1.36 AS busybox

# ---- runtime ----
FROM gcr.io/distroless/cc-debian12:nonroot
WORKDIR /app
COPY --from=builder /build/target/release/solora-enclave /app/solora-enclave
COPY --from=busybox /bin/busybox /bin/busybox

ENV SOLORA_ENCLAVE_BIND=0.0.0.0:8080
ENV SOLORA_ENCLAVE_KEY_PATH=/var/lib/solora/enclave.key

# /var/lib/solora must be a sealed mount in production:
#   - Nitro: an encrypted EBS volume bound to the enclave's PCRs via NSM.
#   - Marlin: Marlin's persistent encrypted store keyed by image hash.
# The image itself contains no secrets.
VOLUME ["/var/lib/solora"]

EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/app/solora-enclave"]
