use crate::transport::{Reply, TIMEOUT};
use serde_json::{Value, json};
use std::time::{Duration, Instant};

const DEFAULT_MS: u64 = 300_000;
const POLL_MS: u64 = 25_000;
const MAX_SAFE: u64 = 9_007_199_254_740_991;

// Leave validation errors to the application's normal parser. In particular,
// never turn extra arguments or a malformed envelope into a valid request.
fn wait_request(args: &[String], input: Option<&str>) -> Option<(Value, Duration)> {
    if args.first()?.as_str() != "messages.wait"
        || args.len() > 2
        || (input.is_some() && args.len() > 1)
    {
        return None;
    }
    let mut body: Value = serde_json::from_str(
        input
            .or_else(|| args.get(1).map(String::as_str))
            .unwrap_or("{}"),
    )
    .ok()?;
    let fields = body.as_object()?;
    if fields.keys().any(|key| {
        !["payload", "projectId", "expectedRevision", "messagesAfter"].contains(&key.as_str())
    }) || fields.get("projectId").is_some_and(|v| !v.is_string())
        || fields
            .get("messagesAfter")
            .is_some_and(|v| safe_integer(v).is_none())
        || fields
            .get("expectedRevision")
            .is_some_and(|v| v.as_f64().is_none_or(|n| n.fract() != 0.0))
    {
        return None;
    }
    if body.get("payload").is_none_or(Value::is_null) {
        body["payload"] = json!({});
    }
    let payload = body["payload"].as_object()?;
    if payload
        .keys()
        .any(|key| !["after", "timeoutMs", "waitToken"].contains(&key.as_str()))
        || payload
            .get("after")
            .is_some_and(|v| safe_integer(v).is_none())
        || payload.get("waitToken").is_some_and(|v| !v.is_string())
    {
        return None;
    }
    let ms = payload
        .get("timeoutMs")
        .map_or(Some(DEFAULT_MS), safe_integer)?;
    Some((body, Duration::from_millis(ms)))
}

fn safe_integer(value: &Value) -> Option<u64> {
    let n = value.as_f64()?;
    (n >= 0.0 && n <= MAX_SAFE as f64 && n.fract() == 0.0).then_some(n as u64)
}

pub(crate) fn launch(
    args: Vec<String>,
    input: Option<String>,
    exchange: impl FnMut(Vec<String>, Option<String>, Duration) -> Result<Reply, String>,
) -> Result<Reply, String> {
    let started = Instant::now();
    renew(args, input, exchange, || started.elapsed())
}

