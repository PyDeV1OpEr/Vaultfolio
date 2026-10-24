// Vaultfolio desktop entry point. The UI is the existing Vite bundle;
// Rust only owns the window shell. No custom IPC is exposed.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    vaultfolio_lib::run()
}
