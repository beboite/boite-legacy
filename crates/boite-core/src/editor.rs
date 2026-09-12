use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;

const MAX_TEXT_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    pub content: String,
    pub size: u64,
    pub is_readonly: bool,
    // Non-UTF-8 input decoded lossily: replacement chars stand in for the
    // original bytes, so saving this content back would corrupt the file.
    pub lossy: bool,
}

pub fn read_blocking(path: &str) -> Result<TextFile, String> {
    let p = Path::new(path);
    if !p.is_file() {
        return Err("not a file".into());
    }
    let meta = fs::metadata(p).map_err(|e| format!("stat failed: {e}"))?;
    let size = meta.len();
    if size > MAX_TEXT_BYTES {
        return Err(format!(
            "file too large ({} bytes > {} max)",
            size, MAX_TEXT_BYTES
        ));
    }
    let bytes = fs::read(p).map_err(|e| format!("read failed: {e}"))?;
    if looks_binary(&bytes) {
        return Err("binary file".into());
    }
    let (content, lossy) = match String::from_utf8(bytes) {
        Ok(s) => (s, false),
        Err(e) => (String::from_utf8_lossy(&e.into_bytes()).into_owned(), true),
    };
    let is_readonly = meta.permissions().readonly();
    Ok(TextFile {
        content,
        size,
        is_readonly,
        lossy,
    })
}

fn looks_binary(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(8192)];
    head.contains(&0u8)
}

/// The largest document a window will be handed in one piece.
///
/// The bytes cross to the page as one base64 string, so this is a memory
/// ceiling on the window rather than a disk limit. A 64 MB PDF is already a poor
/// thing to open in a side pane.
pub const MAX_VIEW_BYTES: u64 = 64 * 1024 * 1024;

