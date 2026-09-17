use base64::{Engine, engine::general_purpose::STANDARD};
use rusqlite::{
    Connection, OpenFlags,
    hooks::{AuthAction, AuthContext, Authorization},
    params_from_iter,
    types::{Value as SqlValue, ValueRef},
};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::{fs::File, fs::OpenOptions, io::Write, path::Path};

pub struct Database {
    // Drop SQLite before releasing the application's exclusive writer lock.
    connection: Connection,
    _lock: File,
}

#[derive(Deserialize)]
pub struct Statement {
    pub sql: String,
    pub params: Vec<Value>,
}

impl Database {
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

    pub fn transaction(&mut self, statements: Vec<Statement>) -> Result<(), String> {
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

    fn statement(sql: &str, params: Vec<Value>) -> Statement {
        Statement {
            sql: sql.into(),
            params,
        }
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
