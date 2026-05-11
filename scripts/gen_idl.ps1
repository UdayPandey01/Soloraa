$ErrorActionPreference = "Stop"

anchor build
Copy-Item -Force .\target\idl\solora.json .\solora_relayer\solora.json
