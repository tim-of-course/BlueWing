"""Exercise the actual desktop app through its public CLI, with isolated project/cache data.

Build native binaries and dist first. Optional BLUEWING_TEST_PLAN imports a local real PDF.
No source plans or project files are uploaded. Evidence stays in tmp/desktop-workflow.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
BIN = Path(os.environ.get("BLUEWING_NATIVE_BIN_DIR", ROOT / "src-tauri/target/debug"))
EVIDENCE = ROOT / "tmp/desktop-workflow"
EVIDENCE.mkdir(parents=True, exist_ok=True)

with tempfile.TemporaryDirectory(prefix="bluewing-product-") as temporary:
    data = Path(temporary)
    env = dict(os.environ, BLUEWING_DATA_DIR=temporary)
    cached = data / "web/product-test"
    shutil.copytree(ROOT / "dist", cached)
    (data / "web/active").write_text("product-test")
    log = open(EVIDENCE / "native.log", "w")
    desktop = subprocess.Popen([str(BIN / "bluewing-desktop")], env=env, stdout=log, stderr=log)
    project_id = None
    revision = None
    transcript = []

    def call(name, payload=None, mutates=False, expected=None, succeeds=True):
        global project_id, revision
        request = {"payload": payload or {}}
        if mutates:
            request.update(projectId=project_id, expectedRevision=revision if expected is None else expected)
        result = subprocess.run([str(BIN / "bluewing"), name, "--stdin"], input=json.dumps(request),
                                capture_output=True, text=True, env=env, timeout=90)
        response = json.loads(result.stdout)
        transcript.append({"command": name, "exit": result.returncode, "response": response})
        if succeeds:
            assert result.returncode == 0 and response.get("ok"), response
            project_id, revision = response.get("projectId"), response.get("revision")
        else:
            assert result.returncode != 0 and not response.get("ok"), response
        return response.get("data") if succeeds else response

    try:
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            result = subprocess.run([str(BIN / "bluewing"), "commands.list"], capture_output=True, text=True, env=env)
            if result.returncode == 0:
                break
            if desktop.poll() is not None:
                raise AssertionError((EVIDENCE / "native.log").read_text())
            time.sleep(0.2)
        else:
            raise AssertionError("Desktop command bridge did not become ready")

        project_path = str(data / "estimate.bluewing")
        call("project.create", {"name": "Independent workflow", "path": project_path})
        sheets = call("project.import", {"path": str(ROOT / "tests/fixtures/assessment-plan.pdf")}, True)
        assert len(sheets) == 1 and sheets[0]["width"] == 612 and sheets[0]["height"] == 396
        sheet_id = sheets[0]["id"]
        call("sheet.calibrate", {"id": sheet_id, "start": {"x": 72, "y": 144}, "end": {"x": 360, "y": 144}, "distance": {"value": 24, "unit": "ft"}}, True)
        commands = []
        for name, kind, points, recipe, inputs in [
            ("wall", "path", [(72, 144), (360, 144)], "wall-area", {"height": 8, "layers": 2}),
            ("floor", "area", [(72, 144), (360, 144), (360, 324), (72, 324)], "floor-area", {}),
            ("items", "count", [(100, 200), (180, 200), (270, 200)], "count", {}),
        ]:
            commands.extend([
                {"name": "geometry.put", "payload": {"id": name, "sheetId": sheet_id, "name": name, "kind": kind, "points": [{"x": x, "y": y} for x, y in points]}},
                {"name": "group.put", "payload": {"id": name + "-group", "name": name, "geometryIds": [name]}},
                {"name": "assignment.put", "payload": {"id": name + "-assignment", "groupId": name + "-group", "recipeId": recipe, "inputs": inputs, "allowances": {}}},
            ])
        call("batch", {"commands": commands}, True)
        quantities = call("quantities.inspect")
        amounts = {entry["materialId"]: entry["amount"] for entry in quantities["totals"]}
        assert quantities["complete"] and abs(amounts["wall-finish"] - 384) < 1e-8
        assert abs(amounts["floor-finish"] - 360) < 1e-8 and amounts["items"] == 3

        call("group.copy", {"id": "wall-group", "newId": "second-finish", "name": "Second finish"}, True)
        quantities = call("quantities.inspect")
        assert abs(next(t["amount"] for t in quantities["totals"] if t["materialId"] == "wall-finish") - 768) < 1e-8
        call("assignment.put", {"id": "wall-assignment", "groupId": "wall-group", "recipeId": "wall-area", "inputs": {"height": 8, "layers": 2}, "allowances": {"wall-area": {"wastePercent": 10, "packageSize": 32}}}, True)
        quantities = call("quantities.inspect")
        wall = next(output for output in quantities["outputs"] if output["assignmentId"] == "wall-assignment")
        assert abs(wall["baseAmount"] - 384) < 1e-8 and wall["packageCount"] == 14 and wall["purchasedAmount"] == 448
        old_revision = revision
        call("geometry.move", {"ids": ["wall"], "dx": 12, "dy": 0}, True)
        stale = call("project.rename", {"name": "stale"}, True, expected=old_revision, succeeds=False)
        assert stale["error"]["code"] == "PROJECT_CONFLICT"
        call("history.undo", mutates=True)
        assert call("project.inspect")["geometries"]["wall"]["points"][0]["x"] == 72
        saved_revision = revision
        preview = call("preview", {"commands": [{"name": "project.rename", "payload": {"name": "Preview"}}]})
        assert preview["project"]["name"] == "Preview" and revision == saved_revision
        assert call("project.inspect")["name"] == "Independent workflow"
        image = call("sheet.render", {"sheetId": sheet_id, "path": str(EVIDENCE / "combined.png"), "maxDimension": 1224})
        assert image["pageToPixel"] == [2, 0, 0, 2, 0, 0]
        assert image["pixelToPage"] == [0.5, 0, 0, 0.5, 0, 0]
        crop = call("sheet.render", {"sheetId": sheet_id, "path": str(EVIDENCE / "crop.png"), "bounds": {"x": 72, "y": 144, "width": 144, "height": 144}, "maxDimension": 1440, "mode": "plan"})
        assert crop["pageToPixel"] == [10, 0, 0, 10, -720, -1440]
        exported = call("quantities.export", {"format": "csv"})
        assert "wall-finish" in exported and "floor-finish" in exported
        (EVIDENCE / "quantities.csv").write_text(exported)
        call("project.close", mutates=True)
        call("project.open", {"path": project_path})
        assert call("project.inspect")["revision"] == saved_revision
        call("history.undo", mutates=True, succeeds=False)

        reference = os.environ.get("BLUEWING_TEST_PLAN")
        if reference:
            imported = call("project.import", {"path": reference}, True)
            assert len(imported) == 15
            floor_plan = imported[3]
            assert floor_plan["width"] == 2592 and floor_plan["height"] == 1728
            call("sheet.render", {"sheetId": floor_plan["id"], "path": str(EVIDENCE / "behavioral-health-floor.png"), "maxDimension": 2000, "mode": "plan"})
            call("sheet.render", {"sheetId": floor_plan["id"], "path": str(EVIDENCE / "behavioral-health-detail.png"), "bounds": {"x": 800, "y": 450, "width": 600, "height": 600}, "maxDimension": 2400, "mode": "plan"})
        call("project.close", mutates=True)

        # Serve this release only during staging. The restarted app must use cache.
        release_directory = os.environ.get("BLUEWING_TEST_RELEASE_DIRECTORY")
        if release_directory:
            from functools import partial
            from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
            import threading
            requests = []

            class ReleaseHandler(SimpleHTTPRequestHandler):
                def end_headers(self):
                    self.send_header("Access-Control-Allow-Origin", "*")
                    super().end_headers()

                def log_message(self, *_args):
                    pass

                def do_GET(self):
                    requests.append({"path": self.path, "time": time.monotonic()})
                    super().do_GET()

            server = ThreadingHTTPServer(("127.0.0.1", 0), partial(ReleaseHandler, directory=release_directory))
            threading.Thread(target=server.serve_forever, daemon=True).start()
            manifest_url = f"http://127.0.0.1:{server.server_port}/manifest.json"
            try:
                staged = call("web.stage", {"manifestUrl": manifest_url})
                call("web.activate", {"version": staged["version"]})
            finally:
                server.shutdown()
                server.server_close()
                (EVIDENCE / "release-requests.json").write_text(json.dumps(requests, indent=2))
            desktop.terminate()
            desktop.wait(timeout=10)
            desktop = subprocess.Popen([str(BIN / "bluewing-desktop")], env=env, stdout=log, stderr=log)
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                result = subprocess.run([str(BIN / "bluewing"), "web.inspect"], capture_output=True, text=True, env=env)
                if result.returncode == 0:
                    assert json.loads(result.stdout)["data"]["activeVersion"] == staged["version"]
                    break
                time.sleep(0.2)
            else:
                raise AssertionError("Cached web release did not start after release server stopped")
            call("project.open", {"path": project_path})
            assert call("quantities.inspect")["complete"]
            call("sheet.render", {"sheetId": sheet_id, "path": str(EVIDENCE / "offline.png"), "maxDimension": 1224})
            call("project.close", mutates=True)
    finally:
        (EVIDENCE / "commands.json").write_text(json.dumps(transcript, indent=2))
        desktop.terminate()
        desktop.wait(timeout=10)
        log.close()

print("PASS: desktop PDF import, independent wall/area/count quantities, shared groups, CLI image mapping, conflicts, preview, undo, export and reopen")
if os.environ.get("BLUEWING_TEST_RELEASE_DIRECTORY"):
    print("PASS: complete web release download, activation, server-offline restart, project reopen and PDF render")
