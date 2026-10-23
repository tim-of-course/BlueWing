use std::{
    collections::HashMap,
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::ipc::{InvokeBody, Request};

pub type Writes = Mutex<HashMap<String, tempfile::NamedTempFile>>;

fn cache_root() -> PathBuf {
    std::env::temp_dir().join("bluewing-page-images-v1")
}

fn cache_path(root: &Path, key: &str) -> Result<PathBuf, String> {
    if key.len() != 64
        || !key
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("Page cache key must be 64 lowercase hexadecimal characters".into());
    }
    Ok(root.join(format!("{key}.bin")))
}

fn read(root: &Path, key: &str) -> Result<Vec<u8>, String> {
    match std::fs::read(cache_path(root, key)?) {
        Ok(data) => Ok(data),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error.to_string()),
    }
}

fn write(root: &Path, key: &str, data: &[u8]) -> Result<(), String> {
    let path = cache_path(root, key)?;
    std::fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(root).map_err(|error| error.to_string())?;
    temporary
        .write_all(data)
        .map_err(|error| error.to_string())?;
    // Disposable images need atomic replacement, not forced durable disk writes.
    temporary.persist(path).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn page_cache_exists(key: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        cache_path(&cache_root(), &key)?
            .try_exists()
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn page_cache_read(key: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || read(&cache_root(), &key))
        .await
        .map_err(|error| error.to_string())?
        .map(tauri::ipc::Response::new)
}

#[tauri::command]
pub async fn page_cache_write(
    request: Request<'_>,
    pending: tauri::State<'_, Arc<Writes>>,
) -> Result<(), String> {
    let key = request
        .headers()
        .get("x-bluewing-page-cache-key")
        .ok_or("Page cache key header is missing")?
        .to_str()
        .map_err(|error| error.to_string())?
        .to_owned();
    let data = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        InvokeBody::Json(_) => return Err("Page cache write requires raw bytes".into()),
    };
    let number = |name: &str| -> Result<Option<u64>, String> {
        request
            .headers()
            .get(name)
            .map(|value| {
                value
                    .to_str()
                    .map_err(|e| e.to_string())?
                    .parse::<u64>()
                    .map_err(|e| e.to_string())
            })
            .transpose()
    };
    let offset = number("x-bluewing-page-cache-offset")?;
    let size = number("x-bluewing-page-cache-size")?;
    let pending = pending.inner().clone();
    tauri::async_runtime::spawn_blocking(move || match (offset, size) {
        (None, None) => write(&cache_root(), &key, &data),
        (Some(offset), Some(size)) => {
            let mut writes = pending.lock().map_err(|e| e.to_string())?;
            write_chunk(&cache_root(), &mut writes, &key, offset, size, &data)
        }
        _ => Err("Page cache chunk requires offset and size".into()),
    })
    .await
    .map_err(|error| error.to_string())?
}

fn write_chunk(
    root: &Path,
    pending: &mut HashMap<String, tempfile::NamedTempFile>,
    key: &str,
    offset: u64,
    size: u64,
    data: &[u8],
) -> Result<(), String> {
    let path = cache_path(root, key)?;
    let result = (|| {
        if data.len() > 256 * 1024
            || offset
                .checked_add(data.len() as u64)
                .is_none_or(|end| end > size)
        {
            return Err("Invalid page cache chunk length".to_string());
        }
        if offset == 0 {
            std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
            pending.insert(
                key.to_owned(),
                tempfile::NamedTempFile::new_in(root).map_err(|e| e.to_string())?,
            );
        }
        let file = pending
            .get_mut(key)
            .ok_or("Page cache write has not started")?;
        if file.as_file().metadata().map_err(|e| e.to_string())?.len() != offset {
            return Err("Page cache chunk offset does not match".into());
        }
        file.write_all(data).map_err(|e| e.to_string())?;
        if offset + data.len() as u64 == size {
            pending
                .remove(key)
                .unwrap()
                .persist(path)
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    })();
    if result.is_err() {
        pending.remove(key);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn bytes_roundtrip_and_replace() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("cache");
        let bytes = [0, 255, 128, 13, 10];
        write(&root, KEY, &bytes).unwrap();
        assert_eq!(read(&root, KEY).unwrap(), bytes);
        write(&root, KEY, b"replacement").unwrap();
        assert_eq!(read(&root, KEY).unwrap(), b"replacement");
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
    }

    #[test]
    fn chunks_publish_only_the_complete_image() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let mut pending = HashMap::new();
        write(root, KEY, b"old").unwrap();
        write_chunk(root, &mut pending, KEY, 0, 6, b"abc").unwrap();
        assert_eq!(read(root, KEY).unwrap(), b"old");
        write_chunk(root, &mut pending, KEY, 3, 6, b"def").unwrap();
        assert_eq!(read(root, KEY).unwrap(), b"abcdef");
        assert!(pending.is_empty());
        assert_eq!(std::fs::read_dir(root).unwrap().count(), 1);
    }

    #[test]
    fn bad_chunk_discards_partial_image_and_keeps_previous_cache() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let mut pending = HashMap::new();
        write(root, KEY, b"old").unwrap();
        write_chunk(root, &mut pending, KEY, 0, 6, b"abc").unwrap();
        assert!(write_chunk(root, &mut pending, KEY, 4, 6, b"ef").is_err());
        assert!(pending.is_empty());
        assert_eq!(read(root, KEY).unwrap(), b"old");
        assert_eq!(std::fs::read_dir(root).unwrap().count(), 1);
    }

    #[test]
    fn missing_file_or_directory_returns_empty_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("cache");
        assert!(read(&root, KEY).unwrap().is_empty());
        assert!(!root.exists());
        std::fs::create_dir(&root).unwrap();
        assert!(read(&root, KEY).unwrap().is_empty());
    }

    #[test]
    fn write_recreates_a_removed_cache_directory() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("cache");
        write(&root, KEY, b"old").unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        assert!(read(&root, KEY).unwrap().is_empty());
        write(&root, KEY, b"new").unwrap();
        assert_eq!(read(&root, KEY).unwrap(), b"new");
    }

    #[test]
    fn invalid_keys_are_rejected_before_disk_access() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("cache");
        for key in [
            String::new(),
            "a".repeat(63),
            "a".repeat(65),
            "A".repeat(64),
            "g".repeat(64),
            format!("../{}", "a".repeat(61)),
            format!("{}\\a", "a".repeat(62)),
            "é".repeat(32),
        ] {
            assert!(read(&root, &key).is_err(), "Accepted key: {key}");
            assert!(write(&root, &key, &[0]).is_err(), "Accepted key: {key}");
        }
        assert!(!root.exists());
    }
}
