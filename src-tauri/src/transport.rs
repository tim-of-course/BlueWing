use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::Duration,
};
use tauri::Emitter;
pub const TIMEOUT: Duration = Duration::from_secs(60);
pub fn data_dir() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("BLUEWING_DATA_DIR") {
        return Ok(path.into());
    }
    directories::ProjectDirs::from("com", "bluewing", "Bluewing")
        .map(|d| d.data_dir().into())
        .ok_or("Cannot locate application data directory".into())
}
#[derive(Serialize, Deserialize)]
struct Endpoint {
    port: u16,
    token: String,
}
#[derive(Serialize, Deserialize)]
pub struct Request {
    token: String,
    args: Vec<String>,
    input: Option<String>,
}
#[derive(Clone, Serialize)]
struct Event {
    id: String,
    args: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    input: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    pub response: Value,
    pub exit_code: i32,
}
pub struct Bridge {
    pub ready: AtomicBool,
    pending: Mutex<HashMap<String, mpsc::Sender<Reply>>>,
    _lock: File,
}
impl Bridge {
    pub fn start(app: tauri::AppHandle) -> Result<Arc<Self>, String> {
        let dir = data_dir()?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(dir.join("desktop.lock"))
            .map_err(|e| e.to_string())?;
        lock.try_lock()
            .map_err(|_| "Bluewing desktop is already running".to_string())?;
        let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
        let endpoint = Endpoint {
            port: listener.local_addr().unwrap().port(),
            token: uuid::Uuid::new_v4().to_string(),
        };
        // NamedTempFile is created with user-only permissions on Unix.
        crate::storage::atomic_write(
            &dir.join("cli-session.json"),
            &serde_json::to_vec(&endpoint).unwrap(),
        )?;
        let bridge = Arc::new(Self {
            ready: AtomicBool::new(false),
            pending: Mutex::new(HashMap::new()),
            _lock: lock,
        });
        let b = bridge.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let b = b.clone();
                let token = endpoint.token.clone();
                let app = app.clone();
                std::thread::spawn(move || {
                    let _ = b.handle(stream, &token, &app);
                });
            }
        });
        Ok(bridge)
    }
    fn handle(
        &self,
        mut stream: TcpStream,
        token: &str,
        app: &tauri::AppHandle,
    ) -> Result<(), String> {
        stream
            .set_read_timeout(Some(TIMEOUT))
            .map_err(|e| e.to_string())?;
        stream
            .set_write_timeout(Some(TIMEOUT))
            .map_err(|e| e.to_string())?;
        let mut line = String::new();
        BufReader::new(&stream)
            .take(16 * 1024 * 1024)
            .read_line(&mut line)
            .map_err(|e| e.to_string())?;
        let result = (|| {
            let request: Request = serde_json::from_str(&line).map_err(|e| e.to_string())?;
            if request.token != token {
                return Err("Invalid desktop session token".into());
            }
            if !self.ready.load(Ordering::SeqCst) {
                return Err(
                    "Bluewing is not ready. Wait for the desktop workspace to load and retry."
                        .into(),
                );
            }
            let id = uuid::Uuid::new_v4().to_string();
            let (tx, rx) = mpsc::channel();
            self.pending.lock().unwrap().insert(id.clone(), tx);
            let emitted = app.emit(
                "bluewing:cli-request",
                Event {
                    id: id.clone(),
                    args: request.args,
                    input: request.input,
                },
            );
            let reply=match emitted { Ok(())=>rx.recv_timeout(TIMEOUT).map_err(|_|"Desktop request timed out. Inspect the desktop before retrying; the command may have completed.".to_string()),Err(e)=>Err(e.to_string()) };
            self.pending.lock().unwrap().remove(&id);
            reply
        })();
        let reply = result.unwrap_or_else(|error: String| Reply {
            response: json!({"error":error}),
            exit_code: 1,
        });
        serde_json::to_writer(&mut stream, &reply).map_err(|e| e.to_string())?;
        stream.write_all(b"\n").map_err(|e| e.to_string())
    }
    pub fn respond(&self, id: &str, reply: Reply) -> Result<(), String> {
        self.pending
            .lock()
            .unwrap()
            .remove(id)
            .ok_or("CLI request expired")?
            .send(reply)
            .map_err(|_| "CLI caller disconnected".into())
    }
}
pub fn launch(args: Vec<String>, input: Option<String>) -> Result<Reply, String> {
    let unavailable =
        |e| format!("Bluewing desktop is unavailable. Open Bluewing and retry. ({e})");
    let endpoint: Endpoint = serde_json::from_slice(
        &fs::read(data_dir()?.join("cli-session.json")).map_err(|e| unavailable(e.to_string()))?,
    )
    .map_err(|e| unavailable(e.to_string()))?;
    let mut stream = TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], endpoint.port)),
        Duration::from_secs(3),
    )
    .map_err(|e| unavailable(e.to_string()))?;
    stream
        .set_read_timeout(Some(TIMEOUT + Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(TIMEOUT))
        .map_err(|e| e.to_string())?;
    serde_json::to_writer(
        &mut stream,
        &Request {
            token: endpoint.token,
            args,
            input,
        },
    )
    .map_err(|e| e.to_string())?;
    stream.write_all(b"\n").map_err(|e| e.to_string())?;
    let mut line = String::new();
    BufReader::new(stream)
        .read_line(&mut line)
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&line).map_err(|e| e.to_string())
}
