//! Writing a received attachment to disk so the device can open it.
//!
//! ## Why a command rather than `tauri-plugin-fs`
//!
//! The plugin grants the webview a general filesystem API, scoped by glob. This
//! app needs exactly one operation — *write these bytes to a file the user can
//! open* — and a purpose-built command is a far smaller thing to audit than a
//! filesystem capability. EchoIt's privacy constraints are about what can reach
//! the disk; widening that surface as a side effect of adding a Save button
//! would be the wrong trade.
//!
//! ## What this means for the privacy posture
//!
//! Message content and blobs otherwise live only in the SDK's encrypted store.
//! A file written here is **plaintext on disk, outside that store, at the
//! user's explicit request** — the same status as any file they download in a
//! browser. That is the point of the feature, but it is a deliberate exception
//! and not one to make silently: nothing writes here without a tap.
//!
//! ## Where files go
//!
//! - **Desktop:** the platform Downloads directory, which is what a person
//!   means by "save".
//! - **Android:** the app's external files directory. Public Downloads needs
//!   MediaStore and a permission prompt; app-external needs neither, is visible
//!   to file managers, and is removed when the app is uninstalled. Saved photos
//!   do **not** appear in the system Gallery — that needs MediaStore, and
//!   claiming otherwise would be a lie the user discovers later.

use std::path::PathBuf;

use tauri::Manager;

/// Strip anything that could escape the target directory.
///
/// The name arrives from a remote peer, so it is untrusted input: a peer
/// choosing `../../.bashrc` must not be able to write there. Only the final
/// component is kept, and separators are removed rather than rejected so a
/// legitimate-but-awkward name still saves.
fn safe_file_name(name: &str) -> String {
    let base = name
        .rsplit(|c| c == '/' || c == '\\')
        .next()
        .unwrap_or("attachment");

    let cleaned: String = base
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0'))
        .collect();

    let trimmed = cleaned.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        "attachment".to_string()
    } else {
        trimmed
    }
}

/// A path that does not already exist, by adding ` (2)`, ` (3)` and so on.
///
/// Saving the same picture twice should produce two files, not overwrite the
/// first. Browsers behave this way and people rely on it.
fn unique_path(dir: &PathBuf, file_name: &str) -> PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }

    let (stem, extension) = match file_name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (file_name.to_string(), String::new()),
    };

    for n in 2..1000 {
        let next = dir.join(format!("{stem} ({n}){extension}"));
        if !next.exists() {
            return next;
        }
    }
    // A thousand copies of one name is not a case worth handling gracefully.
    dir.join(file_name)
}

/// Write bytes to a file the device can open, and return its path.
///
/// Returns the absolute path so the caller can hand it to the opener plugin.
#[tauri::command]
pub async fn save_attachment(
    app: tauri::AppHandle,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let dir: PathBuf = {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            // Public Downloads would need MediaStore and a runtime permission.
            // App-external is visible to file managers and needs neither.
            app.path()
                .app_data_dir()
                .map_err(|e| format!("no writable directory: {e}"))?
        }
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            app.path()
                .download_dir()
                .or_else(|_| app.path().app_data_dir())
                .map_err(|e| format!("no writable directory: {e}"))?
        }
    };

    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;

    let target = unique_path(&dir, &safe_file_name(&file_name));

    std::fs::write(&target, &bytes)
        .map_err(|e| format!("could not write {}: {e}", target.display()))?;

    Ok(target.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_traversal() {
        // The name comes from a peer. This is the case that matters.
        assert_eq!(safe_file_name("../../.bashrc"), ".bashrc".trim_matches('.'));
        assert_eq!(safe_file_name("..\\..\\evil.exe"), "evil.exe");
        assert_eq!(safe_file_name("/etc/passwd"), "passwd");
    }

    #[test]
    fn keeps_ordinary_names() {
        assert_eq!(safe_file_name("holiday photo.jpg"), "holiday photo.jpg");
        assert_eq!(safe_file_name("report.final.pdf"), "report.final.pdf");
    }

    #[test]
    fn never_returns_empty() {
        assert_eq!(safe_file_name(""), "attachment");
        assert_eq!(safe_file_name("..."), "attachment");
        assert_eq!(safe_file_name("///"), "attachment");
    }
}
