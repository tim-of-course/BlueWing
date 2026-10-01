"""Real desktop/CLI Wingman workflow. Build web assets and native bins separately.

Run: python3 tests/desktop/wingman.py (enters the shared resource guard).
UI screenshot selection, pause/resume and view swapping are browser-test scope.
"""
import base64
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tests'))
from resource_guard import ensure_resource_guard
ensure_resource_guard()
BIN = Path(os.environ.get('BLUEWING_NATIVE_BIN_DIR', ROOT / 'src-tauri/target/debug'))
SUFFIX = '.exe' if os.name == 'nt' else ''
EVIDENCE = ROOT / 'tmp/wingman-workflow'
EVIDENCE.mkdir(parents=True, exist_ok=True)


def png(metadata):
    content = Path(metadata['path']).read_bytes()
    assert content[:8] == b'\x89PNG\r\n\x1a\n'
    assert struct.unpack('>II', content[16:24]) == (metadata['width'], metadata['height'])
    return content


with tempfile.TemporaryDirectory(prefix='bluewing-wingman-') as temporary:
    data = Path(temporary)
    env = dict(os.environ, BLUEWING_DATA_DIR=temporary)
    shutil.copytree(ROOT / 'dist', data / 'web/wingman-test')
    (data / 'web/active').write_text('wingman-test')
    log = open(EVIDENCE / 'native.log', 'w')
    desktop = pending = None
    project_id = revision = None
    transcript = []

    def argv(name):
        return [str(BIN / ('bluewing' + SUFFIX)), name, '--stdin']

    def start():
        global desktop
        desktop = subprocess.Popen([str(BIN / ('bluewing-desktop' + SUFFIX))],
                                   env=env, stdout=log, stderr=log)
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            probe = subprocess.run(argv('commands.list'), input='{}', capture_output=True,
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

    def response(name, request, code, stdout, stderr, succeeds=True):
        global project_id, revision
        entry = {'command': name, 'request': request, 'exit': code, 'stderr': stderr}
        transcript.append(entry)
        try:
            result = json.loads(stdout)
        except json.JSONDecodeError:
            entry['stdout'] = stdout
            raise AssertionError(entry) from None
        entry['response'] = result
        assert 'messagesProjectId' in result and isinstance(result.get('messages'), list), entry
        if succeeds:
            assert code == 0 and result.get('ok'), entry
            project_id, revision = result.get('projectId'), result.get('revision')
        else:
            assert code != 0 and not result.get('ok'), entry
        return result

    def call(name, payload=None, mutates=False, succeeds=True, timeout=90, **envelope):
        request = {'payload': payload or {}}
        if mutates:
            request.update(projectId=project_id, expectedRevision=revision)
        request.update(envelope)
        result = subprocess.run(argv(name), input=json.dumps(request), capture_output=True,
                                text=True, env=env, timeout=timeout)
        return response(name, request, result.returncode, result.stdout, result.stderr, succeeds)

    def command(name, payload=None, mutates=False, **options):
        return call(name, payload, mutates, **options)['data']

    def visual(kind, caption):
        state = command('wingman.inspect')
        agent = state['agent']
        assert agent['projectId'] == project_id and agent['revision'] == revision, state
        assert agent['caption'] == caption and agent['view']['kind'] == kind, state
        return agent['view']

    def attachment(message, expected):
        assert len(message['attachments']) == 1, message
        exported = message['attachments'][0]
        assert exported['id'] == 'plan-capture' and exported['name'] == 'plan.png'
        assert (exported['width'], exported['height']) == (sheet_image['width'], sheet_image['height'])
        assert 'dataUrl' not in exported and Path(exported['path']).is_absolute()
        assert Path(exported['path']).read_bytes() == expected

    try:
        start()
        commands = {entry['name'] for entry in command('commands.list')['commands']}
        assert {'help', 'connect', 'messages.send', 'messages.read', 'messages.wait', 'wingman.inspect', 'wingman.flash',
                'wingman.annotate', 'sheet.render', 'snippet.render', 'construction.render'} <= commands
        assert command('help')['project'] is None
        assert command('help', {'command': 'messages.wait'})['name'] == 'messages.wait'
        call('help', {'command': 'does.not.exist'}, succeeds=False)
        project_path = data / 'wingman.bluewing'
        command('project.create', {'name': 'Wingman native fixture', 'path': str(project_path)})
        connected = command('connect', {'mode': 'wingman'}, projectId=project_id)
        assert connected['project']['id'] == project_id
        assert 'messages.send' in connected['instructions'] and 'messages.wait' in connected['instructions']
        assert 'external chat' in command('connect', {'mode': 'chat'})['instructions']
        call('connect', {'mode': 'wingman'}, projectId='wrong-project', succeeds=False)
        sheets = command('project.import', {'path': str(ROOT / 'tests/fixtures/assessment-plan.pdf')}, True)
        sheet = sheets[0]['id']
        command('sheet.calibrate', {'id': sheet, 'start': {'x': 72, 'y': 144},
                                   'end': {'x': 372, 'y': 144}, 'distance': {'value': 6, 'unit': 'm'}}, True)
        command('geometry.put', {'id': 'wall-path', 'name': 'Wingman wall', 'sheetId': sheet,
                                 'kind': 'path', 'points': [{'x': 72, 'y': 144}, {'x': 372, 'y': 144}]}, True)
        member = {'materialId': 'stud', 'width': 0.04, 'depth': 0.09, 'stockLength': 4}
        command('wall.put', {'id': 'wall', 'geometryId': 'wall-path', 'baseElevation': 0,
                            'height': 3, 'studSpacing': 0.5, 'stud': member,
                            'bottomAllowance': 0, 'topAllowance': 0,
                            'track': dict(member, materialId='track'), 'finishes': []}, True)
        bounds = {'x': 60, 'y': 120, 'width': 330, 'height': 100}
        annotations = [{'points': [{'x': 100, 'y': 170}, {'x': 200, 'y': 170}],
                        'label': 'Check wall', 'color': '#ff8800'}]
        command('snippet.put', {'id': 'detail', 'name': 'Wall detail', 'sheetId': sheet,
                               'bounds': bounds, 'sources': [{'kind': 'wall', 'id': 'wall'}],
                               'geometryIds': ['wall-path'], 'annotations': annotations, 'note': ''}, True)
        baseline = command('project.inspect')
        sheet_image = command('sheet.render', {'sheetId': sheet, 'path': str(EVIDENCE / 'sheet.png'),
                                              'maxDimension': 640, 'mode': 'combined', 'caption': 'Plan review'})
        image_bytes = png(sheet_image)
        view = visual('plan', 'Plan review')
        assert view['sheetId'] == sheet and view['bounds'] == sheet_image['bounds']
        assert view['mode'] == 'combined'
        assert command('wingman.flash') == {'flashed': True}
        assert command('wingman.inspect')['expanded'] is True
        assert command('wingman.annotate', {'annotations': annotations, 'highlightIds': ['wall-path']}) == {'annotated': True}
        view = visual('plan', 'Plan review')
        assert view['annotations'] == annotations and view['highlightIds'] == ['wall-path']
        command('wingman.annotate', {'annotations': [], 'highlightIds': []})
        assert visual('plan', 'Plan review')['annotations'] == []
        snippet_image = command('snippet.render', {'id': 'detail', 'path': str(EVIDENCE / 'snippet.png'),
                                                  'maxDimension': 640, 'caption': 'Detail review'})
        png(snippet_image)
        view = visual('plan', 'Detail review')
        assert view['sheetId'] == sheet and view['bounds'] == bounds
        assert view['annotations'] == annotations and view['highlightIds'] == ['wall-path']
        model_image = command('construction.render', {'path': str(EVIDENCE / 'model.png'),
                                                      'width': 640, 'height': 400, 'caption': 'Framing review',
                                                      'geometryIds': ['wall-path'], 'role': 'stud',
                                                      'azimuth': 0.5, 'elevation': 0.4})
        png(model_image)
        assert model_image['displayedObjects'] > 0 and model_image['omittedObjects'] == 0
        view = visual('3d', 'Framing review')
        assert view['geometryIds'] == ['wall-path'] and view['role'] == 'stud'
        assert view['camera']['yaw'] == 0.5 and view['camera']['pitch'] == 0.4
        assert command('project.inspect') == baseline

        sent = call('messages.send', {'text': 'Please check this plan', 'attachments': [{
            'id': 'plan-capture', 'name': 'plan.png', 'width': sheet_image['width'],
            'height': sheet_image['height'],
            'dataUrl': 'data:image/png;base64,' + base64.b64encode(image_bytes).decode('ascii'),
        }]}, projectId=project_id)
        first = sent['data']
        assert first['sender'] == 'agent' and first['text'] == 'Please check this plan'
        attachment(first, image_bytes)
        assert sent['messagesProjectId'] == project_id and sent['messages'] == [first]
        assert command('messages.read', {'after': 0}) == [first]
        assert command('messages.read', {'after': 0}) == [first]  # nondestructive
        cursor = first['id']
        assert command('messages.read', messagesAfter=cursor) == []
        assert call('project.inspect', messagesAfter=cursor)['messages'] == []
        failed = call('wingman.annotate', {'annotations': annotations}, succeeds=False)
        assert failed['messages'] == [first] and failed['messagesProjectId'] == project_id
        assert call('wingman.annotate', {'annotations': annotations}, succeeds=False,
                    messagesAfter=cursor)['messages'] == []

        # A waiting read must not occupy the desktop's project command queue.
        waiting_request = {'projectId': project_id, 'messagesAfter': cursor,
                           'payload': {'waitMs': 25000}}
        pending = subprocess.Popen(argv('messages.read'), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, env=env)
        pending.stdin.write(json.dumps(waiting_request))
        pending.stdin.close()
        pending.stdin = None
        time.sleep(0.5)
        assert pending.poll() is None, 'Read did not remain pending'
        assert command('project.inspect', timeout=10) == baseline
        command('wingman.flash', timeout=10)
        assert pending.poll() is None, 'Unrelated commands ended the waiting read'
        second_response = call('messages.send', {'text': 'The wall is ready to review'},
                               messagesAfter=cursor, timeout=10)
        second = second_response['data']
        assert second['id'] > cursor and second_response['messages'] == [second]
        stdout, stderr = pending.communicate(timeout=10)
        delivered = response('messages.read', waiting_request, pending.returncode, stdout, stderr)
        assert delivered['data'] == [second] and delivered['messages'] == [second]
        assert delivered['messagesProjectId'] == project_id
        assert command('messages.read', {'after': cursor}) == [second]
        assert command('messages.read', {'after': second['id'], 'waitMs': 100}) == []
        # The native convenience command renews after 25 seconds without
        # emitting intermediate output or returning on its own agent messages.
        waiting_request = {'projectId': project_id, 'messagesAfter': second['id'],
                           'payload': {'timeoutMs': 27000}}
        began = time.monotonic()
        pending = subprocess.Popen(argv('messages.wait'), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, env=env)
        pending.stdin.write(json.dumps(waiting_request))
        pending.stdin.close()
        pending.stdin = None
        assert command('project.inspect', timeout=10) == baseline
        stdout, stderr = pending.communicate(timeout=40)
        waited = response('messages.wait', waiting_request, pending.returncode, stdout, stderr)
        assert time.monotonic() - began >= 26
        assert waited['data']['status'] == 'timeout' and waited['data']['messages'] == []
        assert waited['data']['projectId'] == project_id
        wait_token = waited['data']['waitToken']
        assert command('messages.wait', {'after': second['id'], 'timeoutMs': 0})['status'] == 'timeout'
        call('messages.wait', {'timeoutMs': 1.5}, succeeds=False)
        history = [first, second]
        assert command('project.inspect') == baseline
        # Undo still targets the last estimate edit, not chat or presentation.
        command('history.undo', mutates=True)
        assert 'detail' not in command('project.inspect').get('review', {}).get('snippets', {})
        assert command('messages.read') == history
        command('history.redo', mutates=True)
        saved = command('project.inspect')
        original_id = project_id
        waiting_request = {'projectId': project_id, 'messagesAfter': second['id'],
                           'payload': {'timeoutMs': 300000}}
        pending = subprocess.Popen(argv('messages.wait'), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, env=env)
        pending.stdin.write(json.dumps(waiting_request))
        pending.stdin.close()
        pending.stdin = None
        time.sleep(0.5)
        assert pending.poll() is None
        command('project.close', mutates=True)
        stdout, stderr = pending.communicate(timeout=10)
        changed = response('messages.wait', waiting_request, pending.returncode, stdout, stderr)
        assert changed['data']['status'] == 'project_changed'
        assert changed['messages'] == [] and changed['messagesProjectId'] == original_id
        stop()
        start()
        command('project.open', {'path': str(project_path)})
        assert project_id == original_id and command('project.inspect') == saved
        assert command('messages.wait', {'after': second['id'], 'timeoutMs': 0,
                                         'waitToken': wait_token})['status'] == 'ended'
        reopened = call('messages.read')
        assert reopened['data'] == history and reopened['messages'] == history
        attachment(reopened['data'][0], image_bytes)
        assert command('messages.read', messagesAfter=second['id']) == []

        # A cursor from a different project must not suppress this conversation.
        command('project.close', mutates=True)
        command('project.create', {'name': 'Other conversation', 'path': str(data / 'other.bluewing')})
        other_id = project_id
        assert command('messages.read') == []
        command('project.close', mutates=True)
        opened = call('project.open', {'path': str(project_path)}, projectId=other_id,
                      messagesAfter=second['id'])
        assert opened['messagesProjectId'] == original_id and opened['messages'] == history
        mismatch = call('messages.send', {'text': 'Wrong project'}, projectId=other_id,
                        messagesAfter=second['id'], succeeds=False)
        assert mismatch['messages'] == history and mismatch['messagesProjectId'] == original_id
        assert command('messages.read') == history
    finally:
        if pending is not None and pending.poll() is None:
            pending.kill()
            pending.communicate(timeout=10)
        (EVIDENCE / 'commands.json').write_text(json.dumps(transcript, indent=2))
        stop()
        log.close()

print('PASS: native Wingman discovery, wait renewal, publication, flash, annotations, messages/cursors, attachments, concurrent read and reopen')
print('Not exercised here: UI screenshot selection, pause/resume and view swapping (host browser-test scope).')
print('Attachment transport uses a real rendered PNG; this workflow does not capture desktop UI pixels.')
