use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_hidden: bool,
}

pub fn read_dir_blocking(path: String) -> Result<Vec<DirEntry>, String> {
    let p = Path::new(&path);
    if !p.is_dir() {
        return Err("not a directory".into());
    }

    let iter = std::fs::read_dir(p).map_err(|e| format!("read_dir failed: {e}"))?;
    let mut entries: Vec<DirEntry> = Vec::new();
    for item in iter.flatten() {
        let Ok(file_type) = item.file_type() else {
            continue;
        };
        let Some(name) = item.file_name().to_str().map(|s| s.to_string()) else {
            continue;
        };
        let Some(path_str) = item.path().to_str().map(|s| s.to_string()) else {
            continue;
        };
        let is_hidden = name.starts_with('.');
        entries.push(DirEntry {
            name,
            path: path_str,
            is_dir: file_type.is_dir(),
            is_hidden,
        });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub is_dir: bool,
}

const SKIP_DIRS: &[&str] = &[
    ".git",
    // Thread worktrees live here, so this one directory holds a full copy of
    // the project per open thread. Without it a search that matches nothing
    // walks every copy to the end: the hit cap stops the pushing, not the
    // recursion.
    ".boite",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    ".svelte-kit",
    ".next",
    ".turbo",
    ".cache",
    ".vite",
    ".nuxt",
    ".parcel-cache",
    "__pycache__",
    ".venv",
    "venv",
    ".tox",
    ".mypy_cache",
    ".pytest_cache",
];

pub fn search_blocking(root: &str, query: &str, limit: u32) -> Result<Vec<SearchHit>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let root_path = PathBuf::from(root);
    if !root_path.is_dir() {
        return Err("not a directory".into());
    }
    let needle = trimmed.to_lowercase();
    let cap = limit.clamp(1, 2000) as usize;
    let mut hits: Vec<SearchHit> = Vec::new();
    walk(&root_path, &needle, cap, &mut hits);
    hits.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.path.to_lowercase().cmp(&b.path.to_lowercase()),
    });
    Ok(hits)
}

