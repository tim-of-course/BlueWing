use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
};
pub const BUNDLED: &str = "0.1.0";
#[derive(Deserialize)]
pub struct CacheFile {
    pub path: String,
    pub data: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheInfo {
    pub bridge_version: u32,
    pub active_version: String,
    pub cached_versions: Vec<String>,
}
pub struct Cache {
    root: PathBuf,
    pub active: String,
}
fn version_path(version: &str) -> Result<(), String> {
    if version.is_empty()
        || version == "."
        || version == ".."
        || !version
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-_".contains(&b))
    {
        return Err("Invalid web version".into());
    }
    Ok(())
}
fn safe_path(path: &str) -> Result<PathBuf, String> {
    let p = Path::new(path);
    if path.is_empty()
        || path.contains('\\')
        || path.contains(':')
        || !p.components().all(|c| matches!(c, Component::Normal(_)))
    {
        return Err(format!("Invalid bundle path: {path}"));
    }
    Ok(p.into())
}
impl Cache {
    pub fn new(data: &Path) -> Result<Self, String> {
        let root = data.join("web");
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let active = fs::read_to_string(root.join("active"))
            .ok()
            .filter(|v| version_path(v).is_ok() && root.join(v).join("index.html").is_file())
            .unwrap_or(BUNDLED.into());
        Ok(Self { root, active })
    }
    pub fn stage(&self, version: &str, files: Vec<CacheFile>) -> Result<(), String> {
        version_path(version)?;
        if version == BUNDLED || self.root.join(version).exists() {
            return Err("Web version already exists; use a new version".into());
        }
        let temp = tempfile::Builder::new()
            .prefix(".stage-")
            .tempdir_in(&self.root)
            .map_err(|e| e.to_string())?;
        let mut seen = HashSet::new();
        for file in files {
            let path = safe_path(&file.path)?;
            if !seen.insert(path.clone()) {
                return Err("Duplicate bundle path".into());
            }
            let target = temp.path().join(path);
            fs::create_dir_all(target.parent().unwrap()).map_err(|e| e.to_string())?;
            crate::storage::atomic_write(
                &target,
                &STANDARD.decode(file.data).map_err(|e| e.to_string())?,
            )?;
        }
        if !temp.path().join("index.html").is_file() {
            return Err("Bundle must contain index.html".into());
        }
        fs::rename(temp.path(), self.root.join(version)).map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn activate(&mut self, version: &str) -> Result<(), String> {
        version_path(version)?;
        if version != BUNDLED && !self.root.join(version).join("index.html").is_file() {
            return Err("Stage the complete web bundle before activation".into());
        }
        crate::storage::atomic_write(&self.root.join("active"), version.as_bytes())?;
        self.active = version.into();
        Ok(())
    }
    pub fn info(&self) -> CacheInfo {
        let mut versions: Vec<String> = fs::read_dir(&self.root)
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| e.path().join("index.html").is_file())
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|v| !v.starts_with(".stage-"))
            .collect();
        versions.sort();
        CacheInfo {
            bridge_version: 1,
            active_version: self.active.clone(),
            cached_versions: versions,
        }
    }
    pub fn resource(&self, url_path: &str) -> Option<Result<(Vec<u8>, String), String>> {
        if self.active == BUNDLED {
            return None;
        }
        Some((|| {
            let decoded = percent_encoding::percent_decode_str(url_path)
                .decode_utf8()
                .map_err(|e| e.to_string())?;
            let path = if decoded == "/" {
                "index.html"
            } else {
                decoded.trim_start_matches('/')
            };
            let path = safe_path(path)?;
            let mime = mime_guess::from_path(&path)
                .first_or_octet_stream()
                .to_string();
            let data =
                fs::read(self.root.join(&self.active).join(path)).map_err(|e| e.to_string())?;
            Ok((data, mime))
        })())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bundle_is_atomic_and_has_no_mixed_fallback() {
        let d = tempfile::tempdir().unwrap();
        let mut c = Cache::new(d.path()).unwrap();
        assert!(
            c.stage(
                "v2",
                vec![CacheFile {
                    path: "../escape".into(),
                    data: "".into()
                }]
            )
            .is_err()
        );
        assert!(c.activate("v2").is_err());
        c.stage(
            "v2",
            vec![CacheFile {
                path: "index.html".into(),
                data: STANDARD.encode("new"),
            }],
        )
        .unwrap();
        c.activate("v2").unwrap();
        assert!(c.resource("/missing.js").unwrap().is_err());
        assert_eq!(Cache::new(d.path()).unwrap().active, "v2");
        assert_eq!(c.resource("/").unwrap().unwrap().0, b"new");
        assert!(c.resource("/%2e%2e/active").unwrap().is_err());
    }
}
