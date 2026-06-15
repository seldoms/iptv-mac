use std::path::{Component, Path, PathBuf};

/// 安全地解析路径，防止目录遍历和符号链接穿越
/// 在指定根目录内解析安全路径。
/// 注意：不需要目标路径已存在
pub fn resolve_safe_path(root_path: &str, input: &str, allow_root: bool) -> Option<PathBuf> {
    if input.contains('\0') {
        return None;
    }

    let root = Path::new(root_path);
    if !root.exists() {
        return None;
    }

    // Use root's canonical path as the base
    let root_canonical = root.canonicalize().ok()?;
    let candidate = root_canonical.join(input);

    // Resolve the candidate (don't require existence)
    let candidate_components: Vec<Component> = candidate.components().collect();
    let mut resolved = PathBuf::new();
    for comp in &candidate_components {
        match comp {
            Component::ParentDir => { resolved.pop(); }
            Component::Normal(_) => { resolved.push(comp); }
            Component::RootDir => { resolved.push(comp); }
            _ => {}
        }
    }

    let rel = resolved.strip_prefix(&root_canonical).ok()?;
    let rel_str = rel.to_string_lossy();

    // Reject traversal (rel should start with a normal component)
    if rel_str.is_empty() && !allow_root {
        return None;
    }
    if rel_str == ".." || rel_str.starts_with("../") || rel_str.starts_with("..\\") {
        return None;
    }

    // Reject symbolic link traversal
    let mut current = root_canonical.clone();
    for component in rel.components() {
        match component {
            Component::Normal(part) => {
                current.push(part);
                if current.exists() && current.is_symlink() {
                    return None;
                }
            }
            _ => return None,
        }
    }

    Some(resolved)
}

/// 判断路径段是否安全
/// 判断单个路径段是否安全。
pub fn is_safe_path_segment(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && !value.contains('/')
        && !value.contains('\\')
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn test_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "iptv-path-test-{}-{}",
            name,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn allows_descendants() {
        let root = test_root("descendants");
        fs::create_dir_all(root.join("movies")).unwrap();

        let result = resolve_safe_path(root.to_str().unwrap(), "movies/demo.mp4", true);
        assert!(result.is_some(), "should allow subpath");
        let path = result.unwrap();
        assert!(path.to_string_lossy().ends_with("movies/demo.mp4"), "path should end with movies/demo.mp4, got: {:?}", path);
    }

    #[test]
    fn rejects_traversal() {
        let root = test_root("traversal");
        let result = resolve_safe_path(root.to_str().unwrap(), "../etc/passwd", true);
        assert!(result.is_none());
    }

    #[test]
    fn rejects_empty_when_not_allowed() {
        let root = test_root("empty");
        let result = resolve_safe_path(root.to_str().unwrap(), "", false);
        assert!(result.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symbolic_link() {
        let root = test_root("symlink-root");
        let outside = std::env::temp_dir().join(format!("iptv-outside-{}", std::process::id()));
        let _ = fs::remove_dir_all(&outside);
        fs::create_dir_all(&outside).unwrap();
        fs::create_dir_all(root.join("media")).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("media").join("linked")).unwrap();
        let result = resolve_safe_path(root.to_str().unwrap(), "media/linked/private.txt", true);
        assert!(result.is_none());
    }

    #[test]
    fn safe_path_segment() {
        assert!(is_safe_path_segment("Movies"));
        assert!(!is_safe_path_segment(".."));
        assert!(!is_safe_path_segment("folder/name"));
        assert!(!is_safe_path_segment("folder\\name"));
    }
}
