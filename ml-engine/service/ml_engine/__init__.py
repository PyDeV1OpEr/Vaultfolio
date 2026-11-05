"""Vaultfolio Intelligence local ML engine.

A module executed by the bundled CPython runtime. Communicates with the
Tauri (Rust) main process over NDJSON on stdin/stdout. Never shells out,
never touches the network, and only reads/writes paths supplied by the
Tauri process (which validates them).
"""

__version__ = "1.0.0"

ENGINE_NAME = "Vaultfolio Intelligence Engine"
