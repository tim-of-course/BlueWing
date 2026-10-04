import {
  buildConstructionScene,
  fitCamera,
  type ConstructionScene,
  type SceneCamera,
  type SceneMember,
  type SceneSurface,
} from '../../src/three/scene';
import {
  acquireConstructionSnapshot,
  createConstructionRenderer,
} from '../../src/three/renderer';
import { captureViewport } from '../../src/platform/capture';

const width = 600;
const height = 600;
const canvas = document.querySelector('canvas');
if (!canvas) throw new Error('Rendering fixture canvas is missing.');
const target = canvas;
const camera: SceneCamera = {
  yaw: 0,
  pitch: 0.55,
  zoom: 1,
  target: { x: 0, y: 0, z: 5 },
  span: 12,
};
const stud: SceneMember = {
  id: 'tall-stud',
  geometryId: 'wall-trace',
  wallId: 'wall',
  materialId: 'steel-stud',
  role: 'stud',
  start: { x: 0, y: 0, z: 0 },
  end: { x: 0, y: 0, z: 10 },
  widthAxis: { x: 0, y: 1, z: 0 },
  width: 0.5,
  depth: 0.5,
};
const tee: SceneMember = {
  id: 'ceiling-tee',
  geometryId: 'ceiling-trace',
  materialId: 'ceiling-grid',
  role: 'cross-tee',
  start: { x: -0.6, y: -2, z: 7 },
  end: { x: -0.6, y: 2, z: 7 },
  width: 0.2,
  depth: 0.2,
};
const empty = buildConstructionScene({ members: [], surfaces: [] });
const makeScene = (members: SceneMember[], surfaces: SceneSurface[] = []) =>
  buildConstructionScene({ members, surfaces });
const options = (view: SceneCamera, displayMode = 'solid' as const) => ({
  width,
  height,
  pixelRatio: 1,
  camera: view,
  displayMode,
});

function pixels(source: HTMLCanvasElement) {
  const copy = document.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  const context = copy.getContext('2d');
  if (!context) throw new Error('Pixel readback context is unavailable.');
  context.drawImage(source, 0, 0);
  return context.getImageData(0, 0, copy.width, copy.height).data;
}
function difference(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  offset: number,
) {
  let maximum = 0;
  for (let channel = 0; channel < 4; channel++)
    maximum = Math.max(
      maximum,
      Math.abs((a[offset + channel] ?? 0) - (b[offset + channel] ?? 0)),
    );
  return maximum;
}
function uniformAround(image: Uint8ClampedArray, x: number, y: number) {
  const at = (y * width + x) * 4;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const neighbor = ((y + dy) * width + x + dx) * 4;
      for (let channel = 0; channel < 4; channel++)
        if (image[at + channel] !== image[neighbor + channel]) return false;
    }
  return true;
}

function crossing() {
  const renderer = createConstructionRenderer(target);
  const snapshot = acquireConstructionSnapshot();
  const cases = [];
  try {
    for (const yaw of [0, Math.PI]) {
      const view = { ...camera, yaw };
      const settings = options(view);
      const capture = (scene: ConstructionScene) => {
        renderer.render(scene, settings);
        return pixels(target);
      };
      const background = capture(empty);
      const studPixels = capture(makeScene([stud]));
      const teePixels = capture(makeScene([tee]));
      const scene = makeScene([stud, tee]);
      const composite = capture(scene);
      const expected = yaw === 0 ? studPixels : teePixels;
      let overlapPixels = 0;
      let wrongPixels = 0;
      let sampledPoint: { x: number; y: number } | null = null;
      // Compare only fully covered, flat interior pixels. Edge antialiasing is
      // device-dependent; which opaque member is in front is not.
      for (let y = 2; y < height - 2; y++) {
        for (let x = 2; x < width - 2; x++) {
          const offset = (y * width + x) * 4;
          if (
            difference(studPixels, background, offset) < 15 ||
            difference(teePixels, background, offset) < 15 ||
            difference(studPixels, teePixels, offset) < 15 ||
            !uniformAround(studPixels, x, y) ||
            !uniformAround(teePixels, x, y)
          )
            continue;
          overlapPixels++;
          if (difference(composite, expected, offset) > 2) wrongPixels++;
          sampledPoint ??= { x, y };
        }
      }
      const picked = sampledPoint
        ? renderer.pick(sampledPoint.x + 0.5, sampledPoint.y + 0.5)
        : null;
      const exported = document.createElement('canvas');
      snapshot.render(exported, scene, settings);
      const snapshotPixels = pixels(exported);
      let snapshotMismatches = 0;
      for (let offset = 0; offset < composite.length; offset += 4)
        if (difference(composite, snapshotPixels, offset) > 2)
          snapshotMismatches++;
      cases.push({
        yaw,
        overlapPixels,
        wrongPixels,
        picked,
        snapshotMismatches,
        snapshotWidth: exported.width,
        snapshotHeight: exported.height,
      });
    }
    return cases;
  } finally {
    snapshot.dispose();
    renderer.dispose();
  }
}

