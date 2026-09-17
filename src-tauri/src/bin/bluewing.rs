use std::io::Read;
fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let result = (|| {
        let input = if let Some(i) = args.iter().position(|a| a == "--stdin") {
            args.remove(i);
            let mut s = String::new();
            std::io::stdin()
                .read_to_string(&mut s)
                .map_err(|e| e.to_string())?;
            Some(s)
        } else {
            None
        };
        bluewing_native::transport::launch(args, input)
    })();
    match result {
        Ok(reply) => {
            println!("{}", reply.response);
            std::process::exit(reply.exit_code.clamp(0, 255));
        }
        Err(e) => {
            println!("{}", serde_json::json!({"error":e}));
            std::process::exit(1);
        }
    }
}
