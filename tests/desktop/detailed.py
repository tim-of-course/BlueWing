"""Native detailed takeoff, using assemblies.py's isolated guarded CLI harness.

Build separately before running. BLUEWING_TEST_DETAILED_PLAN optionally imports
the private large PDF and renders only its first, middle and last pages.
"""
import copy
from contextlib import closing
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path
import shutil
import sqlite3
import struct
import subprocess
import sys
import tempfile
import time
import zlib

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tests'))
from resource_guard import ensure_resource_guard
ensure_resource_guard()
BIN = Path(os.environ.get('BLUEWING_NATIVE_BIN_DIR', ROOT / 'src-tauri/target/debug'))
EVIDENCE = ROOT / 'tmp/detailed-workflow'
EVIDENCE.mkdir(parents=True, exist_ok=True)


def near(actual, expected):
    assert math.isclose(actual, expected, rel_tol=1e-9, abs_tol=1e-8), (actual, expected)


def equivalent(actual, expected):
    """JSON embedded in an export string bypasses Rust's float serialization."""
    if isinstance(expected, dict):
        assert actual.keys() == expected.keys()
        for key in expected:
            equivalent(actual[key], expected[key])
    elif isinstance(expected, list):
        assert len(actual) == len(expected)
        for left, right in zip(actual, expected):
            equivalent(left, right)
    elif isinstance(expected, float):
        near(actual, expected)
    else:
        assert actual == expected, (actual, expected)


def database_snapshot(path):
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as connection:
        assert connection.execute('PRAGMA integrity_check').fetchone() == ('ok',)
        return {
            'project': connection.execute('SELECT * FROM project').fetchall(),
            'records': connection.execute('SELECT * FROM records ORDER BY collection,id').fetchall(),
            'assets': [(ident, name, hashlib.sha256(blob).hexdigest()) for ident, name, blob in
                       connection.execute('SELECT id,name,data FROM assets ORDER BY id')],
        }


def png(metadata):
    """Validate actual PNG dimensions, chunk checksums and compressed pixels."""
    content = Path(metadata['path']).read_bytes()
    assert content[:8] == b'\x89PNG\r\n\x1a\n'
    assert struct.unpack('>II', content[16:24]) == (metadata['width'], metadata['height'])
    position, compressed = 8, bytearray()
    while position < len(content):
        length = struct.unpack('>I', content[position:position + 4])[0]
        kind = content[position + 4:position + 8]
        block = content[position + 8:position + 8 + length]
        checksum = struct.unpack('>I', content[position + 8 + length:position + 12 + length])[0]
        assert zlib.crc32(kind + block) == checksum
        if kind == b'IDAT':
            compressed.extend(block)
        position += length + 12
        if kind == b'IEND':
            break
    pixels = zlib.decompress(compressed)
    assert len(pixels) > metadata['width'] * metadata['height']
    return pixels


def transform(matrix, point):
    a, b, c, d, e, f = matrix
    x, y = point
    return a * x + c * y + e, b * x + d * y + f


