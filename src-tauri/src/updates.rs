//! Update checking — Q21.
//!
//! Two tracks, because Tauri v2 has no Android updater.
//!
//! **Windows** uses `tauri-plugin-updater`, which downloads and installs in
//! place. That happens in Rust, outside the webview, which is why none of this
//! needs the CSP widened — see below.
//!
//! **Android** has no in-place mechanism at all. The check here reads the
//! release feed and reports what it finds; installing means the user opening
//! the Release page and reinstalling the APK over the old one. That only works
//! if the new APK is signed with the same release keystore — Android refuses an
//! update signed by a different key, and reinstalling from scratch wipes the
//! app sandbox along with the message store, which has no server copy.
//!
//! **Why this is a `#[tauri::command]` and not a `fetch()` in the frontend.**
//! The CSP is `connect-src 'self' ipc: http://ipc.localhost` and Q16 is closed
//! and verified at zero violations. A frontend request to github.com would be
//! blocked, and widening the policy to allow it would trade a checkable
//! property — "the app cannot reach anywhere else even if a dependency tried" —
//! for a convenience. The request belongs in Rust.
//!
//! What this sends: an unauthenticated GET for a public release feed. No
//! identifier, no counter, nothing about the user — matching what
//! `PRODUCT.md` §4.3 promises. GitHub still observes an IP address and roughly
//! when the app was opened, which §4.3 says out loud rather than hiding.

use serde::{Deserialize, Serialize};

/// Where the Android check looks. The desktop updater reads its own endpoint
/// from `tauri.conf.json`; this is deliberately the same release, so the two
/// tracks cannot drift to different versions.
const RELEASE_API: &str =
    "https://api.github.com/repos/mrsarthi/EchoIt-CB/releases/latest";

/// Human-facing page the user is sent to when an update exists on Android.
const RELEASE_PAGE: &str = "https://github.com/mrsarthi/EchoIt-CB/releases/latest";

/// What a check found.
///
/// `available: false` with no error is a successful check that found nothing —
/// distinct from `error`, which means we could not tell. Collapsing the two
/// would let "you are up to date" be shown to someone who is not.
#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateStatus {
    pub available: bool,
    pub current: String,
    /// Absent when the check failed or nothing newer exists.
    pub latest: Option<String>,
    pub release_page: String,
    /// Present only when the check could not be completed.
    pub error: Option<String>,
}

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

/// Compare two dotted version strings numerically.
///
/// String comparison gets this wrong in a way that matters: "0.10.0" sorts
/// before "0.9.0" lexically, so a tester on 0.9.0 would never be told about
/// 0.10.0. Missing components count as zero, so "0.2" and "0.2.0" match.
fn is_newer(latest: &str, current: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> {
        v.trim_start_matches(['v', 'V'])
            .split(['.', '-'])
            .map(|part| part.parse::<u64>().unwrap_or(0))
            .collect()
    };
    let (l, c) = (parse(latest), parse(current));
    for i in 0..l.len().max(c.len()) {
        let a = l.get(i).copied().unwrap_or(0);
        let b = c.get(i).copied().unwrap_or(0);
        if a != b {
            return a > b;
        }
    }
    false
}

/// Ask GitHub whether a newer release exists.
///
/// Never returns `Err`: a failed check is a normal outcome — the user may be
/// offline, or have no network at all — and surfacing it as a rejected promise
/// would put an error banner in front of someone whose app is working fine.
/// The failure is reported in the payload instead, so the UI can say "could not
/// check" rather than "up to date".
#[tauri::command]
pub async fn check_for_update(app_version: String) -> UpdateStatus {
    let failed = |message: String| UpdateStatus {
        available: false,
        current: app_version.clone(),
        latest: None,
        release_page: RELEASE_PAGE.to_string(),
        error: Some(message),
    };

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        // GitHub rejects requests without one.
        .user_agent(concat!("EchoIt/", env!("CARGO_PKG_VERSION")))
        .build()
    {
        Ok(c) => c,
        Err(e) => return failed(e.to_string()),
    };

    let response = match client.get(RELEASE_API).send().await {
        Ok(r) => r,
        Err(e) => return failed(e.to_string()),
    };

    if !response.status().is_success() {
        return failed(format!("release feed returned {}", response.status()));
    }

    let release: GithubRelease = match response.json().await {
        Ok(r) => r,
        Err(e) => return failed(e.to_string()),
    };

    // A draft or pre-release is not something to send a beta tester to.
    if release.draft || release.prerelease {
        return UpdateStatus {
            available: false,
            current: app_version,
            latest: None,
            release_page: RELEASE_PAGE.to_string(),
            error: None,
        };
    }

    let newer = is_newer(&release.tag_name, &app_version);
    UpdateStatus {
        available: newer,
        current: app_version,
        latest: newer.then(|| release.tag_name.clone()),
        release_page: RELEASE_PAGE.to_string(),
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::is_newer;

    #[test]
    fn compares_numerically_not_lexically() {
        // The case string comparison gets wrong.
        assert!(is_newer("0.10.0", "0.9.0"));
        assert!(!is_newer("0.9.0", "0.10.0"));
    }

    #[test]
    fn tolerates_a_v_prefix_and_missing_components() {
        assert!(is_newer("v0.2.0", "0.1.0"));
        assert!(!is_newer("0.2", "0.2.0"));
        assert!(!is_newer("0.1.0", "0.1.0"));
    }
}