/// A whole file, base64, for a window to draw.
///
/// PDFs and images: [`read_blocking`] refuses them at the first NUL byte, and
/// there is nowhere else for the bytes to come from. Base64 rather than a byte
/// array because both transports serialise `Vec<u8>` as a JSON array of numbers
/// — six characters per byte instead of one and a third.
pub fn read_base64_blocking(path: &str) -> Result<String, String> {
    use base64::Engine as _;

    let meta = fs::metadata(path).map_err(|e| format!("stat failed: {e}"))?;
    if meta.len() > MAX_VIEW_BYTES {
        return Err(format!(
            "file too large ({} bytes > {} max)",
            meta.len(),
            MAX_VIEW_BYTES
        ));
    }
    let bytes = fs::read(path).map_err(|e| format!("read failed: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

pub fn write_blocking(path: &str, content: &str) -> Result<u64, String> {
    let p = Path::new(path);
    if p.parent().is_none() {
        return Err("invalid path: no parent".to_string());
    }
    // Resolve symlinks: rename() replaces the link itself otherwise, turning a
    // symlinked config into a regular file on first save. canonicalize fails for
    // a file that does not exist yet, which is the create case — keep the path.
    let target = fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    let parent = target
        .parent()
        .ok_or_else(|| "invalid path: no parent".to_string())?;
    if !parent.is_dir() {
        return Err(format!("parent not a directory: {}", parent.display()));
    }
    let file_name = target
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "invalid path: no file name".to_string())?;

    // Write-then-rename is atomic, but the replacement is a NEW inode: without
    // carrying the mode over, the saved file gets the umask default and silently
    // loses the original's permissions (an executable script lost its +x bit).
    let original_perms = fs::metadata(&target).ok().map(|m| m.permissions());

    // The temp file must sit beside the RESOLVED target, not beside the link:
    // rename across filesystems fails with EXDEV.
    let mut tmp_path: PathBuf = parent.to_path_buf();
    tmp_path.push(format!(".{}.boite.tmp", file_name));

    {
        let mut f = fs::File::create(&tmp_path).map_err(|e| format!("create temp failed: {e}"))?;
        f.write_all(content.as_bytes())
            .map_err(|e| format!("write temp failed: {e}"))?;
        f.sync_all().map_err(|e| format!("fsync failed: {e}"))?;
    }

    if let Some(perms) = original_perms {
        let _ = fs::set_permissions(&tmp_path, perms);
    }

    if let Err(e) = fs::rename(&tmp_path, &target) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("rename failed: {e}"));
    }
    Ok(content.len() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Seek, Write};

    #[test]
    fn read_blocking_rejects_non_file() {
        let tmp = std::env::temp_dir();
        let dir = tmp.join(format!("boite_test_nonfile_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let result = read_blocking(&dir.to_string_lossy());
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "not a file");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_blocking_rejects_oversized_file() {
        let tmp = std::env::temp_dir();
        let path = tmp.join(format!("boite_test_big_{}.txt", std::process::id()));
        // Write a file just over MAX_TEXT_BYTES by writing one byte past the limit.
        let mut f = fs::File::create(&path).unwrap();
        let chunk = vec![0u8; 1024];
        let mut written = 0u64;
        while written < MAX_TEXT_BYTES {
            f.write_all(&chunk).unwrap();
            written += 1024;
        }
        f.write_all(&[0u8]).unwrap();
        drop(f);
        let result = read_blocking(&path.to_string_lossy());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too large"));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn read_blocking_rejects_binary_files() {
        let tmp = std::env::temp_dir();
        let path = tmp.join(format!("boite_test_bin_{}.txt", std::process::id()));
        let mut f = fs::File::create(&path).unwrap();
        f.write_all(b"hello\x00world").unwrap();
        drop(f);
        let result = read_blocking(&path.to_string_lossy());
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "binary file");
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn read_blocking_reads_utf8() {
        let tmp = std::env::temp_dir();
        let path = tmp.join(format!("boite_test_utf8_{}.txt", std::process::id()));
        fs::write(&path, "héllo wörld\n").unwrap();
        let result = read_blocking(&path.to_string_lossy()).unwrap();
        assert!(!result.lossy);
        assert_eq!(result.content, "héllo wörld\n");
        assert!(!result.is_readonly);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn read_blocking_marks_lossy_utf8() {
        let tmp = std::env::temp_dir();
        let path = tmp.join(format!("boite_test_lossy_{}.txt", std::process::id()));
        // 0xFF is invalid UTF-8 on its own.
        fs::write(&path, b"prefix\xFFsuffix").unwrap();
        let result = read_blocking(&path.to_string_lossy()).unwrap();
        assert!(result.lossy);
        assert!(result.content.contains("prefix"));
        assert!(result.content.contains("suffix"));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn read_base64_round_trips_bytes() {
        use base64::Engine as _;
        let tmp = std::env::temp_dir();
        let path = tmp.join(format!("boite_test_b64_{}.bin", std::process::id()));
        let bytes = b"hello\x00world\x01\x02";
        fs::write(&path, bytes).unwrap();
        let encoded = read_base64_blocking(&path.to_string_lossy()).unwrap();
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&encoded)
            .unwrap();
        assert_eq!(decoded, bytes);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn read_base64_rejects_oversized_file() {
        let tmp = std::env::temp_dir();
        let path = tmp.join(format!("boite_test_bigb64_{}.bin", std::process::id()));
        // Create a sparse file larger than MAX_VIEW_BYTES
        let mut f = fs::File::create(&path).unwrap();
        f.seek(std::io::SeekFrom::Start(MAX_VIEW_BYTES + 1))
            .unwrap();
        f.write_all(&[0u8]).unwrap();
        drop(f);
        let result = read_base64_blocking(&path.to_string_lossy());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too large"));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn write_blocking_creates_new_file() {
        let tmp = std::env::temp_dir();
        let dir = tmp.join(format!("boite_test_write_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("output.txt");
        let result = write_blocking(&path.to_string_lossy(), "hello write\n");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "hello write\n".len() as u64);
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello write\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_blocking_rejects_no_parent() {
        let result = write_blocking("", "content");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("parent"));
    }

    #[test]
    fn write_blocking_rejects_nonexistent_parent() {
        let tmp = std::env::temp_dir();
        let path = tmp.join(format!(
            "boite_test_noparent_{}/file.txt",
            std::process::id()
        ));
        let result = write_blocking(&path.to_string_lossy(), "content");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("parent not a directory"));
    }

    #[test]
    fn looks_binary_detects_nul_byte() {
        assert!(looks_binary(&[0u8]));
        assert!(looks_binary(b"hello\x00world"));
        assert!(!looks_binary(b"hello world"));
        assert!(!looks_binary(&[]));
    }
}
