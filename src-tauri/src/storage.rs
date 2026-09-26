use base64::{Engine, engine::general_purpose::STANDARD};
use rusqlite::{
    Connection, OpenFlags,
    hooks::{AuthAction, AuthContext, Authorization},
    params_from_iter,
    types::{Value as SqlValue, ValueRef},
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::{
    collections::HashMap,
    fs::File,
    fs::OpenOptions,
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
};

pub const MAX_CHUNK_LENGTH: u64 = 1024 * 1024;
const COPY_BUFFER_LENGTH: usize = 64 * 1024;
pub type Snapshots = HashMap<String, FileSnapshot>;

pub struct FileSnapshot {
    file: File,
    length: u64,
}

#[derive(Serialize)]
pub struct SnapshotInfo {
    pub token: String,
    pub name: String,
    pub length: u64,
}

pub fn snapshot_open(snapshots: &mut Snapshots, path: &Path) -> Result<SnapshotInfo, String> {
    let name = path
        .file_name()
        .ok_or("File has no name")?
        .to_string_lossy()
        .into_owned();
    let mut source = File::open(path).map_err(|e| e.to_string())?;
    let mut file = tempfile::tempfile().map_err(|e| e.to_string())?;
    let mut buffer = [0; COPY_BUFFER_LENGTH];
    let mut length = 0;
    loop {
        let count = source.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        file.write_all(&buffer[..count])
            .map_err(|e| e.to_string())?;
        length += count as u64;
    }
    let token = uuid::Uuid::new_v4().to_string();
    snapshots.insert(token.clone(), FileSnapshot { file, length });
    Ok(SnapshotInfo {
        token,
        name,
        length,
    })
}

fn chunk_length(total: u64, offset: u64, length: u64) -> Result<usize, String> {
    if length > MAX_CHUNK_LENGTH {
        return Err("Read length exceeds 1 MiB".into());
    }
    if offset.checked_add(length).is_none_or(|end| end > total) {
        return Err("Read range is outside the data".into());
    }
    Ok(length as usize)
}

pub fn snapshot_read(
    snapshots: &Snapshots,
    token: &str,
    offset: u64,
    length: u64,
) -> Result<Vec<u8>, String> {
    let snapshot = snapshots.get(token).ok_or("Unknown file snapshot token")?;
    let length = chunk_length(snapshot.length, offset, length)?;
    let mut file = &snapshot.file;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| e.to_string())?;
    let mut data = vec![0; length];
    file.read_exact(&mut data).map_err(|e| e.to_string())?;
    Ok(data)
}

pub struct Database {
    // Drop SQLite before releasing the application's exclusive writer lock.
    connection: Connection,
    _lock: File,
}

#[derive(Deserialize)]
pub struct Statement {
    pub sql: String,
    pub params: Vec<Value>,
    #[serde(default)]
    pub blob: Option<BlobSource>,
}

#[derive(Deserialize)]
pub struct BlobSource {
    pub token: String,
    pub table: String,
    pub column: String,
}

