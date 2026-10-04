import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  InstancedBufferGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  OrthographicCamera,
  Raycaster,
  Scene,
  ShaderMaterial,
  ShapeUtils,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { BufferAttribute } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { registerCanvasCapture } from '../platform/canvas-capture';
import {
  defaultCamera,
  memberFrame,
  resolveCamera,
  surfaceFaces,
} from './scene';
import type {
  ConstructionScene,
  DisplayMode,
  Point3,
  SceneCamera,
  SceneFace,
  SceneSource,
} from './scene';

export interface RenderConstructionOptions {
  width?: number;
  height?: number;
  pixelRatio?: number;
  camera?: SceneCamera;
  displayMode?: DisplayMode;
  selectedGeometryIds?: readonly string[];
  selectedPieceId?: string | null;
}
export interface RendererCallbacks {
  onCameraChange(camera: SceneCamera): void;
  onSelect(source: SceneSource | null): void;
}

const background = '#edf1f5';
const vector = (p: Point3) => new Vector3(p.x, p.y, p.z);
function materialColor(material: string): Color {
  let hash = 0;
  for (let i = 0; i < material.length; i++)
    hash = (hash * 31 + material.charCodeAt(i)) | 0;
  return new Color().setHSL(
    (Math.abs(hash) % 360) / 360,
    0.28,
    0.64,
    SRGBColorSpace,
  );
}
function selectedColor(
  source: SceneSource,
  options: RenderConstructionOptions,
  selected: Set<string>,
) {
  return source.id === options.selectedPieceId
    ? new Color('#ffbd66')
    : selected.has(source.geometryId)
      ? new Color('#69a9e7')
      : materialColor(source.materialId);
}

