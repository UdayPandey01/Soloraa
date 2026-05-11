# Solora — repo-level shortcuts.
# All targets are idempotent and operate from the repo root.

SHELL := /bin/bash
.DEFAULT_GOAL := help
.PHONY: help build sbf test test-program test-enclave smoke clippy idl localnet \
        keys airdrop demo-local enclave relayer compose-up compose-down clean \
        verify frontend-dev frontend-build frontend-install deploy-devnet

help: ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | sort | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

build: ## Build the on-chain program (host + SBF)
	cargo build -p solora --release
	cargo-build-sbf --manifest-path programs/solora/Cargo.toml

sbf: ## Just the SBF .so used by the local validator
	cargo-build-sbf --manifest-path programs/solora/Cargo.toml

test: test-program test-enclave smoke ## Run all test surfaces

test-program: ## LiteSVM tests for the Anchor program
	cargo test -p solora --tests

test-enclave: ## Unit + integration tests for the enclave service
	cargo test -p solora_enclave_v2

smoke: ## Offline relayer smoke checks (IDL, byte layout, sign/verify roundtrip)
	[ -d solora_relayer/node_modules ] || npm --prefix solora_relayer install
	npx tsx solora_relayer/smoke_test.ts

clippy: ## Lint the program + enclave
	cargo clippy -p solora --release
	cargo clippy -p solora_enclave_v2

idl: ## Sync solora_relayer/solora.json into target/idl/solora.json
	./scripts/gen_idl.sh

keys: ## Generate authority + governor keypairs into ./keys
	./scripts/gen_keys.sh keys

airdrop: ## Airdrop 5 SOL each to the local authority + governor
	@AUTH=$$(solana-keygen pubkey keys/authority.json); GOV=$$(solana-keygen pubkey keys/governor.json); \
	  RPC=$${SOLANA_RPC_URL:-http://127.0.0.1:8899}; \
	  solana airdrop 5 $$AUTH --url $$RPC && solana airdrop 5 $$GOV --url $$RPC

localnet: sbf ## Start a local validator with the program preloaded (foreground)
	./scripts/localnet.sh

enclave: ## Run the enclave service in the foreground
	./scripts/start_enclave.sh

relayer: ## Run the relayer / admin CLI (forward args via ARGS=...)
	./scripts/start_relayer.sh $(ARGS)

demo-local: keys airdrop idl ## Run the full local-validator demo flow
	./scripts/demo_local.sh

compose-up: ## docker-compose up for validator + enclave + relayer
	docker compose up --build -d

compose-down: ## docker-compose down
	docker compose down -v

verify: build test ## Belt-and-braces: build everything, run every test surface

deploy-devnet: ## Build + deploy the on-chain program to Solana devnet
	./scripts/deploy_devnet.sh

frontend-install: ## Install Next.js frontend deps
	npm --prefix soloraa_frontend install

frontend-dev: ## Run the Next.js frontend in dev mode (http://localhost:3000)
	npm --prefix soloraa_frontend run dev

frontend-build: ## Production-build the Next.js frontend
	npm --prefix soloraa_frontend run build

clean: ## Wipe build + ledger artifacts (keeps keys/, mock_enclave.json)
	rm -rf .localnet target/debug target/release target/sbf-solana-solana
	rm -rf solora_enclave_v2/target solora_relayer/node_modules
	rm -rf soloraa_frontend/.next soloraa_frontend/node_modules
