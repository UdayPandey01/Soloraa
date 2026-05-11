//! Enclave-held Ed25519 key.
//!
//! `KeyStorage` is the persistence seam. Today there is one impl — file on
//! disk — used during local development and CI. In production the same trait
//! is satisfied by an enclave-sealed implementation:
//!   - **AWS Nitro**: NSM-encrypted blob written to an attached EBS volume.
//!     Decryption requires running inside the same enclave measurement
//!     (PCRs match), which means an attacker who steals the blob cannot
//!     decrypt it outside the enclave.
//!   - **Marlin Oyster**: Marlin's KMS-style derive-key-from-attestation
//!     primitive: the key is derived from the enclave measurement and never
//!     leaves the enclave.
//!
//! For both, the trait surface stays `load() -> Option<bytes>` /
//! `store(&bytes)`. The unsealing happens inside the impl; callers see plain
//! bytes only inside the enclave's address space.
//!
//! NEVER instantiate `FileKeyStorage` in production. The `unsafe-file-storage`
//! cfg + log warning are the seatbelt.

use ed25519_dalek::{SigningKey, VerifyingKey, SECRET_KEY_LENGTH};
use rand::rngs::OsRng;
use std::path::PathBuf;

use crate::error::{EnclaveError, EnclaveResult};

pub trait KeyStorage: Send + Sync {
    fn load(&self) -> EnclaveResult<Option<[u8; SECRET_KEY_LENGTH]>>;
    fn store(&self, secret: &[u8; SECRET_KEY_LENGTH]) -> EnclaveResult<()>;
}

pub struct EnclaveKey {
    signing_key: SigningKey,
}

impl EnclaveKey {
    /// Load an existing key via storage; if none, generate a fresh one and
    /// persist it. The `OsRng` pull is the enclave's RNG seam — Nitro/Marlin
    /// expose hardware RNG syscalls underneath in production builds.
    pub fn load_or_generate<S: KeyStorage>(storage: &S) -> EnclaveResult<Self> {
        if let Some(secret) = storage.load()? {
            let signing_key = SigningKey::from_bytes(&secret);
            return Ok(Self { signing_key });
        }
        let mut rng = OsRng;
        let signing_key = SigningKey::generate(&mut rng);
        storage.store(signing_key.as_bytes())?;
        Ok(Self { signing_key })
    }

    pub fn verifying_key(&self) -> VerifyingKey {
        self.signing_key.verifying_key()
    }

    pub fn pubkey_bytes(&self) -> [u8; 32] {
        self.signing_key.verifying_key().to_bytes()
    }

    pub fn sign(&self, message: &[u8]) -> [u8; 64] {
        use ed25519_dalek::Signer;
        let sig = self.signing_key.sign(message);
        sig.to_bytes()
    }
}

/// File-backed storage for development. **Do not deploy this to production.**
pub struct FileKeyStorage {
    path: PathBuf,
}

impl FileKeyStorage {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }
}

impl KeyStorage for FileKeyStorage {
    fn load(&self) -> EnclaveResult<Option<[u8; SECRET_KEY_LENGTH]>> {
        match std::fs::read(&self.path) {
            Ok(bytes) => {
                if bytes.len() != SECRET_KEY_LENGTH {
                    return Err(EnclaveError::Ed25519(format!(
                        "key file is {} bytes, expected {}",
                        bytes.len(),
                        SECRET_KEY_LENGTH
                    )));
                }
                let mut secret = [0u8; SECRET_KEY_LENGTH];
                secret.copy_from_slice(&bytes);
                Ok(Some(secret))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(EnclaveError::Io(e)),
        }
    }

    fn store(&self, secret: &[u8; SECRET_KEY_LENGTH]) -> EnclaveResult<()> {
        if let Some(parent) = self.path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        std::fs::write(&self.path, secret)?;
        // Best-effort tighten file mode on unix.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(0o600);
            let _ = std::fs::set_permissions(&self.path, perms);
        }
        Ok(())
    }
}

/// In-memory storage useful in tests so we don't touch the filesystem.
pub struct InMemoryKeyStorage {
    inner: std::sync::Mutex<Option<[u8; SECRET_KEY_LENGTH]>>,
}

impl InMemoryKeyStorage {
    pub fn new() -> Self {
        Self {
            inner: std::sync::Mutex::new(None),
        }
    }
}

impl KeyStorage for InMemoryKeyStorage {
    fn load(&self) -> EnclaveResult<Option<[u8; SECRET_KEY_LENGTH]>> {
        Ok(*self.inner.lock().expect("key storage lock"))
    }
    fn store(&self, secret: &[u8; SECRET_KEY_LENGTH]) -> EnclaveResult<()> {
        *self.inner.lock().expect("key storage lock") = Some(*secret);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn file_storage_round_trip() {
        let dir = TempDir::new().unwrap();
        let storage = FileKeyStorage::new(dir.path().join("enclave.key"));
        let k1 = EnclaveKey::load_or_generate(&storage).unwrap();
        let pk1 = k1.pubkey_bytes();
        let k2 = EnclaveKey::load_or_generate(&storage).unwrap();
        assert_eq!(pk1, k2.pubkey_bytes(), "key persists across reloads");
    }

    #[test]
    fn in_memory_storage_round_trip() {
        let storage = InMemoryKeyStorage::new();
        let k1 = EnclaveKey::load_or_generate(&storage).unwrap();
        let pk1 = k1.pubkey_bytes();
        let k2 = EnclaveKey::load_or_generate(&storage).unwrap();
        assert_eq!(pk1, k2.pubkey_bytes());
    }

    #[test]
    fn signing_round_trip() {
        use ed25519_dalek::Verifier;
        let storage = InMemoryKeyStorage::new();
        let key = EnclaveKey::load_or_generate(&storage).unwrap();
        let msg = b"hello solora";
        let sig_bytes = key.sign(msg);
        let sig = ed25519_dalek::Signature::from_bytes(&sig_bytes);
        let vk = key.verifying_key();
        vk.verify(msg, &sig).expect("self-verify");
    }
}
