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
import { paintTakeoff } from '../../src/components/canvas/paint';

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
  color: '#0077CC',
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
  color: '#D18A00',
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

async function planPlane() {
  const renderer = createConstructionRenderer(target);
  const source = document.createElement('canvas');
  source.width = source.height = 4;
  const context = source.getContext('2d');
  if (!context) throw new Error('Plan fixture context is unavailable.');
  for (const [x, y, color] of [
    [0, 0, '#ff0000'],
    [2, 0, '#00ff00'],
    [0, 2, '#0000ff'],
    [2, 2, '#ffff00'],
  ] as const) {
    context.fillStyle = color;
    context.fillRect(x, y, 2, 2);
  }
  const original = await createImageBitmap(source);
  const image = await createImageBitmap(original, {
    imageOrientation: 'flipY',
  });
  original.close();
  const view: SceneCamera = {
    yaw: -Math.PI / 2,
    pitch: Math.PI / 2,
    zoom: 1,
    target: { x: 0, y: 0, z: 0 },
    span: 6,
  };
  const scene = makeScene([stud]);
  const corners = [
    { x: -2, y: 2, z: -0.001 },
    { x: 2, y: 2, z: -0.001 },
    { x: 2, y: -2, z: -0.001 },
    { x: -2, y: -2, z: -0.001 },
  ] as const;
  try {
    renderer.render(scene, options(view));
    const baseline = renderer.info();
    renderer.render(scene, { ...options(view), plan: { image, corners } });
    const data = pixels(target);
    const colorAt = (x: number, y: number) =>
      Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 3));
    const withPlan = renderer.info();
    const picked = renderer.pick(300, 300);
    renderer.render(scene, options(view));
    const removed = renderer.info();
    return {
      colors: [
        colorAt(200, 200),
        colorAt(400, 200),
        colorAt(200, 400),
        colorAt(400, 400),
      ],
      picked,
      baseline,
      withPlan,
      removed,
    };
  } finally {
    renderer.dispose();
    image.close();
  }
}

let navigationCamera = camera;
let navigationRenderer:
  ReturnType<typeof createConstructionRenderer> | undefined;
function setupNavigation() {
  navigationCamera = camera;
  navigationRenderer?.dispose();
  navigationRenderer = createConstructionRenderer(target, {
    onCameraChange(next) {
      navigationCamera = next;
    },
    onSelect() {},
  });
  navigationRenderer.render(makeScene([stud]), options(camera));
}
function readNavigation() {
  return navigationCamera;
}

function categoryStrokes(
  zoom: number,
  colors: string[],
  draftStyle?: 'solid' | 'dashed',
) {
  const canvas = document.createElement('canvas');
  canvas.width = 240;
  canvas.height = 100;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.scale(zoom, zoom);
  if (draftStyle === 'dashed') context.setLineDash([2 / zoom, 8 / zoom]);
  paintTakeoff(
    context,
    [
      {
        id: 'wall',
        name: '',
        sheetId: 'sheet',
        kind: 'path',
        points: [
          { x: 20 / zoom, y: 50 / zoom },
          { x: 220 / zoom, y: 50 / zoom },
        ],
      },
    ],
    {
      ...(draftStyle
        ? { colors: { wall: colors[0] ?? '#0077CC' } }
        : { categoryColors: { wall: colors } }),
      unitsPerPixel: 1 / zoom,
    },
  );
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let blue = 0,
    magenta = 0,
    hatch = 0,
    pale = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i] ?? 255,
      g = pixels[i + 1] ?? 255,
      b = pixels[i + 2] ?? 255;
    if (b > r * 1.3 && b > g * 1.2 && r < 100) blue++;
    if (r > g * 1.8 && b > g * 1.5 && r > 100) magenta++;
    if (b > r && r < 170 && g < 190) hatch++;
    if (b > r && r >= 170 && r < 245) pale++;
  }
  return { blue, magenta, hatch, pale };
}

function categoryDeductionStrokes(
  zoom: number,
  kind: 'path' | 'area' | 'count',
  selected: boolean,
  uncategorized = false,
) {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 120;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.scale(zoom, zoom);
  const points =
    kind === 'count'
      ? [{ x: 110, y: 60 }]
      : kind === 'area'
        ? [
            { x: 20, y: 20 },
            { x: 200, y: 20 },
            { x: 200, y: 100 },
            { x: 20, y: 100 },
          ]
        : [
            { x: 20, y: 50 },
            { x: 200, y: 50 },
          ];
  paintTakeoff(
    context,
    ['deduction', 'positive'].map((id, index) => ({
      id,
      name: id,
      sheetId: 'sheet',
      kind,
      points: points.map((point) => ({
        x: (point.x + 240 * index) / zoom,
        y: point.y / zoom,
      })),
    })),
    {
      categoryColors: {
        deduction: uncategorized ? [] : ['#0077CC', '#C023A0'],
        positive: uncategorized ? [] : ['#0077CC', '#C023A0'],
      },
      selectedIds: selected ? ['deduction', 'positive'] : [],
      deductionIds: ['deduction'],
      unitsPerPixel: 1 / zoom,
    },
  );
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const sides = [
    { blue: 0, magenta: 0, red: 0, ink: 0 },
    { blue: 0, magenta: 0, red: 0, ink: 0 },
  ];
  for (let y = 0; y < canvas.height; y++)
    for (let x = 0; x < canvas.width; x++) {
      const side = sides[x < 240 ? 0 : 1];
      if (!side) throw new Error('Missing pixel region');
      const i = (y * canvas.width + x) * 4;
      const r = pixels[i] ?? 255,
        g = pixels[i + 1] ?? 255,
        b = pixels[i + 2] ?? 255;
      if (r < 20 && g > 80 && g < 160 && b > 150) side.blue++;
      if (r > 130 && g < 80 && b > 100) side.magenta++;
      if (r > 150 && g < 100 && b < 100) side.red++;
      if (r < 245 || g < 245 || b < 245) side.ink++;
    }
  return { deduction: sides[0], positive: sides[1] };
}

Object.assign(window, {
  constructionRendering: {
    setupNavigation,
    readNavigation,
    crossing,
    finishes,
    batching,
    screenshotCapture,
    planPlane,
    categoryStrokes,
    categoryDeductionStrokes,
  },
});
export type ConstructionRenderingHarness = {
  setupNavigation: typeof setupNavigation;
  readNavigation: typeof readNavigation;
  crossing: typeof crossing;
  finishes: typeof finishes;
  batching: typeof batching;
  screenshotCapture: typeof screenshotCapture;
  planPlane: typeof planPlane;
  categoryStrokes: typeof categoryStrokes;
  categoryDeductionStrokes: typeof categoryDeductionStrokes;
};
