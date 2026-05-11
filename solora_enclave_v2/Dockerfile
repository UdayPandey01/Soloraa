FROM rust:1.83-slim-bookworm AS builder
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

ENV SOLORA_ENCLAVE_BIND=0.0.0.0:8080
ENV SOLORA_ENCLAVE_KEY_PATH=/var/lib/solora/enclave.key

VOLUME ["/var/lib/solora"]

EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/app/solora-enclave"]