/** Triangulate in the face's own plane, preserving concave boundaries and original IDs. */
export function triangulateFace(face: SceneFace): number[][] {
  const points = face.points;
  const origin = points[0];
  if (!origin || points.length < 3) return [];
  const normal = new Vector3();
  for (let i = 1; i + 1 < points.length; i++) {
    const a = points[i],
      b = points[i + 1];
    if (!a || !b) continue;
    normal.add(
      new Vector3().crossVectors(
        vector(a).sub(vector(origin)),
        vector(b).sub(vector(origin)),
      ),
    );
  }
  if (normal.lengthSq() < 1e-20) return [];
  normal.normalize();
  const reference =
    Math.abs(normal.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  const u = reference.cross(normal).normalize();
  const v = new Vector3().crossVectors(normal, u);
  return ShapeUtils.triangulateShape(
    points.map((p) => {
      const delta = vector(p).sub(vector(origin));
      return new Vector2(delta.dot(u), delta.dot(v));
    }),
    [],
  );
}

/** One instance buffer for all members; shared with their depth-tested edge lines. */
function memberEdges(box: BoxGeometry, mesh: InstancedMesh) {
  const base = new EdgesGeometry(box);
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', base.getAttribute('position'));
  geometry.setAttribute('instanceMatrix', mesh.instanceMatrix);
  geometry.instanceCount = mesh.count;
  base.dispose();
  const material = new ShaderMaterial({
    uniforms: { edgeColor: { value: new Color('#526375') } },
    vertexShader: `attribute mat4 instanceMatrix;
      void main() { gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 edgeColor;
      void main() { gl_FragColor = vec4(edgeColor, 1.0);
        #include <colorspace_fragment>
      }`,
    depthTest: true,
    depthWrite: false,
  });
  const edges = new LineSegments(geometry, material);
  // The base edge geometry is a unit cube; the instances have their own bounds.
  edges.frustumCulled = false;
  return edges;
}

export class ConstructionRenderer {
  private readonly gpu: WebGLRenderer;
  private readonly maxDimension: number;
  private readonly world = new Scene();
  private readonly camera = new OrthographicCamera();
  private readonly controls: OrbitControls | undefined;
  private readonly content = new Group();
  private readonly raycaster = new Raycaster();
  private readonly origin = new Vector3();
  private model: ConstructionScene | undefined;
  private options: RenderConstructionOptions = {};
  private members: InstancedMesh<BoxGeometry, MeshLambertMaterial> | undefined;
  private outlines:
    LineSegments<InstancedBufferGeometry, ShaderMaterial> | undefined;
  private finishes: Mesh<BufferGeometry, MeshLambertMaterial> | undefined;
  private finishEdges:
    LineSegments<BufferGeometry, LineBasicMaterial> | undefined;
  private surfaceTriangles: SceneSource[] = [];
  private surfaceVertices: {
    source: SceneSource;
    start: number;
    count: number;
  }[] = [];
  private disposed = false;
  private applying = false;
  private enabled = true;
  private frame = 0;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private cleanupEvents: (() => void) | undefined;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    callbacks?: RendererCallbacks,
  ) {
    try {
      this.gpu = new WebGLRenderer({ canvas, antialias: true, alpha: false });
    } catch {
      throw new Error(
        '3D requires WebGL 2. Enable hardware acceleration or use a supported graphics device.',
      );
    }
    this.gpu.outputColorSpace = SRGBColorSpace;
    this.gpu.setClearColor(background);
    const gl = this.gpu.getContext();
    this.maxDimension = Math.min(
      this.gpu.capabilities.maxTextureSize,
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
    );
    this.camera.up.set(0, 0, 1);
    this.world.add(this.content, new AmbientLight(0xffffff, 1.5));
    const light = new DirectionalLight(0xffffff, 1.8);
    light.position.set(4, -6, 10);
    this.world.add(light);
    if (callbacks) {
      this.controls = new OrbitControls(this.camera, canvas);
      this.controls.enableDamping = false;
      this.controls.screenSpacePanning = true;
      this.controls.minZoom = 0.01;
      this.controls.maxZoom = 10000;
      const controls = this.controls;
      this.controls.addEventListener('change', () => {
        if (this.applying || this.disposed || !this.model) return;
        const offset = this.camera.position.clone().sub(controls.target);
        const target = controls.target.clone().add(this.origin);
        const camera: SceneCamera = {
          yaw: Math.atan2(offset.y, offset.x),
          pitch: Math.atan2(offset.z, Math.hypot(offset.x, offset.y)),
          zoom: this.camera.zoom,
          target: { x: target.x, y: target.y, z: target.z },
          span: resolveCamera(this.model, this.options.camera ?? defaultCamera)
            .span,
        };
        this.options = { ...this.options, camera };
        callbacks.onCameraChange(camera);
      });
      let pressed: { x: number; y: number } | undefined;
      const down = (event: PointerEvent) => {
        if (!this.enabled || event.button !== 0) return;
        canvas.focus();
        pressed = { x: event.clientX, y: event.clientY };
      };
      const up = (event: PointerEvent) => {
        if (
          pressed &&
          this.enabled &&
          Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < 4
        ) {
          const bounds = canvas.getBoundingClientRect();
          callbacks.onSelect(
            this.pick(event.clientX - bounds.left, event.clientY - bounds.top),
          );
        }
        pressed = undefined;
      };
      const cancel = () => {
        pressed = undefined;
      };
      canvas.addEventListener('pointerdown', down);
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', cancel);
      this.cleanupEvents = () => {
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('pointercancel', cancel);
      };
    }
    const lost = (event: Event) => {
      event.preventDefault();
    };
    const restored = () => {
      if (!this.disposed) this.requestDraw();
    };
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    const unregisterCapture = registerCanvasCapture(canvas, () => {
      if (!this.disposed) {
        this.assertContext();
        this.gpu.render(this.world, this.camera);
      }
    });
    const cleanup = this.cleanupEvents;
    this.cleanupEvents = () => {
      cleanup?.();
      unregisterCapture();
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
    };
  }

  private clearModel() {
    for (const object of [
      this.members,
      this.outlines,
      this.finishes,
      this.finishEdges,
    ]) {
      if (!object) continue;
      this.content.remove(object);
      object.geometry.dispose();
      object.material.dispose();
    }
    this.members?.dispose();
    this.members = undefined;
    this.outlines = undefined;
    this.finishes = undefined;
    this.finishEdges = undefined;
    this.surfaceTriangles = [];
    this.surfaceVertices = [];
  }

  private setModel(model: ConstructionScene) {
    this.clearModel();
    this.model = model;
    this.origin.copy(
      vector(model.bounds.min)
        .add(vector(model.bounds.max))
        .multiplyScalar(0.5),
    );
    if (model.members.length) {
      const box = new BoxGeometry(1, 1, 1);
      const material = new MeshLambertMaterial({
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      const mesh = new InstancedMesh(box, material, model.members.length);
      const matrix = new Matrix4();
      for (const [index, member] of model.members.entries()) {
        const frame = memberFrame(member);
        matrix.makeBasis(
          vector(frame.width),
          vector(frame.depth),
          vector(frame.along),
        );
        matrix.setPosition(vector(frame.center).sub(this.origin));
        mesh.setMatrixAt(index, matrix);
        mesh.setColorAt(index, materialColor(member.materialId));
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      this.members = mesh;
      this.outlines = memberEdges(box, mesh);
      this.content.add(mesh, this.outlines);
    }
    if (model.surfaces.length) {
      const positions: number[] = [],
        colors: number[] = [],
        edges: number[] = [];
      for (const source of model.surfaces) {
        const start = positions.length / 3;
        const color = materialColor(source.materialId);
        for (const face of surfaceFaces(source)) {
          for (const indices of triangulateFace(face)) {
            for (const index of indices) {
              const vertex = face.points[index];
              if (!vertex) continue;
              const point = vector(vertex).sub(this.origin);
              positions.push(point.x, point.y, point.z);
              colors.push(color.r, color.g, color.b);
            }
            this.surfaceTriangles.push(source);
          }
          for (let i = 0; i < face.points.length; i++) {
            const start = face.points[i],
              end = face.points[(i + 1) % face.points.length];
            if (!start || !end) continue;
            const a = vector(start).sub(this.origin);
            const b = vector(end).sub(this.origin);
            edges.push(a.x, a.y, a.z, b.x, b.y, b.z);
          }
        }
        this.surfaceVertices.push({
          source,
          start,
          count: positions.length / 3 - start,
        });
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute(
        'position',
        new Float32BufferAttribute(positions, 3),
      );
      geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      this.finishes = new Mesh(
        geometry,
        new MeshLambertMaterial({
          vertexColors: true,
          side: DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
      );
      const edgeGeometry = new BufferGeometry();
      edgeGeometry.setAttribute(
        'position',
        new Float32BufferAttribute(edges, 3),
      );
      this.finishEdges = new LineSegments(
        edgeGeometry,
        new LineBasicMaterial({ color: '#526375', depthWrite: false }),
      );
      this.content.add(this.finishes, this.finishEdges);
    }
  }

  private updateSelection(options: RenderConstructionOptions) {
    const selected = new Set(options.selectedGeometryIds);
    if (this.members && this.model) {
      for (const [index, member] of this.model.members.entries())
        this.members.setColorAt(
          index,
          selectedColor(member, options, selected),
        );
      if (this.members.instanceColor)
        this.members.instanceColor.needsUpdate = true;
    }
    const colors = this.finishes?.geometry.getAttribute('color') as
      BufferAttribute | undefined;
    if (colors) {
      for (const { source, start, count } of this.surfaceVertices) {
        const color = selectedColor(source, options, selected);
        for (let i = start; i < start + count; i++)
          colors.setXYZ(i, color.r, color.g, color.b);
      }
      colors.needsUpdate = true;
    }
  }

  render(model: ConstructionScene, options: RenderConstructionOptions = {}) {
    if (this.disposed) return;
    this.assertContext();
    const changed = model !== this.model;
    const previous = this.options;
    if (changed) this.setModel(model);
    this.options = options;
    this.width = Math.max(1, options.width ?? (this.canvas.clientWidth || 640));
    this.height = Math.max(
      1,
      options.height ?? (this.canvas.clientHeight || 480),
    );
    const maxDimension = this.maxDimension;
    if (this.width > maxDimension || this.height > maxDimension)
      throw new Error(
        `The graphics device supports images up to ${String(maxDimension)} pixels per side.`,
      );
    const ratio = Math.min(
      options.pixelRatio ?? 1,
      maxDimension / this.width,
      maxDimension / this.height,
    );
    if (
      this.pixelRatio !== ratio ||
      this.canvas.width !== Math.floor(this.width * ratio) ||
      this.canvas.height !== Math.floor(this.height * ratio)
    ) {
      this.pixelRatio = ratio;
      this.gpu.setDrawingBufferSize(this.width, this.height, ratio);
    }
    const state = resolveCamera(model, options.camera ?? defaultCamera);
    const aspect = this.width / this.height;
    const height = state.span / Math.min(1, aspect);
    this.camera.left = (-height * aspect) / 2;
    this.camera.right = (height * aspect) / 2;
    this.camera.top = height / 2;
    this.camera.bottom = -height / 2;
    const diagonal = vector(model.bounds.max).distanceTo(
      vector(model.bounds.min),
    );
    const target = vector(state.target).sub(this.origin);
    const distance = Math.max(1, diagonal + target.length() + state.span);
    const direction = new Vector3(
      Math.cos(state.pitch) * Math.cos(state.yaw),
      Math.cos(state.pitch) * Math.sin(state.yaw),
      Math.sin(state.pitch),
    );
    this.camera.position.copy(target).addScaledVector(direction, distance);
    // At the poles retain the requested yaw rather than relying on lookAt's arbitrary up-vector perturbation.
    const right = new Vector3(-Math.sin(state.yaw), Math.cos(state.yaw), 0);
    const up = new Vector3().crossVectors(direction, right);
    this.camera.quaternion.setFromRotationMatrix(
      new Matrix4().makeBasis(right, up, direction),
    );
    this.camera.near = Math.max(0.001, distance - diagonal - target.length());
    this.camera.far = distance + diagonal + target.length() + 1;
    this.camera.zoom = state.zoom;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    if (this.controls) {
      this.applying = true;
      this.controls.target.copy(target);
      this.controls.update();
      this.applying = false;
    }
    if (
      changed ||
      previous.selectedPieceId !== options.selectedPieceId ||
      previous.selectedGeometryIds !== options.selectedGeometryIds
    )
      this.updateSelection(options);
    const mode = options.displayMode ?? 'solid';
    if (this.finishes) this.finishes.visible = mode === 'solid';
    if (this.finishEdges) {
      this.finishEdges.visible = mode !== 'framing';
      this.finishEdges.material.depthTest = mode !== 'xray';
      this.finishEdges.material.transparent = mode === 'xray';
      this.finishEdges.material.opacity = mode === 'xray' ? 0.25 : 1;
      this.finishEdges.renderOrder = mode === 'xray' ? 1 : 0;
    }
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.gpu.render(this.world, this.camera);
  }

  private assertContext() {
    if (this.gpu.getContext().isContextLost())
      throw new Error(
        'The graphics connection was interrupted. Try the 3D view again.',
      );
  }

  private requestDraw() {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.disposed) this.gpu.render(this.world, this.camera);
    });
  }

  pick(x: number, y: number): SceneSource | null {
    if (!this.model || this.disposed) return null;
    this.raycaster.setFromCamera(
      new Vector2((x / this.width) * 2 - 1, 1 - (y / this.height) * 2),
      this.camera,
    );
    const objects = [
      this.members,
      (this.options.displayMode ?? 'solid') === 'solid'
        ? this.finishes
        : undefined,
    ].filter((object): object is NonNullable<typeof object> => Boolean(object));
    const hit = this.raycaster.intersectObjects(objects, false)[0];
    if (!hit) return null;
    if (hit.object === this.members && hit.instanceId !== undefined)
      return this.model.members[hit.instanceId] ?? null;
    return hit.faceIndex == null
      ? null
      : (this.surfaceTriangles[hit.faceIndex] ?? null);
  }

  setInteractionEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (this.controls) this.controls.enabled = enabled;
  }

  info() {
    return {
      drawCalls: this.disposed ? 0 : this.gpu.info.render.calls,
      triangles: this.disposed ? 0 : this.gpu.info.render.triangles,
      geometries: this.gpu.info.memory.geometries,
      textures: this.gpu.info.memory.textures,
      objects:
        this.disposed || !this.model
          ? 0
          : this.model.members.length +
            (this.options.displayMode === 'framing'
              ? 0
              : this.model.surfaces.length),
      width: this.canvas.width,
      height: this.canvas.height,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.controls?.dispose();
    this.cleanupEvents?.();
    this.clearModel();
    this.model = undefined;
    this.gpu.dispose();
    this.gpu.forceContextLoss();
    this.canvas.width = this.canvas.height = 1;
  }
}

export function createConstructionRenderer(
  canvas: HTMLCanvasElement,
  callbacks?: RendererCallbacks,
) {
  return new ConstructionRenderer(canvas, callbacks);
}

// Wingman and CLI share one offscreen GPU context. The interactive viewer owns its
// own context so thumbnails/exports cannot change its camera or GPU scene.
let snapshot:
  | {
      canvas: HTMLCanvasElement;
      renderer: ConstructionRenderer;
      leases: number;
    }
  | undefined;
export function acquireConstructionSnapshot() {
  if (!snapshot) {
    const canvas = document.createElement('canvas');
    snapshot = {
      canvas,
      renderer: createConstructionRenderer(canvas),
      leases: 0,
    };
  }
  const owned = snapshot;
  owned.leases++;
  let disposed = false;
  return {
    render(
      canvas: HTMLCanvasElement,
      scene: ConstructionScene,
      options: RenderConstructionOptions = {},
    ) {
      if (disposed) return;
      owned.renderer.render(scene, options);
      canvas.width = owned.canvas.width;
      canvas.height = owned.canvas.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Unable to create a preview canvas.');
      // Copy immediately while the WebGL drawing buffer is valid. PNG encoding
      // can then run asynchronously without preserveDrawingBuffer overhead.
      context.drawImage(owned.canvas, 0, 0);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (--owned.leases === 0) {
        owned.renderer.dispose();
        if (snapshot === owned) snapshot = undefined;
      }
    },
  };
}