function finishes() {
  const renderer = createConstructionRenderer(target);
  const view: SceneCamera = {
    yaw: 0,
    pitch: 0,
    zoom: 1,
    span: 6,
    target: { x: 0, y: 0, z: 2 },
  };
  const finish: SceneSurface = {
    id: 'concave-finish',
    geometryId: 'wall-trace',
    materialId: 'gypsum',
    role: 'finish',
    thickness: 0.1,
    points: [
      { x: 1, y: -2, z: 0 },
      { x: 1, y: 2, z: 0 },
      { x: 1, y: 2, z: 4 },
      { x: 1, y: 0.7, z: 4 },
      { x: 1, y: 0.7, z: 2 },
      { x: 1, y: -0.7, z: 2 },
      { x: 1, y: -0.7, z: 4 },
      { x: 1, y: -2, z: 4 },
    ],
  };
  const behind = { ...stud, end: { x: 0, y: 0, z: 4 } };
  const at = (x: number, y: number) => (y * width + x) * 4;
  try {
    renderer.render(empty, options(view));
    const background = pixels(target);
    renderer.render(makeScene([], [finish]), options(view));
    const surfacePixels = pixels(target);
    const concave = {
      notchDifference: difference(surfacePixels, background, at(300, 200)),
      armDifference: difference(surfacePixels, background, at(450, 200)),
      notchPick: renderer.pick(300, 200),
      armPick: renderer.pick(450, 200),
    };
    renderer.render(makeScene([behind]), options(view));
    const studPixels = pixels(target);
    const scene = makeScene([behind], [finish]);
    const modes = [];
    for (const displayMode of ['solid', 'framing', 'xray'] as const) {
      renderer.render(scene, { ...options(view), displayMode });
      const image = pixels(target);
      modes.push({
        displayMode,
        lowerPick: renderer.pick(300, 400),
        notchPick: renderer.pick(300, 200),
        lowerDifferenceFromStud: difference(image, studPixels, at(300, 400)),
        lowerDifferenceFromSurface: difference(
          image,
          surfacePixels,
          at(300, 400),
        ),
      });
    }
    return { concave, modes };
  } finally {
    renderer.dispose();
  }
}

function batching() {
  const renderer = createConstructionRenderer(target);
  const members = Array.from({ length: 6_000 }, (_, index) => ({
    ...stud,
    id: `stud-${String(index)}`,
    start: { x: index % 75, y: Math.floor(index / 75), z: 0 },
    end: { x: index % 75, y: Math.floor(index / 75), z: 3 },
  }));
  const large = makeScene(members);
  const small = makeScene(members.slice(0, 100));
  try {
    renderer.render(small, options(fitCamera(small, camera)));
    const baseline = renderer.info();
    renderer.render(large, options(fitCamera(large, camera)));
    const full = renderer.info();
    const replacements = [];
    for (let index = 0; index < 4; index++) {
      renderer.render(small, options(fitCamera(small, camera)));
      replacements.push(renderer.info());
      renderer.render(large, options(fitCamera(large, camera)));
      replacements.push(renderer.info());
    }
    renderer.render(large, {
      ...options(fitCamera(large, camera)),
      width: 320,
      height: 240,
      pixelRatio: 2,
    });
    const highResolution = renderer.info();
    renderer.dispose();
    return {
      sceneCount: large.count,
      omitted: large.omitted,
      baseline,
      full,
      replacements,
      highResolution,
      disposed: renderer.info(),
    };
  } catch (error) {
    renderer.dispose();
    throw error;
  }
}

async function screenshotCapture() {
  const renderer = createConstructionRenderer(target);
  const settings = options(camera);
  try {
    renderer.render(empty, settings);
    const background = pixels(target);
    renderer.render(makeScene([stud, tee]), settings);
    const expected = pixels(target);

    // Let the browser present and discard the default WebGL drawing buffer.
    // Screenshot capture must redraw when cloning, not rely on a recent frame.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        resolve();
      }),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        resolve();
      }),
    );
    const bounds = target.getBoundingClientRect();
    const captured = await captureViewport();
    const copy = document.createElement('canvas');
    copy.width = width;
    copy.height = height;
    const context = copy.getContext('2d');
    if (!context)
      throw new Error('Screenshot comparison context is unavailable.');
    const scaleX = captured.canvas.width / captured.width;
    const scaleY = captured.canvas.height / captured.height;
    context.drawImage(
      captured.canvas,
      bounds.left * scaleX,
      bounds.top * scaleY,
      bounds.width * scaleX,
      bounds.height * scaleY,
      0,
      0,
      width,
      height,
    );
    const actual = context.getImageData(0, 0, width, height).data;
    let checkedPixels = 0;
    let wrongPixels = 0;
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        const offset = (y * width + x) * 4;
        if (
          difference(expected, background, offset) < 15 ||
          !uniformAround(expected, x, y)
        )
          continue;
        checkedPixels++;
        if (difference(actual, expected, offset) > 3) wrongPixels++;
      }
    }
    return {
      checkedPixels,
      wrongPixels,
      image: captured.canvas.toDataURL('image/png'),
    };
  } finally {
    renderer.dispose();
  }
}

Object.assign(window, {
  constructionRendering: { crossing, finishes, batching, screenshotCapture },
});
export type ConstructionRenderingHarness = {
  crossing: typeof crossing;
  finishes: typeof finishes;
  batching: typeof batching;
  screenshotCapture: typeof screenshotCapture;
};
