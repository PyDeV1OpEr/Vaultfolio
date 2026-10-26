fn main() {
    // Tauri embeds `frontendDist` into the native binary at Cargo build-script
    // time. Watch the Vite output so a frontend-only change can never reuse a
    // stale embedded asset bundle from an incremental Cargo build or CI cache.
    println!("cargo::rerun-if-changed=../dist");
    tauri_build::build()
}
