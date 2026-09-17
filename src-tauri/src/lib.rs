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
    state.lock().unwrap().database = None;
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
    state
        .lock()
        .unwrap()
        .database
        .as_mut()
        .ok_or("No open database")?
        .transaction(statements)
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
    json!({"bridgeVersion":1,"webVersion":state.lock().unwrap().cache.active,"cliPath":cli})
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
            database_query,
            database_transaction,
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
