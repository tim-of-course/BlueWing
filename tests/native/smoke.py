"""Real webview/CLI/cache integration check; run after building both binaries."""
import base64
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
BIN = Path(os.environ.get("BLUEWING_NATIVE_BIN_DIR", ROOT / "src-tauri/target/debug"))


def bundle(version):
    # The distinct script filename proves assets absent from the embedded bundle load.
    script = """
const api = window.__TAURI_INTERNALS__;
const invoke = api.invoke;
const handler = api.transformCallback(async ({payload:r}) => {
  try {
    let response;
    if (r.args[0] === 'activate') {
      await invoke('cache_activate',{version:r.args[1]});
      await invoke('cli_respond', {id:r.id,response:{scheduled:true},exitCode:0});
      window.location.reload();
      return;
    } else if (r.args[0] === 'asset') {
      const asset = await fetch('/missing.js');
      response = {status:asset.status,body:await asset.text()};
    } else if (r.args[0] === 'invoke') {
      response = await invoke(r.args[1], JSON.parse(r.input || '{}'));
    } else {
      response = {version:VERSION, bridge:await invoke('bridge_ready'), args:r.args,input:r.input};
    }
    await invoke('cli_respond', {id:r.id,response,exitCode:0});
  } catch (error) {
    await invoke('cli_respond',{id:r.id,response:{error:String(error)},exitCode:1});
  }
});
await invoke('plugin:event|listen',{event:'bluewing:cli-request',target:{kind:'Any'},handler});
await invoke('bridge_ready');
""".replace("VERSION", json.dumps(version))
    return {"index.html": f'<html><body>{version}<script type="module" src="/{version}.js"></script></body></html>', f"{version}.js": script}


with tempfile.TemporaryDirectory(prefix="bluewing-native-") as directory:
    data = Path(directory)
    env = dict(os.environ, BLUEWING_DATA_DIR=directory)
    initial = data / "web/smoke-v1"
    initial.mkdir(parents=True)
    for name, content in bundle("smoke-v1").items():
        (initial / name).write_text(content)
    (data / "web/active").write_text("smoke-v1")

    def cli(*args, payload=None, ok=True):
        argv = [str(BIN / "bluewing"), *args]
        if payload is not None:
            argv.append("--stdin")
        result = subprocess.run(argv, input=json.dumps(payload) if payload is not None else None,
                                capture_output=True, text=True, env=env, timeout=70)
        reply = json.loads(result.stdout)
        if ok:
            assert result.returncode == 0, reply
        else:
            assert result.returncode != 0, reply
        return reply

    def ready(version):
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            try:
                reply = cli("echo")
                if reply["version"] == version:
                    assert reply["bridge"]["webVersion"] == version
                    return
            except (AssertionError, KeyError, json.JSONDecodeError):
                pass
            time.sleep(0.2)
        raise AssertionError(f"Webview did not become ready: {version}")

    desktop = subprocess.Popen([str(BIN / "bluewing-desktop")], env=env)
    try:
        ready("smoke-v1")
        second = subprocess.run([str(BIN / "bluewing-desktop")], env=env,
                                capture_output=True, text=True, timeout=15)
        assert second.returncode != 0
        assert "already running" in second.stderr
        assert cli("asset")["status"] == 404
        if os.name == "posix":
            assert stat.S_IMODE((data / "cli-session.json").stat().st_mode) == 0o600
        assert cli("echo", payload={"hello": "stdin"})["input"] == '{"hello": "stdin"}'
        project = str(data / "project.sqlite")
        cli("invoke", "database_open", payload={"path": project, "create": True})
        cli("invoke", "database_transaction", payload={"statements": [
            {"sql": "CREATE TABLE sample (value TEXT)", "params": []},
            {"sql": "INSERT INTO sample VALUES (?)", "params": ["saved"]}]})
        cli("invoke", "cache_activate", payload={"version": "0.1.0"}, ok=False)
        cli("invoke", "database_close")
        cli("invoke", "database_open", payload={"path": project, "create": False})
        assert cli("invoke", "database_query", payload={"sql": "SELECT value FROM sample", "params": []}) == [{"value": "saved"}]
        cli("invoke", "database_close")
        cli("invoke", "cache_stage", payload={"version": "smoke-v2", "files": [
            {"path": name, "data": base64.b64encode(content.encode()).decode()}
            for name, content in bundle("smoke-v2").items()]})
        cli("activate", "smoke-v2")
        ready("smoke-v2")
    finally:
        desktop.terminate()
        desktop.wait(timeout=10)
    desktop = subprocess.Popen([str(BIN / "bluewing-desktop")], env=env)
    try:
        ready("smoke-v2")
    finally:
        desktop.terminate()
        desktop.wait(timeout=10)
    cli("echo", ok=False)
print("PASS: native IPC, CLI stdin, durable SQLite, activation guard, new cached assets, offline restart")
