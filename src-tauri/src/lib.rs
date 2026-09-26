mod cache;
mod storage;
pub mod transport;
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::{
    borrow::Cow,
    path::Path,
    sync::{Arc, Mutex, atomic::Ordering},
};
use tauri::{Manager, State};
struct Native {
    database: Option<storage::Database>,
    snapshots: storage::Snapshots,
    cache: cache::Cache,
}
type Shared = Mutex<Native>;
#[tauri::command]
fn database_open(state: State<Shared>, path: String, create: bool) -> Result<(), String> {
    let mut s = state.lock().unwrap();
    if s.database.is_some() {
        return Err("Close the current project first".into());
    }
    s.database = Some(storage::Database::open(Path::new(&path), create)?);
    Ok(())
}
#[tauri::command]
fn database_close(state: State<Shared>) {
    let mut s = state.lock().unwrap();
    s.database = None;
    s.snapshots.clear();
}
#[tauri::command]
fn database_backup(state: State<Shared>, path: Option<String>) -> Result<String, String> {
    state
        .lock()
        .unwrap()
        .database
        .as_ref()
        .ok_or("No open database")?
        .backup(path.as_deref().map(Path::new))
}
#[tauri::command]
fn database_query(
    state: State<Shared>,
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<serde_json::Map<String, Value>>, String> {
    state
        .lock()
        .unwrap()
        .database
        .as_ref()
        .ok_or("No open database")?
        .query(&sql, params)
}
#[tauri::command]
fn database_transaction(
    state: State<Shared>,
    statements: Vec<storage::Statement>,
) -> Result<(), String> {
    let mut s = state.lock().unwrap();
    let Native {
        database,
        snapshots,
        ..
    } = &mut *s;
    database
        .as_mut()
        .ok_or("No open database")?
        .transaction_with_snapshots(statements, snapshots)
}
#[tauri::command(rename_all = "camelCase")]
fn database_read_blob(
    state: State<Shared>,
    table: String,
    column: String,
    row_id: i64,
    offset: u64,
    length: u64,
) -> Result<tauri::ipc::Response, String> {
    state
        .lock()
        .unwrap()
        .database
        .as_ref()
        .ok_or("No open database")?
        .read_blob(&table, &column, row_id, offset, length)
        .map(tauri::ipc::Response::new)
}
#[tauri::command]
fn file_snapshot_open(state: State<Shared>, path: String) -> Result<storage::SnapshotInfo, String> {
    storage::snapshot_open(&mut state.lock().unwrap().snapshots, Path::new(&path))
}
#[tauri::command]
fn file_snapshot_read(
    state: State<Shared>,
    token: String,
    offset: u64,
    length: u64,
) -> Result<tauri::ipc::Response, String> {
    storage::snapshot_read(&state.lock().unwrap().snapshots, &token, offset, length)
        .map(tauri::ipc::Response::new)
}
#[tauri::command]
fn file_snapshot_release(state: State<Shared>, token: String) {
    state.lock().unwrap().snapshots.remove(&token);
}
#[tauri::command]
fn read_file(path: String) -> Result<Value, String> {
    storage::read_file(Path::new(&path))
}
#[tauri::command]
fn write_file(path: String, data: String) -> Result<(), String> {
    storage::atomic_write(
        Path::new(&path),
        &STANDARD.decode(data).map_err(|e| e.to_string())?,
    )
}
fn app_data_path(key: &str) -> Result<std::path::PathBuf, String> {
    if key.is_empty()
        || !key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
        || key.starts_with('.')
    {
        return Err("Invalid application data key".into());
    }
    Ok(transport::data_dir()?.join("data").join(key))
}
#[tauri::command]
fn app_data_read(key: String) -> Result<Option<String>, String> {
    match std::fs::read_to_string(app_data_path(&key)?) {
        Ok(data) => Ok(Some(data)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
#[tauri::command]
fn app_data_write(key: String, data: String) -> Result<(), String> {
    let path = app_data_path(&key)?;
    std::fs::create_dir_all(path.parent().ok_or("Missing application data directory")?)
        .map_err(|e| e.to_string())?;
    storage::atomic_write(&path, data.as_bytes())
}
#[tauri::command]
fn cache_stage(
    state: State<Shared>,
    version: String,
    files: Vec<cache::CacheFile>,
) -> Result<(), String> {
    state.lock().unwrap().cache.stage(&version, files)
}
#[tauri::command]
fn cache_info(state: State<Shared>) -> cache::CacheInfo {
    state.lock().unwrap().cache.info()
}
#[tauri::command]
fn cache_activate(
    state: State<Shared>,
    bridge: State<Arc<transport::Bridge>>,
    version: String,
) -> Result<(), String> {
    let mut s = state.lock().unwrap();
    if s.database.is_some() {
        return Err("Close the project before activating a web update".into());
    }
    s.cache.activate(&version)?;
    bridge.ready.store(false, Ordering::SeqCst);
    Ok(())
}
#[tauri::command]
fn bridge_ready(state: State<Shared>, bridge: State<Arc<transport::Bridge>>) -> Value {
    bridge.ready.store(true, Ordering::SeqCst);
    let cli = std::env::current_exe()
        .unwrap_or_default()
        .with_file_name(if cfg!(windows) {
            "bluewing.exe"
        } else {
            "bluewing"
        });
    json!({"bridgeVersion":4,"webVersion":state.lock().unwrap().cache.active,"cliPath":cli})
}
#[tauri::command]
fn cli_respond(
    bridge: State<Arc<transport::Bridge>>,
    id: String,
    response: Value,
    exit_code: i32,
) -> Result<(), String> {
    bridge.respond(
        &id,
        transport::Reply {
            response,
            exit_code,
        },
    )
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            database_open,
            database_close,
            database_backup,
            database_query,
            database_transaction,
            database_read_blob,
            file_snapshot_open,
            file_snapshot_read,
            file_snapshot_release,
            app_data_read,
            app_data_write,
            read_file,
            write_file,
            cache_stage,
            cache_info,
            cache_activate,
            bridge_ready,
            cli_respond
        ])
        .setup(|app| {
            let cache = cache::Cache::new(&transport::data_dir()?)?;
            app.manage(Mutex::new(Native {
                database: None,
                snapshots: storage::Snapshots::new(),
                cache,
            }));
            app.manage(transport::Bridge::start(app.handle().clone())?);
            let handle = app.handle().clone();
            let page_handle = app.handle().clone();
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Bluewing")
            .inner_size(1400.0, 900.0)
            // Terminal commands and release downloads must finish while another app is active.
            .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
            .on_page_load(move |_, payload| {
                if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                    page_handle
                        .state::<Arc<transport::Bridge>>()
                        .ready
                        .store(false, Ordering::SeqCst);
                }
            })
            .on_web_resource_request(move |request, response| {
                let state = handle.state::<Shared>();
                let s = state.lock().unwrap();
                if let Some(resource) = s.cache.resource(request.uri().path()) {
                    let (status, data, mime) = match resource {
                        Ok((data, mime)) => (200, data, mime),
                        Err(_) => (
                            404,
                            b"Asset missing from active web bundle".to_vec(),
                            "text/plain".into(),
                        ),
                    };
                    *response = tauri::http::Response::builder()
                        .status(status)
                        .header("content-type", mime)
                        .header("cache-control", "no-store")
                        .body(Cow::Owned(data))
                        .unwrap();
                }
            })
            .build()?;
            app.set_menu(tauri::menu::Menu::default(app.handle())?)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Unable to start Bluewing desktop");
}