impl Database {
    /// Called under the application's database mutex, between committed transactions.
    /// The DELETE journal and exclusive writer lock make a streaming file copy consistent.
    pub fn backup(&self, destination: Option<&Path>) -> Result<String, String> {
        let source = Path::new(self.connection.path().ok_or("Database has no file path")?);
        let generated = source.with_file_name(format!(
            "{}.backup-{}.bluewing",
            source.file_stem().unwrap_or_default().to_string_lossy(),
            uuid::Uuid::new_v4()
        ));
        let destination = destination.unwrap_or(&generated);
        let parent = destination
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        let mut input = File::open(source).map_err(|e| e.to_string())?;
        std::io::copy(&mut input, temporary.as_file_mut()).map_err(|e| e.to_string())?;
        temporary.as_file().sync_all().map_err(|e| e.to_string())?;
        temporary
            .persist_noclobber(destination)
            .map_err(|e| e.to_string())?;
        #[cfg(unix)]
        File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|e| e.to_string())?;
        Ok(destination.to_string_lossy().into_owned())
    }

    pub fn open(path: &Path, create: bool) -> Result<Self, String> {
        let project_file = OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(create)
            .open(path)
            .map_err(|error| error.to_string())?;
        let lock = {
            // Lock a sibling so filesystem locks cannot block SQLite's own handle.
            // Keep the sidecar permanently: deleting it can split concurrent locks
            // between different file identities.
            let mut lock_path = path
                .canonicalize()
                .map_err(|error| error.to_string())?
                .into_os_string();
            lock_path.push(".lock");
            let lock = OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(lock_path)
                .map_err(|error| error.to_string())?;
            drop(project_file);
            lock
        };
        lock.try_lock()
            .map_err(|error| format!("Cannot exclusively open project: {error}"))?;
        let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)
            .map_err(|error| error.to_string())?;
        connection
            .execute_batch(
                "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
            )
            .map_err(|error| error.to_string())?;
        Ok(Self {
            connection,
            _lock: lock,
        })
    }

    pub fn query(&self, sql: &str, params: Vec<Value>) -> Result<Vec<Map<String, Value>>, String> {
        self.connection.authorizer(Some(read_authorizer));
        let result = (|| {
            let params = sql_params(params)?;
            let mut statement = self
                .connection
                .prepare(sql)
                .map_err(|error| error.to_string())?;
            if !statement.readonly() {
                return Err("Queries must be read-only; use a transaction for writes".into());
            }
            let names: Vec<String> = statement
                .column_names()
                .iter()
                .map(|name| (*name).into())
                .collect();
            let mut rows = statement
                .query(params_from_iter(params))
                .map_err(|error| error.to_string())?;
            let mut results = Vec::new();
            while let Some(row) = rows.next().map_err(|error| error.to_string())? {
                let mut values = Map::new();
                for (index, name) in names.iter().enumerate() {
                    let value = match row.get_ref(index).map_err(|error| error.to_string())? {
                        ValueRef::Null => Value::Null,
                        ValueRef::Integer(value) => json!(value),
                        ValueRef::Real(value) => json!(value),
                        ValueRef::Text(value) => Value::String(
                            String::from_utf8(value.to_vec()).map_err(|error| error.to_string())?,
                        ),
                        ValueRef::Blob(value) => json!({ "blob": STANDARD.encode(value) }),
                    };
                    values.insert(name.clone(), value);
                }
                results.push(values);
            }
            Ok(results)
        })();
        self.connection
            .authorizer(None::<fn(AuthContext<'_>) -> Authorization>);
        result
    }

    #[cfg(test)]
    pub fn transaction(&mut self, statements: Vec<Statement>) -> Result<(), String> {
        self.transaction_with_snapshots(statements, &Snapshots::new())
    }

    pub fn read_blob(
        &self,
        table: &str,
        column: &str,
        row_id: i64,
        offset: u64,
        length: u64,
    ) -> Result<Vec<u8>, String> {
        let mut blob = self
            .connection
            .blob_open("main", table, column, row_id, true)
            .map_err(|e| e.to_string())?;
        let length = chunk_length(blob.len() as u64, offset, length)?;
        blob.seek(SeekFrom::Start(offset))
            .map_err(|e| e.to_string())?;
        let mut data = vec![0; length];
        blob.read_exact(&mut data).map_err(|e| e.to_string())?;
        Ok(data)
    }

    pub fn transaction_with_snapshots(
        &mut self,
        statements: Vec<Statement>,
        snapshots: &Snapshots,
    ) -> Result<(), String> {
        let transaction = self
            .connection
            .transaction()
            .map_err(|error| error.to_string())?;
        transaction.authorizer(Some(write_authorizer));
        let result: Result<(), String> = (|| {
            for statement in statements {
                let params = sql_params(statement.params)?;
                transaction
                    .execute(&statement.sql, params_from_iter(params))
                    .map_err(|error| error.to_string())?;
                if let Some(source) = statement.blob {
                    let snapshot = snapshots
                        .get(&source.token)
                        .ok_or("Unknown file snapshot token")?;
                    let mut blob = transaction
                        .blob_open(
                            "main",
                            source.table.as_str(),
                            source.column.as_str(),
                            transaction.last_insert_rowid(),
                            false,
                        )
                        .map_err(|e| e.to_string())?;
                    if blob.len() as u64 != snapshot.length {
                        return Err("BLOB size does not match file snapshot length".into());
                    }
                    let mut file = &snapshot.file;
                    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
                    let mut remaining = snapshot.length;
                    let mut buffer = [0; COPY_BUFFER_LENGTH];
                    while remaining > 0 {
                        let count = remaining.min(buffer.len() as u64) as usize;
                        file.read_exact(&mut buffer[..count])
                            .map_err(|e| e.to_string())?;
                        blob.write_all(&buffer[..count])
                            .map_err(|e| e.to_string())?;
                        remaining -= count as u64;
                    }
                    blob.close().map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        })();
        transaction.authorizer(None::<fn(AuthContext<'_>) -> Authorization>);
        result?;
        transaction.commit().map_err(|error| error.to_string())
    }
}

fn read_authorizer(context: AuthContext<'_>) -> Authorization {
    match context.action {
        AuthAction::Read { .. }
        | AuthAction::Select
        | AuthAction::Function { .. }
        | AuthAction::Recursive => Authorization::Allow,
        AuthAction::Pragma {
            pragma_name,
            pragma_value: None,
        } if pragma_name.eq_ignore_ascii_case("user_version") => Authorization::Allow,
        // These PRAGMAs take a table/index name as their argument, not a setting.
        AuthAction::Pragma { pragma_name, .. }
            if [
                "table_info",
                "table_xinfo",
                "index_info",
                "index_list",
                "foreign_key_list",
            ]
            .iter()
            .any(|name| pragma_name.eq_ignore_ascii_case(name)) =>
        {
            Authorization::Allow
        }
        _ => Authorization::Deny,
    }
}

fn write_authorizer(context: AuthContext<'_>) -> Authorization {
    match context.action {
        AuthAction::Transaction { .. }
        | AuthAction::Savepoint { .. }
        | AuthAction::Attach { .. }
        | AuthAction::Detach { .. } => Authorization::Deny,
        // Schema version changes belong in the same transaction as migrations.
        AuthAction::Pragma { pragma_name, .. }
            if pragma_name.eq_ignore_ascii_case("user_version") =>
        {
            Authorization::Allow
        }
        AuthAction::Pragma { .. } => Authorization::Deny,
        _ => Authorization::Allow,
    }
}

fn sql_params(params: Vec<Value>) -> Result<Vec<SqlValue>, String> {
    params
        .into_iter()
        .map(|value| match value {
            Value::Null => Ok(SqlValue::Null),
            Value::Bool(value) => Ok(SqlValue::Integer(i64::from(value))),
            Value::Number(value) => {
                if let Some(value) = value.as_i64() {
                    Ok(SqlValue::Integer(value))
                } else if value.is_f64() {
                    Ok(SqlValue::Real(value.as_f64().ok_or("Invalid SQL number")?))
                } else {
                    Err("SQL integer is outside the signed 64-bit range".into())
                }
            }
            Value::String(value) => Ok(SqlValue::Text(value)),
            Value::Object(value) if value.len() == 1 && value.contains_key("blob") => {
                let encoded = value["blob"]
                    .as_str()
                    .ok_or("SQL blob must be a base64 string")?;
                STANDARD
                    .decode(encoded)
                    .map(SqlValue::Blob)
                    .map_err(|error| error.to_string())
            }
            _ => Err("SQL parameters must be primitives or {blob: base64}".into()),
        })
        .collect()
}

pub fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    temporary
        .write_all(data)
        .map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary.persist(path).map_err(|error| error.to_string())?;
    // Persist the directory entry as well as the file contents on Unix.
    #[cfg(unix)]
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn read_file(path: &Path) -> Result<Value, String> {
    let data = std::fs::read(path).map_err(|error| error.to_string())?;
    let name = path
        .file_name()
        .ok_or("File has no name")?
        .to_string_lossy();
    Ok(json!({ "name": name, "data": STANDARD.encode(data) }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_is_independent_and_reads_are_bounded() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("source.bin");
        let original = vec![42; MAX_CHUNK_LENGTH as usize + 5];
        std::fs::write(&path, &original).unwrap();
        let mut snapshots = Snapshots::new();
        let info = snapshot_open(&mut snapshots, &path).unwrap();
        assert_eq!(info.name, "source.bin");
        assert_eq!(info.length, original.len() as u64);
        std::fs::write(&path, b"changed").unwrap();
        std::fs::remove_file(&path).unwrap();
        assert_eq!(
            snapshot_read(&snapshots, &info.token, 0, MAX_CHUNK_LENGTH).unwrap(),
            original[..MAX_CHUNK_LENGTH as usize]
        );
        assert_eq!(
            snapshot_read(&snapshots, &info.token, MAX_CHUNK_LENGTH, 5).unwrap(),
            [42; 5]
        );
        assert!(snapshot_read(&snapshots, &info.token, 0, MAX_CHUNK_LENGTH + 1).is_err());
        assert!(snapshot_read(&snapshots, &info.token, info.length, 1).is_err());
        assert!(snapshot_read(&snapshots, &info.token, u64::MAX, 1).is_err());
        assert!(
            snapshot_read(&snapshots, &info.token, info.length, 0)
                .unwrap()
                .is_empty()
        );
        snapshots.remove(&info.token);
        assert!(snapshot_read(&snapshots, &info.token, 0, 1).is_err());
    }

    #[test]
    fn snapshot_blob_transactions_roundtrip_and_rollback() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("source.bin");
        let bytes: Vec<u8> = (0..COPY_BUFFER_LENGTH * 2 + 7)
            .map(|i| (i % 251) as u8)
            .collect();
        std::fs::write(&path, &bytes).unwrap();
        let mut snapshots = Snapshots::new();
        let info = snapshot_open(&mut snapshots, &path).unwrap();
        let mut database = Database::open(&directory.path().join("project.db"), true).unwrap();
        database
            .transaction(vec![statement(
                "CREATE TABLE items (id INTEGER PRIMARY KEY, data BLOB)",
                vec![],
            )])
            .unwrap();
        let insert = |token: &str, length: u64| Statement {
            sql: "INSERT INTO items(data) VALUES (zeroblob(?))".into(),
            params: vec![json!(length)],
            blob: Some(BlobSource {
                token: token.into(),
                table: "items".into(),
                column: "data".into(),
            }),
        };
        database
            .transaction_with_snapshots(vec![insert(&info.token, info.length)], &snapshots)
            .unwrap();
        assert_eq!(
            database
                .read_blob("items", "data", 1, 0, info.length)
                .unwrap(),
            bytes
        );
        assert_eq!(
            database.read_blob("items", "data", 1, 65530, 20).unwrap(),
            bytes[65530..65550]
        );
        assert!(
            database
                .read_blob("items", "data", 1, info.length, 1)
                .is_err()
        );
        assert!(
            database
                .read_blob("items", "data", 1, 0, MAX_CHUNK_LENGTH + 1)
                .is_err()
        );
        assert!(database.read_blob("items", "data", 999, 0, 1).is_err());
        for failure in [
            insert("missing", info.length),
            insert(&info.token, info.length - 1),
            statement("invalid SQL", vec![]),
        ] {
            assert!(
                database
                    .transaction_with_snapshots(
                        vec![insert(&info.token, info.length), failure],
                        &snapshots
                    )
                    .is_err()
            );
            assert_eq!(
                database
                    .query("SELECT count(*) AS count FROM items", vec![])
                    .unwrap()[0]["count"],
                1
            );
        }
        assert_eq!(
            snapshot_read(&snapshots, &info.token, 1, 3).unwrap(),
            bytes[1..4]
        );
        database
            .transaction_with_snapshots(vec![insert(&info.token, info.length)], &snapshots)
            .unwrap();
        assert_eq!(
            database
                .read_blob("items", "data", 2, 0, info.length)
                .unwrap(),
            bytes
        );
    }

    fn statement(sql: &str, params: Vec<Value>) -> Statement {
        Statement {
            sql: sql.into(),
            params,
            blob: None,
        }
    }

    #[test]
    fn backup_is_independent_and_never_overwrites_a_file() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source.bluewing");
        let destination = directory.path().join("before-upgrade.bluewing");
        let mut database = Database::open(&source, true).unwrap();
        database
            .transaction(vec![
                statement("CREATE TABLE items (value TEXT)", vec![]),
                statement("INSERT INTO items VALUES ('before')", vec![]),
            ])
            .unwrap();
        database.backup(Some(&destination)).unwrap();
        database
            .transaction(vec![statement("UPDATE items SET value='after'", vec![])])
            .unwrap();
        let backup = Database::open(&destination, false).unwrap();
        assert_eq!(
            backup.query("SELECT value FROM items", vec![]).unwrap()[0]["value"],
            "before"
        );
        assert_eq!(
            database.query("SELECT value FROM items", vec![]).unwrap()[0]["value"],
            "after"
        );
        assert!(database.backup(Some(&destination)).is_err());
        assert!(database.backup(Some(&source)).is_err());
        assert!(Path::new(&database.backup(None).unwrap()).exists());
    }

    #[test]
    fn rollback_and_malformed_sql() {
        let directory = tempfile::tempdir().unwrap();
        let mut database = Database::open(&directory.path().join("project.db"), true).unwrap();
        database
            .transaction(vec![statement("CREATE TABLE items (value TEXT)", vec![])])
            .unwrap();
        for bad_sql in [
            "not valid SQL",
            "INSERT INTO items VALUES ('partial'); invalid SQL",
            "COMMIT",
            "ROLLBACK",
            "PRAGMA synchronous=OFF",
        ] {
            assert!(
                database
                    .transaction(vec![
                        statement("INSERT INTO items VALUES ('unsaved')", vec![]),
                        statement(bad_sql, vec![]),
                    ])
                    .is_err()
            );
            assert!(
                database
                    .query("SELECT * FROM items", vec![])
                    .unwrap()
                    .is_empty()
            );
        }
        assert!(database.query("not valid SQL", vec![]).is_err());
        assert!(database.query("SELECT 1; invalid SQL", vec![]).is_err());
        assert!(database.query("SELECT 1; SELECT 2", vec![]).is_err());
        assert_eq!(
            database
                .query("SELECT 1 AS value; -- trailing comment", vec![])
                .unwrap()[0]["value"],
            1
        );
        assert!(
            database
                .query("INSERT INTO items VALUES ('oops') RETURNING *", vec![])
                .is_err()
        );
        assert!(database.query("PRAGMA user_version=2", vec![]).is_err());
    }

    #[test]
    fn readonly_schema_inspection() {
        let directory = tempfile::tempdir().unwrap();
        let mut database = Database::open(&directory.path().join("project.db"), true).unwrap();
        database
            .transaction(vec![
                statement("CREATE TABLE parents (id INTEGER PRIMARY KEY)", vec![]),
                statement(
                    "CREATE TABLE items (parent_id INTEGER REFERENCES parents(id))",
                    vec![],
                ),
                statement("CREATE INDEX items_parent ON items(parent_id)", vec![]),
            ])
            .unwrap();
        for pragma in [
            "table_info(items)",
            "table_xinfo(items)",
            "index_info(items_parent)",
            "index_list(items)",
            "foreign_key_list(items)",
        ] {
            assert!(
                !database
                    .query(&format!("PRAGMA {pragma}"), vec![])
                    .unwrap()
                    .is_empty()
            );
        }
        assert_eq!(
            database.query("PRAGMA table_info(items)", vec![]).unwrap()[0]["name"],
            "parent_id"
        );
        assert!(database.query("PRAGMA foreign_keys=OFF", vec![]).is_err());
    }

    #[test]
    fn exclusive_connection_and_create_new() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("project.db");
        assert!(Database::open(&path, false).is_err());
        let database = Database::open(&path, true).unwrap();
        assert!(Database::open(&path, false).is_err());
        assert!(Database::open(&path, true).is_err());
        drop(database);
        assert!(Database::open(&path, false).is_ok());
        assert!(Database::open(&path, true).is_err());
    }

    #[test]
    fn blobs_and_values_survive_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("project.db");
        let mut database = Database::open(&path, true).unwrap();
        database.transaction(vec![
            statement("CREATE TABLE items (bytes BLOB, text TEXT, number REAL, flag INTEGER, empty TEXT)", vec![]),
            statement("INSERT INTO items VALUES (?, ?, ?, ?, ?)", vec![json!({"blob":"AP+A"}), json!("hello"), json!(1.5), json!(true), Value::Null]),
            statement("PRAGMA user_version=1", vec![]),
        ]).unwrap();
        drop(database);
        let database = Database::open(&path, false).unwrap();
        let rows = database.query("SELECT * FROM items", vec![]).unwrap();
        assert_eq!(
            rows[0],
            json!({"bytes":{"blob":"AP+A"},"text":"hello","number":1.5,"flag":1,"empty":null})
                .as_object()
                .unwrap()
                .clone()
        );
        assert_eq!(
            database.query("PRAGMA user_version", vec![]).unwrap()[0]["user_version"],
            1
        );
        assert!(
            database
                .query("SELECT ?", vec![json!({"blob":"!"})])
                .is_err()
        );
    }

    #[test]
    fn atomic_write_replaces_complete_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("export.bin");
        atomic_write(&path, b"old contents").unwrap();
        atomic_write(&path, &[0, 255, 128]).unwrap();
        assert_eq!(
            read_file(&path).unwrap(),
            json!({"name":"export.bin","data":"AP+A"})
        );
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
        assert!(atomic_write(&directory.path().join("missing/file"), b"x").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), [0, 255, 128]);
    }
}
