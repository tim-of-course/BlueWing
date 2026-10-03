"""Native assembly/library workflow with isolated projects and app data."""
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tests'))
from resource_guard import ensure_resource_guard
ensure_resource_guard()
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
        # Explicitly restoring deleted starters preserves unrelated library definitions.
        for ident in ['ceiling-grid-2x2', 'ceiling-grid-2x4']:
            library = call('library.delete', {'id': ident, 'expectedLibraryRevision': library['revision']})
        old_revision = library['revision']
        library = call('library.addStarters', {'expectedLibraryRevision': old_revision})
        assert 'ceiling-grid-2x2' in library['assemblies'] and 'ceiling-grid-2x4' in library['assemblies']
        call('library.addStarters', {'expectedLibraryRevision': old_revision}, succeeds=False)
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
        assert not totals['coverage']['complete']
        assert all(row['modeling'] == 'estimate' for row in totals['outputs'])
        assert call('construction.inspect')['pieces'] == []
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
        # Both ceiling systems use the same measured 24 x 15 ft / 78 LF room.
        call('geometry.put', {'id': 'ceiling', 'name': 'Ceiling room', 'sheetId': sheet, 'kind': 'area', 'points': [{'x': 72, 'y': 144}, {'x': 360, 'y': 144}, {'x': 360, 'y': 324}, {'x': 72, 'y': 324}]}, True)
        call('group.put', {'id': 'ceilings', 'name': 'Ceilings', 'geometryIds': ['ceiling']}, True)
        for size in ['2x2', '2x4']:
            call('assembly.import', {'libraryId': 'ceiling-grid-' + size + '-estimate', 'id': size}, True)
            call('assignment.put', {'id': size, 'groupId': 'ceilings', 'recipeId': size, 'inputs': {'tileDeduction': 40}, 'allowances': {}}, True)
            rows = {row['outputId']: row['purchasedAmount'] for row in quantities()['outputs'] if row['assignmentId'] == size}
            assert abs(rows.pop('ceiling-area') - 320) < 1e-8
            assert rows == {'tee-2ft': 45 if size == '2x2' else 0, 'tee-4ft': 45, 'mains': 8, 'wall-angle': 7}, rows
        csv = call('quantities.export', {'format': 'csv'})
        for name in ['2 ft cross tees', '4 ft cross tees', 'Main runner stock lengths', 'Wall angle stock lengths']:
            assert name in csv
        (EVIDENCE / 'ceilings.csv').write_text(csv)
        # A corner-aligned 8 x 8 ft layout has independently countable members.
        # Boundaries receive angle, not another row of mains or tees.
        call('geometry.put', {'id': 'layout-room', 'name': '8 ft ceiling layout', 'sheetId': sheet,
                              'kind': 'area', 'points': [{'x': 72, 'y': 360}, {'x': 168, 'y': 360},
                                                        {'x': 168, 'y': 456}, {'x': 72, 'y': 456}]}, True)
        call('group.put', {'id': 'layout-group', 'name': 'Ceiling layout', 'geometryIds': ['layout-room']}, True)
        assignment = {'id': 'layout-assignment', 'groupId': 'layout-group', 'recipeId': '2x2',
                      'inputs': {}, 'allowances': {}}
        call('assignment.put', assignment, True)
        assert all(row['modeling'] == 'estimate' for row in quantities()['outputs']
                   if row['assignmentId'] == assignment['id'])
        assert not call('construction.inspect')['pieces']
        for size in ['2x2', '2x4']:
            assembly = call('assembly.import', {'libraryId': 'ceiling-grid-' + size, 'id': size + '-layout'}, True)
            assembly['ceilingTemplate']['grid']['origin'] = {'x': 72 * 0.0254, 'y': -456 * 0.0254}
            call('assembly.put', assembly, True)
            # Replacing this assignment replaces its estimate or prior layout contribution.
            assignment['recipeId'] = assembly['id']
            call('assignment.put', assignment, True)
            model = call('construction.inspect')
            assert model['complete'] and not model['diagnostics'], model['diagnostics']
            expected = {'ceiling-main': (1, 8), 'ceiling-tee-4ft': (6, 4),
                        'ceiling-wall-angle': (4, 8)}
            if size == '2x2':
                expected['ceiling-tee-2ft'] = (8, 2)
            assert {piece['role'] for piece in model['pieces']} == expected.keys()
            for role, (count, feet) in expected.items():
                members = [piece for piece in model['pieces'] if piece['role'] == role]
                assert len(members) == count, (role, members)
                assert all(math.isclose(piece['cutLength'], feet * 0.3048, abs_tol=1e-8) for piece in members)
            assert len(model['surfaces']) == (16 if size == '2x2' else 8)
            assert math.isclose(sum(surface['area'] for surface in model['surfaces']), 64 * 0.09290304, abs_tol=1e-8)
            outputs = [row for row in quantities()['outputs'] if row['assignmentId'] == assignment['id']]
            assert outputs and all(row['modeling'] == 'modeled' for row in outputs)
            sources = [source for row in outputs for source in row['sources']]
            assert {source['pieceId'] for source in sources if 'pieceId' in source} == {p['id'] for p in model['pieces']}
            assert {source['surfaceId'] for source in sources if 'surfaceId' in source} == {s['id'] for s in model['surfaces']}
            assert math.isclose(sum(row['baseAmount'] for row in outputs if row['unit'] == 'ft2'), 64, abs_tol=1e-8)
            for role, (count, _) in expected.items():
                assert sum(row['purchasedAmount'] for row in outputs if row.get('role') == role) == count
            # Waste changes orders, never the installed layout or its cut schedule.
            assembly['ceilingTemplate']['grid']['crossTee4']['wastePercent'] = 10
            call('assembly.put', assembly, True)
            with_waste = call('construction.inspect')
            assert len(with_waste['pieces']) == len(model['pieces'])
            assert [(piece['id'], piece['start'], piece['end'], piece['cutLength']) for piece in with_waste['pieces']] == [
                (piece['id'], piece['start'], piece['end'], piece['cutLength']) for piece in model['pieces']]
            assert next(row['purchasedCount'] for row in with_waste['purchases']
                        if row['role'] == 'ceiling-tee-4ft') == 7
            call('history.undo', mutates=True)
            assert call('construction.inspect') == model
        call('construction.render', {'path': str(EVIDENCE / 'ceiling-layout.png'), 'width': 800, 'height': 500,
                                     'geometryIds': ['layout-room']})
        ceiling_totals = quantities()
        ceiling_model = call('construction.inspect')
        call('project.close', mutates=True)
        call('project.open', {'path': project_path})
        assert quantities() == ceiling_totals
        assert call('construction.inspect') == ceiling_model
        call('sheet.render', {'sheetId': sheet, 'path': str(EVIDENCE / 'assemblies.png'), 'maxDimension': 1224})
        call('project.close', mutates=True)
    finally:
        (EVIDENCE / 'commands.json').write_text(json.dumps(transcript, indent=2))
        if desktop is not None and desktop.poll() is None:
            desktop.terminate()
            desktop.wait(timeout=10)
        log.close()
print('PASS: native assemblies, object overrides, piece CSV, global/project independence, conflicts, Undo, restart, two-project reuse, ceiling estimates, positioned 2x2/2x4 layouts and starter restoration')
