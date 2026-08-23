#[cfg(target_os = "android")]
mod android_ctx;
mod iroh_bridge;
mod keychain;
mod updates;

use iroh_bridge::IrohState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Desktop only — see Cargo.toml. On Android this is a no-op and
            // `check_for_update` plus the Releases page is the whole story.
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            let _ = app;
            Ok(())
        })
        .manage(IrohState::default())
        .invoke_handler(tauri::generate_handler![
            iroh_bridge::iroh_start,
            iroh_bridge::iroh_identity,
            iroh_bridge::iroh_stop,
            iroh_bridge::iroh_connect,
            iroh_bridge::iroh_send,
            iroh_bridge::iroh_disconnect,
            keychain::keychain_set,
            keychain::keychain_get,
            keychain::keychain_delete,
            keychain::keychain_available,
            updates::check_for_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