fn walk(dir: &Path, needle: &str, cap: usize, hits: &mut Vec<SearchHit>) {
    if hits.len() >= cap {
        return;
    }
    let Ok(iter) = std::fs::read_dir(dir) else {
        return;
    };
    for item in iter.flatten() {
        if hits.len() >= cap {
            return;
        }
        let Ok(file_type) = item.file_type() else {
            continue;
        };
        let Some(name) = item.file_name().to_str().map(|s| s.to_string()) else {
            continue;
        };
        let is_dir = file_type.is_dir();
        if is_dir && SKIP_DIRS.iter().any(|s| s.eq_ignore_ascii_case(&name)) {
            continue;
        }
        let path = item.path();
        let Some(path_str) = path.to_str().map(|s| s.to_string()) else {
            continue;
        };
        if name.to_lowercase().contains(needle) {
            hits.push(SearchHit {
                path: path_str.clone(),
                is_dir,
            });
        }
        if is_dir {
            walk(&path, needle, cap, hits);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmpdir() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "boite-explorer-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ))
    }

    #[test]
    fn read_dir_blocking_rejects_non_dir() {
        let result = read_dir_blocking("/nonexistent/path".into());
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "not a directory");
    }

    #[test]
    fn read_dir_blocking_sorts_dirs_first() {
        let dir = tmpdir();
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("zfile.txt"), "a").unwrap();
        fs::write(dir.join("afile.txt"), "b").unwrap();
        fs::create_dir_all(dir.join("a_dir")).unwrap();
        fs::create_dir_all(dir.join("z_dir")).unwrap();

        let entries = read_dir_blocking(dir.to_str().unwrap().to_string()).unwrap();
        assert_eq!(entries.len(), 4);
        // Directories come first, then files alphabetically.
        assert!(entries[0].is_dir && entries[0].name == "a_dir");
        assert!(entries[1].is_dir && entries[1].name == "z_dir");
        assert!(!entries[2].is_dir && entries[2].name == "afile.txt");
        assert!(!entries[3].is_dir && entries[3].name == "zfile.txt");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_dir_blocking_detects_hidden() {
        let dir = tmpdir();
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(".hidden"), "a").unwrap();
        fs::write(dir.join("visible"), "b").unwrap();

        let entries = read_dir_blocking(dir.to_str().unwrap().to_string()).unwrap();
        assert_eq!(entries.len(), 2);
        let hidden = entries.iter().find(|e| e.name == ".hidden").unwrap();
        assert!(hidden.is_hidden);
        let visible = entries.iter().find(|e| e.name == "visible").unwrap();
        assert!(!visible.is_hidden);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_blocking_rejects_empty_query() {
        let dir = tmpdir();
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let hits = search_blocking(dir.to_str().unwrap(), "", 10).unwrap();
        assert!(hits.is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_blocking_rejects_non_dir() {
        let result = search_blocking("/nonexistent/path", "foo", 10);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "not a directory");
    }

    #[test]
    fn search_blocking_finds_matches_case_insensitive() {
        let dir = tmpdir();
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("Readme.md"), "hello").unwrap();
        fs::write(dir.join("main.rs"), "hello").unwrap();
        fs::create_dir_all(dir.join("subdir")).unwrap();
        fs::write(dir.join("subdir").join("nested.txt"), "hello").unwrap();

        let hits = search_blocking(dir.to_str().unwrap(), "readme", 200).unwrap();
        assert_eq!(hits.len(), 1);
        assert!(!hits[0].is_dir);

        let hits = search_blocking(dir.to_str().unwrap(), "nested", 200).unwrap();
        assert_eq!(hits.len(), 1);
        assert!(!hits[0].is_dir);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_blocking_skips_known_dirs() {
        let dir = tmpdir();
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("node_modules")).unwrap();
        fs::write(dir.join("node_modules").join("match.txt"), "x").unwrap();
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::write(dir.join(".git").join("match.txt"), "x").unwrap();
        fs::write(dir.join("root_match.txt"), "x").unwrap();

        let hits = search_blocking(dir.to_str().unwrap(), "match", 200).unwrap();
        assert_eq!(hits.len(), 1, "should skip node_modules and .git");
        assert!(hits[0].path.ends_with("root_match.txt"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_blocking_case_insensitive_dir_skip() {
        let dir = tmpdir();
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("NODE_MODULES")).unwrap();
        fs::write(dir.join("NODE_MODULES").join("hidden.txt"), "x").unwrap();
        fs::write(dir.join("visible.txt"), "x").unwrap();

        let hits = search_blocking(dir.to_str().unwrap(), "visible", 200).unwrap();
        assert_eq!(hits.len(), 1);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_blocking_respects_limit() {
        let dir = tmpdir();
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        for i in 0..5 {
            fs::write(dir.join(format!("match_{i}.txt")), "x").unwrap();
        }

        let hits = search_blocking(dir.to_str().unwrap(), "match", 2).unwrap();
        assert_eq!(hits.len(), 2, "should stop at the limit");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_blocking_limit_clamped() {
        let dir = tmpdir();
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("match1.txt"), "x").unwrap();
        fs::write(dir.join("match2.txt"), "x").unwrap();

        // limit 0 is clamped to 1.
        let hits = search_blocking(dir.to_str().unwrap(), "match", 0).unwrap();
        assert_eq!(hits.len(), 1);

        // limit > 2000 is clamped to 2000.
        let hits = search_blocking(dir.to_str().unwrap(), "match", 99999).unwrap();
        assert_eq!(hits.len(), 2);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_blocking_sorts_dirs_first() {
        let dir = tmpdir();
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::create_dir_all(dir.join("b_dir")).unwrap();
        fs::write(dir.join("a_file.txt"), "x").unwrap();
        fs::create_dir_all(dir.join("a_dir")).unwrap();

        let hits = search_blocking(dir.to_str().unwrap(), "a", 200).unwrap();
        // "a" matches a_dir and a_file.txt (b_dir has no "a").
        assert_eq!(hits.len(), 2);
        assert!(hits[0].is_dir);
        assert_eq!(hits[0].path, a_to_string(&dir.join("a_dir")));
        assert!(!hits[1].is_dir);
        assert_eq!(hits[1].path, a_to_string(&dir.join("a_file.txt")));

        let _ = fs::remove_dir_all(&dir);
    }

    fn a_to_string(p: &std::path::Path) -> String {
        p.to_str().unwrap().to_string()
    }
}
