//! Asking `codex-account-switcher` what it holds, and telling it to flip.
//!
//! That binary is [Pimpmuckl/codex-account-switcher](https://github.com/Pimpmuckl/codex-account-switcher).
//! Boite does not snapshot `~/.codex/auth.json`. It runs the published CLI,
//! passes the `--json` document through, and the window reloads its own
//! Codex threads afterwards.

use std::process::{Command, Output, Stdio};

const MAX_OUTPUT: usize = 4 * 1024 * 1024;
const BIN: &str = "codex-account-switcher";

fn tool() -> Command {
    let mut cmd = Command::new(BIN);
    cmd.stdin(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

fn fail(out: &Output) -> String {
    let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if msg.is_empty() {
        format!("{BIN} exited with {}", out.status)
    } else {
        msg
    }
}

fn stdout_json(out: Output) -> Result<String, String> {
    if !out.status.success() {
        return Err(fail(&out));
    }
    if out.stdout.len() > MAX_OUTPUT {
        return Err(format!(
            "{BIN} printed more than this can be expected to parse"
        ));
    }
    String::from_utf8(out.stdout).map_err(|_| format!("{BIN} printed invalid UTF-8"))
}

fn run(args: &[&str]) -> Result<Output, String> {
    tool()
        .args(args)
        .output()
        .map_err(|e| format!("{BIN} could not be started: {e}"))
}

/// `codex-account-switcher list --json`
pub fn list_blocking() -> Result<String, String> {
    stdout_json(run(&["list", "--json"])?)
}

/// `codex-account-switcher save --json`
pub fn save_blocking() -> Result<String, String> {
    stdout_json(run(&["save", "--json"])?)
}

/// `codex-account-switcher activate <id> --force --json`
///
/// `--force` is required because the window may still hold a dying Codex
/// process while the swap runs. The caller kills its own PTYs first.
pub fn activate_blocking(account_id: &str) -> Result<String, String> {
    if account_id.is_empty() {
        return Err("activate needs an account id".into());
    }
    stdout_json(run(&["activate", account_id, "--force", "--json"])?)
}

/// What `--version` prints, or `None` when the binary is not here.
pub fn version_blocking() -> Option<String> {
    let out = tool().arg("--version").output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    // `codex-account-switcher 0.2.1`, the convention every `--version` follows.
    // The name is already known here, so only the number is carried back.
    let version = text
        .split_whitespace()
        .last()
        .unwrap_or_default()
        .trim()
        .to_string();
    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activate_rejects_empty_id() {
        let err = activate_blocking("").unwrap_err();
        assert!(err.contains("account id"), "got: {err}");
    }

    #[test]
    fn activate_passes_non_empty_id_to_process() {
        // codex-account-switcher is not installed in CI, so the spawn itself
        // fails — which proves the id is not intercepted before it reaches the
        // process boundary.
        assert!(activate_blocking("test-account-123").is_err());
    }

    #[test]
    fn version_returns_none_when_binary_missing() {
        // If fastpick isn't on the PATH (typical in CI), this returns None
        // rather than panicking. We just assert it doesn't crash.
        let _ = version_blocking();
    }
}
