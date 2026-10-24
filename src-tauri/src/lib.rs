// Library entry so the same shell can later be reused for mobile targets.
// The frontend is a self-contained SPA (React + Supabase JS client); it
// needs no native plugins. Assets are served from the bundled `dist`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Vaultfolio desktop");
}
