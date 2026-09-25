"""Native assembly/library workflow with isolated projects and app data."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
BIN = Path(os.environ.get('BLUEWING_NATIVE_BIN_DIR', ROOT / 'src-tauri/target/debug'))
EVIDENCE = ROOT / 'tmp/assembly-workflow'
EVIDENCE.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='bluewing-assemblies-') as temporary:
    data = Path(temporary)
    env = dict(os.environ, BLUEWING_DATA_DIR=temporary)
    shutil.copytree(ROOT / 'dist', data / 'web/assembly-test')
    (data / 'web/active').write_text('assembly-test')
    log = open(EVIDENCE / 'native.log', 'w')
    desktop = None
    project_id = None
    revision = None
    transcript = []

    def start():
        global desktop
        desktop = subprocess.Popen([str(BIN / 'bluewing-desktop')], env=env, stdout=log, stderr=log)
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            probe = subprocess.run([str(BIN / 'bluewing'), 'commands.list'], capture_output=True, text=True, env=env)
            if probe.returncode == 0:
                return
            if desktop.poll() is not None:
                raise AssertionError((EVIDENCE / 'native.log').read_text())
            time.sleep(0.2)
        raise AssertionError('Desktop did not become ready')

    def call(name, payload=None, mutates=False, succeeds=True):
        global project_id, revision
        request = {'payload': payload or {}}
        if mutates:
            request.update(projectId=project_id, expectedRevision=revision)
        result = subprocess.run([str(BIN / 'bluewing'), name, '--stdin'], input=json.dumps(request), capture_output=True, text=True, env=env, timeout=90)
        response = json.loads(result.stdout)
        transcript.append({'command': name, 'exit': result.returncode, 'response': response})
        if succeeds:
            assert result.returncode == 0 and response.get('ok'), response
            project_id, revision = response.get('projectId'), response.get('revision')
            return response['data']
        assert result.returncode != 0 and not response.get('ok'), response
        return response

    def quantities():
        result = call('quantities.inspect')
        result['outputs'].sort(key=lambda row: json.dumps([row['assignmentId'], row['outputId'], row.get('cutLength'), row.get('stockLength')], sort_keys=True))
        result['totals'].sort(key=lambda row: json.dumps([row['materialId'], row['unit'], row.get('cutLength'), row.get('stockLength')], sort_keys=True))
        return result

    def schedule():
        return sorted(call('pieces.inspect'), key=lambda row: (row['assignmentId'], row['outputId'], row['geometryId']))

    try:
        start()
        library = call('library.inspect')
        assert 'drywall-face' in library['assemblies']
        project_path = str(data / 'first.bluewing')
        call('project.create', {'name': 'Detailed job', 'path': project_path})
        sheets = call('project.import', {'path': str(ROOT / 'tests/fixtures/assessment-plan.pdf')}, True)
        sheet = sheets[0]['id']
        call('sheet.scale', {'id': sheet, 'paper': {'value': 1, 'unit': 'in'}, 'real': {'value': 6, 'unit': 'ft'}}, True)
        call('assembly.import', {'libraryId': 'drywall-face', 'id': 'board'}, True)
        call('assembly.import', {'libraryId': 'steel-straight-run', 'id': 'stud'}, True)
        call('assembly.import', {'libraryId': 'header-components', 'id': 'header'}, True)
        commands = []
        for ident, y in [('a', 144), ('b', 200)]:
            commands.append({'name': 'geometry.put', 'payload': {'id': ident, 'name': 'Wall ' + ident, 'sheetId': sheet, 'kind': 'path', 'points': [{'x': 72, 'y': y}, {'x': 360, 'y': y}]}})
        commands.extend([
            {'name': 'geometry.put', 'payload': {'id': 'opening', 'name': 'Opening H1', 'sheetId': sheet, 'kind': 'count', 'points': [{'x': 150, 'y': 144}]}},
            {'name': 'group.put', 'payload': {'id': 'walls', 'name': 'Walls', 'geometryIds': ['a', 'b']}},
            {'name': 'group.put', 'payload': {'id': 'openings', 'name': 'Openings', 'geometryIds': ['opening']}},
            {'name': 'assignment.put', 'payload': {'id': 'board-assignment', 'groupId': 'walls', 'recipeId': 'board', 'inputs': {'height': 8}, 'geometryInputs': {'b': {'height': 10, 'layers': 2, 'deduction': 21}}, 'allowances': {}}},
            {'name': 'assignment.put', 'payload': {'id': 'stud-assignment', 'groupId': 'walls', 'recipeId': 'stud', 'inputs': {'height': 10, 'stockLength': 12, 'endAllowance': 0.5}, 'geometryInputs': {'b': {'height': 11}}, 'allowances': {'studs': {'wastePercent': 10}}}},
            {'name': 'assignment.put', 'payload': {'id': 'header-assignment', 'groupId': 'openings', 'recipeId': 'header', 'inputs': {'openingWidth': 4, 'endExtension': 3, 'piecesPerOpening': 2, 'stockLength': 6}, 'allowances': {}}},
        ])
        call('batch', {'commands': commands}, True)
        totals = quantities()
        assert totals['complete']
        assert abs(next(t['amount'] for t in totals['totals'] if t['materialId'] == 'drywall-unspecified') - 630) < 1e-8
        assert next(t['amount'] for t in totals['totals'] if t['materialId'] == 'steel-stud-unspecified') == 42
        pieces = schedule()
        assert len(pieces) == 3 and sum(p['quantity'] for p in pieces) == 40
        assert abs(next(p['cutLength_m'] for p in pieces if p['location'] == 'Opening H1') - 1.3716) < 1e-8
        (EVIDENCE / 'pieces.csv').write_text(call('pieces.export', {'format': 'csv'}))
        stud_assignment = call('project.inspect')['assignments']['stud-assignment']
        stud_assignment['allowances']['studs']['packageSize'] = 20
        call('assignment.put', stud_assignment, True)
        assert next(t['amount'] for t in quantities()['totals'] if t['materialId'] == 'steel-stud-unspecified') == 60
        call('history.undo', mutates=True)
        assert quantities() == totals
        # A global edit and deletion cannot change an existing project copy.
        template = library['assemblies']['drywall-face']
        template['inputs'][1]['default'] = 5
        edited = call('library.put', {'assembly': template, 'expectedLibraryRevision': library['revision']})
        assert quantities() == totals
        call('library.put', {'assembly': template, 'expectedLibraryRevision': library['revision']}, succeeds=False)
        # Project default edits preserve explicit per-object overrides and support Undo.
        project = call('project.inspect')
        board = project['recipes']['board']
        board['inputs'][1]['default'] = 3
        call('assembly.put', board, True)
        changed = quantities()
        assert abs(next(t['amount'] for t in changed['totals'] if t['materialId'] == 'drywall-unspecified') - 1014) < 1e-8
        call('history.undo', mutates=True)
        assert quantities() == totals
        call('project.close', mutates=True)
        # Restart proves library durability outside any open project.
        desktop.terminate()
        desktop.wait(timeout=10)
        start()
        assert call('library.inspect')['assemblies']['drywall-face']['inputs'][1]['default'] == 5
        call('project.create', {'name': 'Second project', 'path': str(data / 'second.bluewing')})
        copied = call('assembly.import', {'libraryId': 'drywall-face', 'id': 'new-board'}, True)
        assert copied['inputs'][1]['default'] == 5
        call('library.delete', {'id': 'drywall-face', 'expectedLibraryRevision': edited['revision']})
        assert call('project.inspect')['recipes']['new-board']['inputs'][1]['default'] == 5
        call('project.close', mutates=True)
        call('project.open', {'path': project_path})
        assert quantities() == totals
        assert schedule() == pieces
        call('sheet.render', {'sheetId': sheet, 'path': str(EVIDENCE / 'assemblies.png'), 'maxDimension': 1224})
        call('project.close', mutates=True)
    finally:
        (EVIDENCE / 'commands.json').write_text(json.dumps(transcript, indent=2))
        if desktop is not None and desktop.poll() is None:
            desktop.terminate()
            desktop.wait(timeout=10)
        log.close()
print('PASS: native assemblies, object overrides, piece CSV, global/project independence, conflicts, Undo, restart and two-project reuse')