fn renew(
    args: Vec<String>,
    input: Option<String>,
    mut exchange: impl FnMut(Vec<String>, Option<String>, Duration) -> Result<Reply, String>,
    mut elapsed: impl FnMut() -> Duration,
) -> Result<Reply, String> {
    let Some((mut body, total)) = wait_request(&args, input.as_deref()) else {
        return exchange(args, input, TIMEOUT + Duration::from_secs(5));
    };
    loop {
        let remaining = total.saturating_sub(elapsed());
        body["payload"]["timeoutMs"] = json!(remaining.as_millis().min(POLL_MS as u128) as u64);
        let wire = body.to_string();
        let (next_args, next_input) = if input.is_some() {
            (vec![args[0].clone()], Some(wire))
        } else {
            (vec![args[0].clone(), wire], None)
        };
        // A zero-duration wait still needs enough time for one immediate reply.
        let socket_timeout = remaining.min(TIMEOUT) + Duration::from_secs(5);
        let reply = exchange(next_args, next_input, socket_timeout)?;
        let data = &reply.response["data"];
        let user_delivery = reply.response["messages"]
            .as_array()
            .is_some_and(|messages| messages.iter().any(|message| message["sender"] == "user"));
        if reply.exit_code != 0
            || reply.response["ok"] != true
            || data["status"] != "timeout"
            || user_delivery
            || elapsed() >= total
        {
            return Ok(reply);
        }
        let Some(token) = data["waitToken"].as_str() else {
            return Ok(reply);
        };
        let Some(project) = data["projectId"].as_str() else {
            return Ok(reply);
        };
        body["payload"]["waitToken"] = json!(token);
        body["projectId"] = json!(project);
        // Keep the original cursors: intermediate replies are not delivered to
        // the caller. The final response must still include their messages.
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn reply(status: &str) -> Reply {
        Reply {
            exit_code: 0,
            response: json!({"ok":true,"messages":[],"data":{
                "status":status,"messages":[],"after":99,"waitToken":"generation-1","projectId":"project-1"
            }}),
        }
    }

    #[test]
    fn renews_in_bounded_chunks_and_binds_without_consuming_cursors() {
        for stdin in [false, true] {
            let source =
                json!({"messagesAfter":3,"payload":{"after":2,"timeoutMs":60000}}).to_string();
            let args = if stdin {
                vec!["messages.wait".into()]
            } else {
                vec!["messages.wait".into(), source.clone()]
            };
            let clock = Cell::new(0);
            let mut calls = 0;
            let result = renew(
                args,
                stdin.then_some(source),
                |args, input, _| {
                    let body: Value =
                        serde_json::from_str(input.as_deref().unwrap_or_else(|| &args[1])).unwrap();
                    assert_eq!(body["payload"]["timeoutMs"], [25000, 25000, 10000][calls]);
                    assert_eq!(body["payload"]["after"], 2);
                    assert_eq!(body["messagesAfter"], 3);
                    if calls > 0 {
                        assert_eq!(body["projectId"], "project-1");
                        assert_eq!(body["payload"]["waitToken"], "generation-1");
                    }
                    calls += 1;
                    clock.set(clock.get() + body["payload"]["timeoutMs"].as_u64().unwrap());
                    Ok(reply("timeout"))
                },
                || Duration::from_millis(clock.get()),
            )
            .unwrap();
            assert_eq!(calls, 3);
            assert_eq!(result.response["data"]["status"], "timeout");
        }
    }

    #[test]
    fn default_and_zero_timeout() {
        assert_eq!(
            wait_request(&["messages.wait".into()], None).unwrap().1,
            Duration::from_millis(DEFAULT_MS)
        );
        let mut calls = 0;
        renew(
            vec![
                "messages.wait".into(),
                r#"{"payload":{"timeoutMs":0}}"#.into(),
            ],
            None,
            |args, _, _| {
                calls += 1;
                let body: Value = serde_json::from_str(&args[1]).unwrap();
                assert_eq!(body["payload"]["timeoutMs"], 0);
                Ok(reply("timeout"))
            },
            || Duration::ZERO,
        )
        .unwrap();
        assert_eq!(calls, 1);
    }

    #[test]
    fn stops_for_status_errors_and_racing_user_messages() {
        for case in [
            "messages",
            "ended",
            "project_changed",
            "error",
            "user",
            "transport",
        ] {
            let mut calls = 0;
            let result = renew(
                vec!["messages.wait".into()],
                None,
                |_, _, _| {
                    calls += 1;
                    let mut response = reply(case);
                    match case {
                        "transport" => return Err("disconnected".into()),
                        "error" => {
                            response.exit_code = 3;
                            response.response["ok"] = json!(false);
                        }
                        "user" => {
                            response.response["data"]["status"] = json!("timeout");
                            response.response["messages"] = json!([{ "id":7,"sender":"user" }]);
                        }
                        _ => (),
                    }
                    Ok(response)
                },
                || Duration::ZERO,
            );
            assert_eq!(calls, 1);
            if case == "transport" {
                assert_eq!(result.err().unwrap(), "disconnected");
            } else {
                assert!(result.is_ok());
            }
        }
    }

    #[test]
    fn invalid_requests_and_mutations_pass_through_unchanged() {
        let requests = [
            (vec!["project.rename", "{}"], None),
            (vec!["messages.wait", "{}", "extra"], None),
            (vec!["messages.wait", "{}"], Some("{}")),
            (vec!["messages.wait", "not json"], None),
            (vec!["messages.wait", r#"{"unknown":true}"#], None),
            (
                vec!["messages.wait", r#"{"payload":{"timeoutMs":-1}}"#],
                None,
            ),
            (
                vec!["messages.wait", r#"{"payload":{"timeoutMs":1.5}}"#],
                None,
            ),
            (
                vec!["messages.wait", r#"{"payload":{"after":9007199254740992}}"#],
                None,
            ),
        ];
        for (args, input) in requests {
            let args: Vec<String> = args.into_iter().map(str::to_owned).collect();
            let input = input.map(str::to_owned);
            let mut calls = 0;
            renew(
                args.clone(),
                input.clone(),
                |actual_args, actual_input, _| {
                    calls += 1;
                    assert_eq!(actual_args, args);
                    assert_eq!(actual_input, input);
                    Ok(reply("timeout"))
                },
                || Duration::ZERO,
            )
            .unwrap();
            assert_eq!(calls, 1);
        }
    }
}
