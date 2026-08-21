mod iroh_bridge;
mod keychain;

use iroh_bridge::IrohState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