with tempfile.TemporaryDirectory(prefix='bluewing-detailed-') as temporary:
    data = Path(temporary)
    env = dict(os.environ, BLUEWING_DATA_DIR=temporary)
    shutil.copytree(ROOT / 'dist', data / 'web/detailed-test')
    (data / 'web/active').write_text('detailed-test')
    log = open(EVIDENCE / 'native.log', 'w')
    desktop = None
    project_id = revision = None
    transcript = []

    def start():
        global desktop
        desktop = subprocess.Popen([str(BIN / 'bluewing-desktop')], env=env, stdout=log, stderr=log)
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            probe = subprocess.run([str(BIN / 'bluewing'), 'commands.list'], capture_output=True,
                                   text=True, env=env, timeout=10)
            if probe.returncode == 0:
                return
            if desktop.poll() is not None:
                raise AssertionError((EVIDENCE / 'native.log').read_text())
            time.sleep(0.2)
        raise AssertionError('Desktop did not become ready')

    def stop():
        if desktop is not None and desktop.poll() is None:
            desktop.terminate()
            try:
                desktop.wait(timeout=10)
            except subprocess.TimeoutExpired:
                desktop.kill()
                desktop.wait(timeout=10)

    def call(name, payload=None, mutates=False, succeeds=True, timeout=90):
        global project_id, revision
        request = {'payload': payload or {}}
        if mutates:
            request.update(projectId=project_id, expectedRevision=revision)
        result = subprocess.run([str(BIN / 'bluewing'), name, '--stdin'], input=json.dumps(request),
                                capture_output=True, text=True, env=env, timeout=timeout)
        entry = {'command': name, 'request': request, 'exit': result.returncode, 'stderr': result.stderr}
        transcript.append(entry)
        try:
            response = json.loads(result.stdout)
        except json.JSONDecodeError:
            entry['stdout'] = result.stdout
            raise AssertionError(entry) from None
        entry['response'] = response
        if succeeds:
            assert result.returncode == 0 and response.get('ok'), entry
            project_id, revision = response.get('projectId'), response.get('revision')
            return response['data']
        assert result.returncode != 0 and not response.get('ok'), entry
        return response

    def inspect():
        return call('project.inspect')

    def review_status():
        return next(mark['effectiveStatus'] for mark in call('review.inspect')['marks'] if mark['id'] == 'checked-wall')

    def finish_area(result, material):
        return sum(surface['area'] for surface in result['surfaces'] if surface['materialId'] == material)

    def system_amounts():
        return {row['outputId']: row['baseAmount'] for row in call('quantities.inspect')['outputs']
                if row['assignmentId'] == 'system-assignment'}

    try:
        start()
        commands = {entry['name'] for entry in call('commands.list')['commands']}
        assert {'wall.put', 'opening.put', 'header.put', 'construction.inspect', 'construction.render',
                'snippet.render', 'review.inspect', 'preview', 'wall.fromAssembly'} <= commands
        project_path = data / 'detailed.bluewing'
        call('project.create', {'name': 'Detailed native fixture', 'path': str(project_path)})
        before_invalid = inspect()
        invalid_pdf = data / 'invalid.pdf'
        invalid_pdf.write_text('This is not a PDF')
        call('project.import', {'path': str(invalid_pdf)}, True, succeeds=False)
        assert inspect() == before_invalid
        assert database_snapshot(project_path)['assets'] == []
        sheets = call('project.import', {'path': str(ROOT / 'tests/fixtures/assessment-plan.pdf')}, True)
        sheet = sheets[0]['id']
        # 300 page units = 6 m. Physical dimension edits must preserve these points.
        call('sheet.calibrate', {'id': sheet, 'start': {'x': 72, 'y': 144},
                                'end': {'x': 372, 'y': 144}, 'distance': {'value': 6, 'unit': 'm'}}, True)
        geometry = {'id': 'wall-path', 'name': 'Wall W1', 'sheetId': sheet, 'kind': 'path',
                    'points': [{'x': 72, 'y': 144}, {'x': 372, 'y': 144}]}
        call('geometry.put', geometry, True)
        legacy = inspect()
        assert legacy['formatVersion'] == 2
        saved_legacy = database_snapshot(project_path)
        before_backups = set(data.glob('detailed.backup-*.bluewing'))
        member = {'materialId': 'stud-40x90', 'width': 0.04, 'depth': 0.09, 'stockLength': 4}
        wall = {'id': 'wall', 'geometryId': 'wall-path', 'baseElevation': 0, 'height': 3,
                'studSpacing': 0.5, 'stud': member, 'bottomAllowance': 0.02, 'topAllowance': 0.03,
                'track': dict(member, materialId='track-40x90', stockLength=3),
                'finishes': [{'id': 'front', 'materialId': 'front-board', 'face': 'front', 'layers': 2},
                             {'id': 'back', 'materialId': 'back-board', 'face': 'back', 'layers': 1}]}
        call('wall.put', wall, True)
        backups = set(data.glob('detailed.backup-*.bluewing')) - before_backups
        assert len(backups) == 1, backups
        upgrade_backup = backups.pop()
        assert database_snapshot(upgrade_backup) == saved_legacy
        assert inspect()['formatVersion'] == 3
        plain = call('construction.inspect')
        assert plain['complete'] and not plain['diagnostics'], plain['diagnostics']
        studs = [piece for piece in plain['pieces'] if piece['role'] == 'stud']
        assert len(studs) == 13  # endpoints plus eleven interior half-metre stations
        for index, stud in enumerate(studs):
            near(stud['start']['x'], 72 * 0.02 + index * 0.5)
            near(stud['cutLength'], 3 - 0.02 - 0.03)  # explicitly entered end allowances
            assert stud['wallId'] == 'wall' and stud['geometryId'] == 'wall-path'
        near(finish_area(plain, 'front-board'), 36)
        near(finish_area(plain, 'back-board'), 18)
        call('history.undo', mutates=True)
        assert not inspect().get('construction')
        call('history.redo', mutates=True)
        assert call('construction.inspect') == plain

        header = {'id': 'header', 'name': 'Project box header', 'reference': 'S5 detail 7', 'components': []}
        for ident, offset in [('front', 0.05), ('back', -0.05)]:
            header['components'].append({'id': ident, 'role': 'box-face',
                                         'member': dict(member, materialId='header-section'),
                                         'startExtension': 0.1, 'endExtension': 0.2,
                                         'verticalOffset': 0.15, 'faceOffset': offset})
        opening = {'id': 'door', 'wallId': 'wall', 'distance': 1, 'width': 2, 'sill': 0,
                   'height': 2, 'jambCount': 1, 'headerId': 'header'}
        call('batch', {'commands': [{'name': 'header.put', 'payload': header},
                                    {'name': 'opening.put', 'payload': opening}]}, True)
        detailed = call('construction.inspect')
        assert detailed['complete'] and not detailed['diagnostics'], detailed['diagnostics']
        headers = sorted((p for p in detailed['pieces'] if p['role'] == 'box-face'), key=lambda p: p['start']['y'])
        assert len(headers) == 2
        for piece, offset in zip(headers, [-0.05, 0.05]):
            near(piece['cutLength'], 2 + 0.1 + 0.2)
            near(piece['start']['x'], 72 * 0.02 + 1 - 0.1)
            near(piece['end']['x'], 72 * 0.02 + 3 + 0.2)
            near(piece['start']['y'], -144 * 0.02 + offset)
            near(piece['start']['z'], 2.15)
            assert piece['openingId'] == 'door' and piece['geometryId'] == 'wall-path'
        near(sum(p['cutLength'] for p in detailed['pieces'] if p['role'] == 'bottom-track'), 4)
        near(finish_area(detailed, 'front-board'), (6 * 3 - 2 * 2) * 2)
        near(finish_area(detailed, 'back-board'), 6 * 3 - 2 * 2)
        quantities = call('quantities.inspect')
        assert quantities['complete']
        for material, area in [('front-board', 28), ('back-board', 14)]:
            near(sum(row['amount'] for row in quantities['totals'] if row['materialId'] == material), area / 0.09290304)

        # An absent project header is unresolved, never silently treated as complete.
        missing_header = {key: value for key, value in opening.items() if key != 'headerId'}
        call('opening.put', missing_header, True)
        unresolved = call('construction.inspect')
        assert not unresolved['complete']
        assert {item['code'] for item in unresolved['diagnostics']} == {'missing-header'}
        assert not call('quantities.inspect')['complete']
        call('history.undo', mutates=True)
        assert call('construction.inspect') == detailed

        # Preview changes neither accepted memory, revision, SQLite nor undo history.
        before = inspect()
        saved = database_snapshot(project_path)
        taller = dict(wall, height=3.5)
        preview = call('preview', {'commands': [{'name': 'wall.put', 'payload': taller}]}, True)
        assert preview['preview'] and preview['project']['construction']['walls']['wall']['height'] == 3.5
        for material, extra_area in [('front-board', 6), ('back-board', 3)]:
            near(sum(row['delta'] for row in preview['quantityChanges'] if row['materialId'] == material), extra_area / 0.09290304)
        assert inspect() == before and database_snapshot(project_path) == saved
        call('history.undo', mutates=True)
        assert call('construction.inspect') == plain
        call('history.redo', mutates=True)
        assert call('construction.inspect') == detailed

        call('review.mark', {'id': 'checked-wall', 'target': {'kind': 'wall', 'id': 'wall'},
                             'status': 'reviewed', 'note': 'Dimensions checked against S5 detail 7'}, True)
        assert review_status() == 'reviewed'
        call('project.rename', {'name': 'Detailed native renamed'}, True)
        assert review_status() == 'reviewed'
        call('wall.put', taller, True)
        assert review_status() == 'changed'
        near(finish_area(call('construction.inspect'), 'front-board'), 34)
        call('history.undo', mutates=True)
        assert review_status() == 'reviewed' and call('construction.inspect') == detailed
        call('history.redo', mutates=True)
        assert review_status() == 'changed'
        call('history.undo', mutates=True)

        snippet = {'id': 'detail', 'name': 'Wall and header', 'sheetId': sheet,
                   'bounds': {'x': 60, 'y': 120, 'width': 330, 'height': 100},
                   'sources': [{'kind': 'wall', 'id': 'wall'}, {'kind': 'header', 'id': 'header'}],
                   'geometryIds': ['wall-path'], 'annotations': [
                       {'points': [{'x': 100, 'y': 170}, {'x': 200, 'y': 170}],
                        'label': 'S5 detail 7', 'color': '#ff0000'}], 'note': 'Confirm connections'}
        call('snippet.put', snippet, True)
        assert review_status() == 'changed'
        rendered = call('snippet.render', {'id': 'detail', 'path': str(EVIDENCE / 'snippet.png'), 'maxDimension': 660})
        highlighted_pixels = png(rendered)
        assert rendered['sheetId'] == sheet and rendered['snippetId'] == 'detail'
        assert rendered['bounds'] == snippet['bounds'] and rendered['revision'] == revision
        assert (rendered['width'], rendered['height']) == (660, 200)
        for page, pixel in [((60, 120), (0, 0)), ((390, 220), (660, 200)), ((72, 144), (24, 48))]:
            for actual, expected in zip(transform(rendered['pageToPixel'], page), pixel):
                near(actual, expected)
            for actual, expected in zip(transform(rendered['pixelToPage'], pixel), page):
                near(actual, expected)
        call('snippet.put', dict(snippet, geometryIds=[]), True)
        unhighlighted = call('snippet.render', {'id': 'detail', 'path': str(EVIDENCE / 'snippet-unhighlighted.png'), 'maxDimension': 660})
        assert png(unhighlighted) != highlighted_pixels  # only highlighting changed
        call('history.undo', mutates=True)
        assert inspect()['review']['snippets']['detail'] == snippet
        invalid_before = inspect()
        call('snippet.put', dict(snippet, bounds={'x': 0, 'y': 0, 'width': 100000, 'height': 100}), True, succeeds=False)
        assert inspect() == invalid_before

        image = call('construction.render', {'path': str(EVIDENCE / 'construction.png'), 'width': 800, 'height': 500})
        png(image)
        assert (image['width'], image['height']) == (800, 500)
        assert image['displayedObjects'] == len(detailed['pieces']) + len(detailed['surfaces'])
        assert image['omittedObjects'] == 0 and image['diagnostics'] == detailed['diagnostics']
        image = call('construction.render', {'path': str(EVIDENCE / 'headers.png'), 'width': 640, 'height': 400,
                                             'geometryIds': ['wall-path'], 'role': 'box-face'})
        png(image)
        assert image['displayedObjects'] == 2 and image['omittedObjects'] == 0
        # No CLI hit-test metadata exists yet; verify the source records feeding the scene.
        piece_csv = call('construction.export', {'format': 'csv', 'schedule': 'pieces'})
        rows = list(csv.DictReader(io.StringIO(piece_csv)))
        assert len(rows) == len(detailed['pieces'])
        for row in rows:
            piece = next(p for p in detailed['pieces'] if p['id'] == row['pieceId'])
            near(float(row['cutLength_m']), piece['cutLength'])
            assert row['geometryId'] == 'wall-path'
        (EVIDENCE / 'pieces.csv').write_text(piece_csv)
        exported = json.loads(call('construction.export', {'format': 'json'}))
        equivalent(exported['pieces'], detailed['pieces'])
        equivalent(exported['surfaces'], detailed['surfaces'])

        # Systems and positioned wall templates retain independent component snapshots.
        library = call('library.inspect')
        face_a = copy.deepcopy(library['assemblies']['drywall-face'])
        face_b = copy.deepcopy(face_a)
        next(field for field in face_b['inputs'] if field['name'] == 'layers')['default'] = 2
        system = {'id': 'global-system', 'name': 'Two independent faces', 'geometryKinds': ['path'],
                  'inputs': [{'name': 'height', 'type': 'number', 'unit': 'mm', 'minimum': 1}], 'outputs': [],
                  'components': [{'id': 'face-a', 'assembly': face_a, 'bindings': {'height': 'height'}},
                                 {'id': 'face-b', 'assembly': face_b, 'bindings': {'height': 'height'}}]}
        template = {'id': 'global-wall', 'name': 'Reusable positioned wall', 'geometryKinds': ['path'],
                    'inputs': [], 'outputs': [], 'wallTemplate': {key: copy.deepcopy(value) for key, value in wall.items()
                                                               if key not in ('id', 'geometryId')}}
        for assembly in [system, template]:
            library = call('library.put', {'assembly': assembly, 'expectedLibraryRevision': library['revision']})
            call('assembly.import', {'libraryId': assembly['id'], 'id': 'local-' + assembly['id']}, True)
        call('geometry.put', dict(geometry, id='formula-path', name='Formula wall',
                                  points=[{'x': 72, 'y': 260}, {'x': 372, 'y': 260}]), True)
        call('group.put', {'id': 'formula-group', 'name': 'Formula only', 'geometryIds': ['formula-path']}, True)
        call('assignment.put', {'id': 'system-assignment', 'groupId': 'formula-group', 'recipeId': 'local-global-system',
                                'inputs': {'height': 3000}, 'allowances': {}}, True)
        amounts = system_amounts()
        near(amounts['face-a/board-area'], 18 / 0.09290304)
        near(amounts['face-b/board-area'], 36 / 0.09290304)
        call('geometry.put', dict(geometry, id='template-path', name='Template instance',
                                  points=[{'x': 72, 'y': 300}, {'x': 372, 'y': 300}]), True)
        call('wall.fromAssembly', {'assemblyId': 'local-global-wall', 'geometryId': 'template-path', 'id': 'template-wall'}, True)
        instance = inspect()['construction']['walls']['template-wall']
        assert instance['height'] == 3 and instance['finishes'] == wall['finishes']
        local_system = copy.deepcopy(inspect()['recipes']['local-global-system'])
        local_template = copy.deepcopy(inspect()['recipes']['local-global-wall'])
        template['wallTemplate']['height'] = 4
        next(field for field in system['components'][0]['assembly']['inputs'] if field['name'] == 'layers')['default'] = 5
        for assembly in [system, template]:
            library = call('library.put', {'assembly': assembly, 'expectedLibraryRevision': library['revision']})
        assert inspect()['recipes']['local-global-system'] == local_system
        assert inspect()['recipes']['local-global-wall'] == local_template
        assert system_amounts() == amounts
        local_template['wallTemplate']['height'] = 5
        call('assembly.put', local_template, True)
        assert inspect()['construction']['walls']['template-wall'] == instance
        local_system['components'][0]['assembly']['outputs'][0]['formula'] = 'length * height * 3'
        call('assembly.put', local_system, True)
        near(system_amounts()['face-a/board-area'], 54 / 0.09290304)
        near(system_amounts()['face-b/board-area'], 36 / 0.09290304)
        call('history.undo', mutates=True)
        assert system_amounts() == amounts

        final_project = inspect()
        final_construction = call('construction.inspect')
        final_pieces = call('pieces.inspect')
        final_quantities = call('quantities.inspect')
        final_review = call('review.inspect')
        assert final_project['geometries']['wall-path'] == geometry
        recovery = call('project.backup', {'path': str(data / 'explicit-recovery.bluewing')})
        assert database_snapshot(Path(recovery['path'])) == database_snapshot(project_path)
        call('project.backup', {'path': recovery['path']}, succeeds=False)
        call('project.close', mutates=True)
        stop()
        start()
        assert call('library.inspect') == library
        call('project.create', {'name': 'Independent library consumer', 'path': str(data / 'second.bluewing')})
        new_system = call('assembly.import', {'libraryId': 'global-system', 'id': 'new-system'}, True)
        new_template = call('assembly.import', {'libraryId': 'global-wall', 'id': 'new-wall'}, True)
        assert next(field for field in new_system['components'][0]['assembly']['inputs'] if field['name'] == 'layers')['default'] == 5
        assert new_template['wallTemplate']['height'] == 4
        for ident in ['global-system', 'global-wall']:
            library = call('library.delete', {'id': ident, 'expectedLibraryRevision': library['revision']})
        assert inspect()['recipes']['new-system'] == new_system
        assert inspect()['recipes']['new-wall'] == new_template
        call('project.close', mutates=True)
        call('project.open', {'path': str(project_path)})
        assert inspect() == final_project
        assert call('construction.inspect') == final_construction
        assert call('pieces.inspect') == final_pieces
        assert call('quantities.inspect') == final_quantities
        assert call('review.inspect') == final_review
        call('project.close', mutates=True)
        call('project.open', {'path': str(upgrade_backup)})
        assert inspect() == legacy
        call('project.close', mutates=True)
        assert database_snapshot(upgrade_backup) == saved_legacy
        (EVIDENCE / 'construction.json').write_text(json.dumps(final_construction, indent=2))

        large_plan = os.environ.get('BLUEWING_TEST_DETAILED_PLAN')
        if large_plan:
            plan_path = Path(large_plan).expanduser().resolve()
            assert plan_path.is_file(), plan_path
            call('project.create', {'name': 'Optional large plan', 'path': str(data / 'large.bluewing')})
            started = time.monotonic()
            imported = call('project.import', {'path': str(plan_path)}, True, timeout=600)
            import_seconds = time.monotonic() - started
            assert imported and len(inspect()['sheets']) == len(imported)
            pages = sorted({0, len(imported) // 2, len(imported) - 1})
            for index in pages:
                rendered = call('sheet.render', {'sheetId': imported[index]['id'],
                                                 'path': str(EVIDENCE / f'large-page-{index + 1}.png'),
                                                 'maxDimension': 1024, 'mode': 'plan'}, timeout=180)
                png(rendered)
                assert max(rendered['width'], rendered['height']) <= 1024
            call('project.close', mutates=True)
            call('project.open', {'path': str(data / 'large.bluewing')})
            reopened = call('sheet.render', {'sheetId': imported[-1]['id'], 'path': str(EVIDENCE / 'large-reopened.png'), 'maxDimension': 1024, 'mode': 'plan'}, timeout=180)
            assert png(reopened) == png(rendered)
            call('project.close', mutates=True)
            (EVIDENCE / 'large-plan.json').write_text(json.dumps({'bytes': plan_path.stat().st_size,
                                                               'sheets': len(imported), 'renderedPages': pages, 'importSeconds': import_seconds, 'reopenedRenderMatches': True}, indent=2))
    finally:
        (EVIDENCE / 'commands.json').write_text(json.dumps(transcript, indent=2))
        stop()
        log.close()
print('PASS: native detailed pieces, finishes, preview, undo/redo, PNGs, snippets, review, systems/templates, restart and upgrade backup')
print('Source picking is not exposed by construction.render; positioned source IDs and filtered scene counts were checked.')
print('Large-plan import/render: ' + ('PASS' if os.environ.get('BLUEWING_TEST_DETAILED_PLAN') else 'SKIPPED (BLUEWING_TEST_DETAILED_PLAN unset)'))
