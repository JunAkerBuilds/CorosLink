import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  Box3,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Material
} from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Layers3,
  RotateCcw
} from "lucide-react";
import { MUSCLE_BY_ID, MUSCLES, type MuscleId } from "./muscles";
import {
  heatLevel,
  metricValue,
  type HeatMetric,
  type MuscleStat
} from "./strengthAnalytics";

export type BodyView = "front" | "back";

interface BodyMapV2Props {
  view: BodyView;
  viewRequest: number;
  metric: HeatMetric;
  muscleById: Record<MuscleId, MuscleStat>;
  max: number;
  selected: MuscleId | null;
  hovered: MuscleId | null;
  onHover: (muscle: MuscleId | null) => void;
  onSelect: (muscle: MuscleId) => void;
  onViewChange?: (view: BodyView) => void;
}

const MODEL_URL = "./assets/anatomy/muscular_lite.glb";
const DRACO_URL = "./assets/anatomy/draco/";
const MODEL_HEIGHT = 2;
const CAMERA_FOV = 25;
const CAMERA_FRAMING = 1.28;
const TARGET_Y = MODEL_HEIGHT * 0.51;
const COLOR_EPSILON = 0.0016;
const MAX_PIXEL_RATIO = 1.5;
const SURFACE_PICK_DEPTH = 0.025;
const LAYER_STORAGE_KEY = "coroslink-strength-muscle-layers-v1";

// The source model uses a right-side dissection cutaway. The Strength heat map
// needs a consistent superficial view, so deeper abdominal and chest layers
// are omitted and the intact left surface is mirrored below.
const HIDDEN_DEEP_STRUCTURES = new Set([
  "internal_oblique",
  "transversus_abdominis",
  "pectoralis_minor",
  "serratus_anterior"
]);
const SYMMETRIC_FRONT_STRUCTURES = new Set([
  "rectus_abdominis",
  "external_oblique",
  "pectoralis_major"
]);
// The first item is the frontmost layer. This preserves the currently chosen
// torso order while making every mapped group user-configurable.
const DEFAULT_LAYER_ORDER: MuscleId[] = [
  "obliques",
  "abs",
  "chest",
  ...MUSCLES.map((muscle) => muscle.id).filter(
    (id) => id !== "obliques" && id !== "abs" && id !== "chest"
  )
];

function layerPriority(order: MuscleId[], muscle: MuscleId): number {
  const index = order.indexOf(muscle);
  return index < 0 ? 0 : order.length - index;
}

function isMuscleId(value: unknown): value is MuscleId {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(MUSCLE_BY_ID, value)
  );
}

function readLayerPreferences(): {
  order: MuscleId[];
  hidden: Set<MuscleId>;
} {
  try {
    const stored = JSON.parse(localStorage.getItem(LAYER_STORAGE_KEY) ?? "null") as {
      order?: unknown;
      hidden?: unknown;
    } | null;
    const savedOrder = Array.isArray(stored?.order)
      ? stored.order.filter(isMuscleId)
      : [];
    const order = [
      ...new Set(savedOrder),
      ...DEFAULT_LAYER_ORDER.filter((id) => !savedOrder.includes(id))
    ];
    const hidden = new Set(
      Array.isArray(stored?.hidden) ? stored.hidden.filter(isMuscleId) : []
    );
    return { order, hidden };
  } catch {
    return { order: [...DEFAULT_LAYER_ORDER], hidden: new Set() };
  }
}

/** Anatomy Engine structure ids translated into CorosLink's broader training groups. */
const STRUCTURE_TO_MUSCLE: Record<string, MuscleId> = {
  sternocleidomastoid: "neck",
  deep_cervical_flexors: "neck",
  scalenes: "neck",
  upper_trapezius: "traps",
  middle_trapezius: "traps",
  lower_trapezius: "traps",
  levator_scapulae: "traps",
  deltoid: "shoulders",
  posterior_deltoid: "shoulders",
  infraspinatus: "shoulders",
  supraspinatus: "shoulders",
  subscapularis: "shoulders",
  pectoralis_major: "chest",
  pectoralis_minor: "chest",
  serratus_anterior: "chest",
  latissimus_dorsi: "lats",
  rhomboids: "lats",
  teres_major: "lats",
  biceps_brachii: "biceps",
  brachialis: "biceps",
  coracobrachialis: "biceps",
  triceps_brachii: "triceps",
  brachioradialis: "forearms",
  rectus_abdominis: "abs",
  transversus_abdominis: "abs",
  external_oblique: "obliques",
  internal_oblique: "obliques",
  erector_spinae_lumbar: "lowerBack",
  quadratus_lumborum: "lowerBack",
  multifidus: "lowerBack",
  gluteus_maximus: "glutes",
  gluteus_medius: "glutes",
  gluteus_minimus: "glutes",
  piriformis: "glutes",
  obturator_internus: "glutes",
  obturator_externus: "glutes",
  gemellus_superior: "glutes",
  gemellus_inferior: "glutes",
  quadratus_femoris: "glutes",
  tensor_fasciae_latae: "glutes",
  rectus_femoris: "quads",
  vastus_lateralis: "quads",
  vastus_medialis: "quads",
  sartorius: "quads",
  biceps_femoris: "hamstrings",
  semitendinosus: "hamstrings",
  semimembranosus: "hamstrings",
  adductor_magnus: "adductors",
  adductor_longus: "adductors",
  adductor_brevis: "adductors",
  gastrocnemius: "calves",
  soleus: "calves",
  peroneals: "calves",
  tibialis_anterior: "calves",
  tibialis_posterior: "calves"
};

interface Palette {
  base: Color;
  untagged: Color;
  heat: Color[];
  rim: Color;
  sky: Color;
  ground: Color;
  exposure: number;
}

function readPalette(element: HTMLElement): Palette {
  const styles = getComputedStyle(element);
  const readColor = (name: string, fallback: string) => {
    const value = styles.getPropertyValue(name).trim();
    try {
      return new Color(value || fallback);
    } catch {
      return new Color(fallback);
    }
  };
  const exposure = Number.parseFloat(
    styles.getPropertyValue("--m3d-exposure").trim()
  );

  return {
    base: readColor("--m3d-base", "#39424b"),
    untagged: readColor("--m3d-v2-untagged", "#73808a"),
    heat: [0, 1, 2, 3, 4, 5].map((level) =>
      readColor(`--m3d-heat-${level}`, level === 0 ? "#46505a" : "#e5484d")
    ),
    rim: readColor("--m3d-rim", "#7fe8c4"),
    sky: readColor("--m3d-sky", "#93b8dc"),
    ground: readColor("--m3d-ground", "#151a1f"),
    exposure: Number.isFinite(exposure) ? exposure : 1
  };
}

function colorDistance(a: Color, b: Color): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

function normalizeAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function structureIdFor(object: Object3D): string | null {
  const embedded = object.userData.structure_id;
  if (typeof embedded === "string" && embedded.length > 0) {
    return embedded;
  }

  // The lite export also retains the structure id as the mesh-name prefix.
  const normalized = object.name.toLowerCase();
  return Object.keys(STRUCTURE_TO_MUSCLE).find((id) =>
    normalized.startsWith(`${id}_`)
  ) ?? null;
}

function muscleFor(object: Object3D): MuscleId | null {
  let current: Object3D | null = object;
  while (current) {
    const structure = structureIdFor(current);
    if (structure && STRUCTURE_TO_MUSCLE[structure]) {
      return STRUCTURE_TO_MUSCLE[structure];
    }
    current = current.parent;
  }
  return null;
}

function disposeOriginalMaterial(material: Material): void {
  const candidate = material as Material & {
    map?: { dispose: () => void } | null;
    normalMap?: { dispose: () => void } | null;
    roughnessMap?: { dispose: () => void } | null;
    metalnessMap?: { dispose: () => void } | null;
  };
  candidate.map?.dispose();
  candidate.normalMap?.dispose();
  candidate.roughnessMap?.dispose();
  candidate.metalnessMap?.dispose();
  material.dispose();
}

function createShadowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2
    );
    gradient.addColorStop(0, "rgba(0,0,0,0.72)");
    gradient.addColorStop(0.5, "rgba(0,0,0,0.3)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

interface MuscleMaterial {
  material: MeshStandardMaterial;
  target: Color;
  scratch: Color;
  level: number;
}

type GeometryBucket = MuscleId | "__untagged";

function prepareGeometry(
  geometry: BufferGeometry,
  object: Object3D
): BufferGeometry {
  const prepared = geometry.clone();
  prepared.applyMatrix4(object.matrixWorld);
  prepared.clearGroups();

  // The replacement materials do not use texture coordinates. Normalizing the
  // attribute layout lets all primitives for a muscle share one draw call.
  for (const attribute of Object.keys(prepared.attributes)) {
    if (attribute !== "position" && attribute !== "normal") {
      prepared.deleteAttribute(attribute);
    }
  }

  return prepared;
}

function createSymmetricFrontPair(
  geometry: BufferGeometry
): BufferGeometry[] {
  const indices = geometry.getIndex();
  const positions = geometry.getAttribute("position");
  if (!indices || !positions) {
    return [geometry];
  }

  const leftIndices: number[] = [];
  for (let index = 0; index < indices.count; index += 3) {
    const a = indices.getX(index);
    const b = indices.getX(index + 1);
    const c = indices.getX(index + 2);
    const centerX =
      (positions.getX(a) + positions.getX(b) + positions.getX(c)) / 3;
    if (centerX <= 0) {
      leftIndices.push(a, b, c);
    }
  }

  if (leftIndices.length === 0) {
    geometry.dispose();
    return [];
  }

  geometry.setIndex(leftIndices);
  const mirrored = geometry.clone();
  mirrored.scale(-1, 1, 1);

  // Negative scaling reverses triangle winding; swap the final two vertices
  // so the mirrored half remains front-facing with normal backface culling.
  const mirroredIndices = mirrored.getIndex();
  if (mirroredIndices) {
    for (let index = 0; index < mirroredIndices.count; index += 3) {
      const b = mirroredIndices.getX(index + 1);
      mirroredIndices.setX(index + 1, mirroredIndices.getX(index + 2));
      mirroredIndices.setX(index + 2, b);
    }
    mirroredIndices.needsUpdate = true;
  }

  return [geometry, mirrored];
}

interface AnatomyWorld {
  dispose: () => void;
  refreshPalette: () => void;
  setFocus: (hovered: MuscleId | null, selected: MuscleId | null) => void;
  setLayers: (order: MuscleId[], hidden: Set<MuscleId>) => void;
  setLevels: (levels: Record<MuscleId, number>) => void;
  setView: (view: BodyView) => void;
}

function createWorld(
  container: HTMLDivElement,
  handlers: {
    onHover: (muscle: MuscleId | null) => void;
    onSelect: (muscle: MuscleId) => void;
    onViewChange: (view: BodyView) => void;
    onLoad: () => void;
    onLoadProgress: (progress: number | null) => void;
    onError: () => void;
  },
  reducedMotion: boolean
): AnatomyWorld {
  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance"
  });
  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
  );
  renderer.setClearAlpha(0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;

  const canvas = renderer.domElement;
  canvas.className = "body-map-canvas anatomy-body-canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  canvas.setAttribute(
    "aria-label",
    "Interactive anatomical muscle model. Use the Front and Back controls to turn the figure, then select a highlighted muscle group."
  );
  container.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.05, 100);
  const cameraDistance =
    (MODEL_HEIGHT * CAMERA_FRAMING) /
    (2 * Math.tan((CAMERA_FOV * Math.PI) / 360));
  const cameraTarget = new Vector3(0, TARGET_Y, 0);
  camera.position.set(0, TARGET_Y + 0.05, cameraDistance);
  camera.lookAt(cameraTarget);

  const hemi = new HemisphereLight(0x93b8dc, 0x151a1f, 0.78);
  const key = new DirectionalLight(0xfff8ed, 2.35);
  key.position.set(-2.8, 4.2, 3.7);
  const fill = new DirectionalLight(0xc4dcff, 0.82);
  fill.position.set(3.2, 1.6, 2.6);
  const rim = new DirectionalLight(0x7fe8c4, 1.35);
  rim.position.set(0.8, 2.2, -3.8);
  scene.add(hemi, key, fill, rim);

  const modelRoot = new Group();
  modelRoot.name = "anatomy-engine-muscular-system";
  scene.add(modelRoot);

  const shadowTexture = createShadowTexture();
  const shadowMaterial = new MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    depthWrite: false,
    opacity: 0.44
  });
  const shadowGeometry = new PlaneGeometry(1, 1);
  const shadow = new Mesh(shadowGeometry, shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.008;
  shadow.scale.set(1.45, 0.68, 1);
  scene.add(shadow);

  const groups = new Map<MuscleId, MuscleMaterial>();
  const sharedMaterials = new Set<Material>([shadowMaterial]);
  const geometries = new Set<BufferGeometry>([shadowGeometry]);
  const originalMaterials = new Set<Material>();
  const pickTargets: Mesh[] = [];
  const muscleMeshes = new Map<MuscleId, Mesh[]>();
  let layerOrder = [...DEFAULT_LAYER_ORDER];
  let hiddenMuscles = new Set<MuscleId>();

  for (const muscle of MUSCLES) {
    const surfaceLayer = layerPriority(layerOrder, muscle.id);
    const material = new MeshStandardMaterial({
      color: 0x46505a,
      emissive: 0x46505a,
      emissiveIntensity: 0.025,
      roughness: 0.54,
      metalness: 0.01,
      polygonOffset: surfaceLayer > 0,
      polygonOffsetFactor: -surfaceLayer * 2,
      polygonOffsetUnits: -surfaceLayer * 2
    });
    sharedMaterials.add(material);
    groups.set(muscle.id, {
      material,
      target: new Color(0x46505a),
      scratch: new Color(),
      level: 0
    });
  }

  const untaggedMaterial = new MeshStandardMaterial({
    color: 0x73808a,
    roughness: 0.72,
    metalness: 0,
    transparent: true,
    opacity: 0.28,
    depthWrite: false
  });
  sharedMaterials.add(untaggedMaterial);

  let palette = readPalette(container);
  let localHover: MuscleId | null = null;
  let externalHover: MuscleId | null = null;
  let selected: MuscleId | null = null;
  let cameraTargetAngle: number | null = null;
  let frame = 0;
  let visible = true;
  let disposed = false;
  let needsRender = true;
  let last = performance.now();

  const pointer = new Vector2();
  const raycaster = new Raycaster();
  let pointerInside = false;
  let hoverDirty = false;

  const applyLayers = () => {
    for (const [id, group] of groups) {
      const priority = layerPriority(layerOrder, id);
      group.material.polygonOffset = priority > 0;
      group.material.polygonOffsetFactor = -priority * 2;
      group.material.polygonOffsetUnits = -priority * 2;
      group.material.needsUpdate = true;
      for (const mesh of muscleMeshes.get(id) ?? []) {
        mesh.renderOrder = priority;
        mesh.visible = !hiddenMuscles.has(id);
      }
    }
    needsRender = true;
    start();
  };

  const applyPalette = () => {
    palette = readPalette(container);
    hemi.color.copy(palette.sky);
    hemi.groundColor.copy(palette.ground);
    rim.color.copy(palette.rim);
    renderer.toneMappingExposure = palette.exposure;
    untaggedMaterial.color.copy(palette.untagged);
    for (const group of groups.values()) {
      group.target.copy(palette.heat[group.level] ?? palette.base);
    }
    needsRender = true;
    start();
  };

  const updatePointer = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  };

  const pick = (): MuscleId | null => {
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster
      .intersectObjects(pickTargets, false)
      .filter((candidate) => candidate.object.visible);
    const nearest = hits[0];
    if (!nearest) {
      return null;
    }
    const hit = hits
      .filter((candidate) => candidate.distance <= nearest.distance + SURFACE_PICK_DEPTH)
      .reduce((best, candidate) => {
        const bestMuscle = best.object.userData.strengthMuscle as
          | MuscleId
          | undefined;
        const candidateMuscle = candidate.object.userData.strengthMuscle as
          | MuscleId
          | undefined;
        const bestLayer = bestMuscle
          ? layerPriority(layerOrder, bestMuscle)
          : 0;
        const candidateLayer = candidateMuscle
          ? layerPriority(layerOrder, candidateMuscle)
          : 0;
        return candidateLayer > bestLayer ? candidate : best;
      }, nearest);
    const muscle = hit?.object.userData.strengthMuscle;
    return typeof muscle === "string" ? (muscle as MuscleId) : null;
  };

  const onPointerMove = (event: PointerEvent) => {
    pointerInside = true;
    updatePointer(event);
    hoverDirty = true;
    start();
  };

  const onPointerUp = (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }
    updatePointer(event);
    const hit = pick();
    if (hit) {
      handlers.onSelect(hit);
    }
  };

  const onPointerLeave = () => {
    pointerInside = false;
    hoverDirty = false;
    if (localHover) {
      localHover = null;
      handlers.onHover(null);
      needsRender = true;
      start();
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    let next: BodyView | null = null;
    if (event.key === "ArrowLeft") {
      next = "front";
    } else if (event.key === "ArrowRight") {
      next = "back";
    } else if (event.key === "Home") {
      next = "front";
    }
    if (next) {
      event.preventDefault();
      handlers.onViewChange(next);
      world.setView(next);
    }
  };

  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("keydown", onKeyDown);

  const resize = () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width <= 0 || height <= 0) {
      return;
    }
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    needsRender = true;
    start();
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  const intersectionObserver = new IntersectionObserver(
    (entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) {
        start();
      }
    },
    { threshold: 0 }
  );
  intersectionObserver.observe(container);

  const tick = () => {
    frame = 0;
    if (!visible || document.hidden || disposed) {
      return;
    }
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    let animating = false;

    if (cameraTargetAngle !== null) {
      const offset = camera.position.clone().sub(cameraTarget);
      const currentAngle = Math.atan2(offset.x, offset.z);
      const delta = normalizeAngle(cameraTargetAngle - currentAngle);
      const amount = reducedMotion ? 1 : 1 - Math.exp(-dt * 9);
      const nextAngle =
        Math.abs(delta) < 0.002
          ? cameraTargetAngle
          : currentAngle + delta * amount;
      camera.position.set(
        cameraTarget.x + Math.sin(nextAngle) * cameraDistance,
        cameraTarget.y + 0.05,
        cameraTarget.z + Math.cos(nextAngle) * cameraDistance
      );
      camera.lookAt(cameraTarget);
      if (Math.abs(delta) < 0.002) {
        cameraTargetAngle = null;
      }
      animating = true;
    }

    if (hoverDirty && pointerInside) {
      hoverDirty = false;
      const hit = pick();
      if (hit !== localHover) {
        localHover = hit;
        handlers.onHover(hit);
      }
      canvas.style.cursor = hit ? "pointer" : "default";
    }

    const active = localHover ?? externalHover;
    const colorStep = reducedMotion ? 1 : 1 - Math.exp(-dt * 8);
    for (const [id, group] of groups) {
      const dimmed = selected !== null && selected !== id;
      const target = dimmed
        ? group.scratch.copy(group.target).lerp(palette.base, 0.72)
        : group.target;
      if (colorDistance(group.material.color, target) > COLOR_EPSILON) {
        group.material.color.lerp(target, colorStep);
        animating = true;
      } else {
        group.material.color.copy(target);
      }
      group.material.emissive.copy(group.material.color);
      const focused = id === active || id === selected;
      const wantedGlow = focused ? 0.42 : dimmed ? 0 : 0.025;
      if (Math.abs(group.material.emissiveIntensity - wantedGlow) > 0.002) {
        group.material.emissiveIntensity +=
          (wantedGlow - group.material.emissiveIntensity) * colorStep;
        animating = true;
      } else {
        group.material.emissiveIntensity = wantedGlow;
      }
    }

    if (animating || needsRender) {
      needsRender = false;
      renderer.render(scene, camera);
    }
    if (animating) {
      frame = requestAnimationFrame(tick);
    }
  };

  function start() {
    if (frame !== 0 || !visible || document.hidden || disposed) {
      return;
    }
    last = performance.now();
    frame = requestAnimationFrame(tick);
  }

  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_URL);
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  loader.load(
    MODEL_URL,
    (gltf) => {
      if (disposed) {
        gltf.scene.traverse((object) => {
          if (object instanceof Mesh) {
            object.geometry.dispose();
          }
        });
        return;
      }

      gltf.scene.updateMatrixWorld(true);
      const buckets = new Map<GeometryBucket, BufferGeometry[]>();
      const sourceGeometries = new Set<BufferGeometry>();

      gltf.scene.traverse((object) => {
        if (!(object instanceof Mesh)) {
          return;
        }
        sourceGeometries.add(object.geometry);
        const previous = Array.isArray(object.material)
          ? object.material
          : [object.material];
        previous.forEach((material) => originalMaterials.add(material));

        const structure = structureIdFor(object);
        if (structure && HIDDEN_DEEP_STRUCTURES.has(structure)) {
          return;
        }

        const muscle = muscleFor(object);
        const bucket = muscle ?? "__untagged";
        const prepared = prepareGeometry(object.geometry, object);
        const entries = buckets.get(bucket) ?? [];
        entries.push(
          ...(structure && SYMMETRIC_FRONT_STRUCTURES.has(structure)
            ? createSymmetricFrontPair(prepared)
            : [prepared])
        );
        buckets.set(bucket, entries);
      });

      const optimizedRoot = new Group();
      optimizedRoot.name = "batched-anatomy-muscles";

      for (const [bucket, entries] of buckets) {
        if (entries.length === 0) {
          continue;
        }
        const merged =
          entries.length === 1 ? entries[0] : mergeGeometries(entries);
        const renderGeometries = merged ? [merged] : entries;

        if (merged && entries.length > 1) {
          entries.forEach((geometry) => geometry.dispose());
        }

        for (const geometry of renderGeometries) {
          geometry.computeBoundingBox();
          geometry.computeBoundingSphere();
          geometries.add(geometry);

          const muscle = bucket === "__untagged" ? null : bucket;
          const mesh = new Mesh(
            geometry,
            muscle ? groups.get(muscle)!.material : untaggedMaterial
          );
          mesh.name = muscle ? `strength-${muscle}` : "anatomy-context";
          if (muscle) {
            mesh.renderOrder = layerPriority(layerOrder, muscle);
            mesh.visible = !hiddenMuscles.has(muscle);
            mesh.userData.strengthMuscle = muscle;
            pickTargets.push(mesh);
            const meshes = muscleMeshes.get(muscle) ?? [];
            meshes.push(mesh);
            muscleMeshes.set(muscle, meshes);
          } else {
            mesh.renderOrder = -1;
          }
          optimizedRoot.add(mesh);
        }
      }

      for (const geometry of sourceGeometries) {
        geometry.dispose();
      }
      for (const material of originalMaterials) {
        disposeOriginalMaterial(material);
      }
      originalMaterials.clear();

      const bounds = new Box3().setFromObject(optimizedRoot);
      const size = bounds.getSize(new Vector3());
      const center = bounds.getCenter(new Vector3());
      const scale = size.y > 0 ? MODEL_HEIGHT / size.y : 1;
      optimizedRoot.scale.setScalar(scale);
      optimizedRoot.position.set(
        -center.x * scale,
        -bounds.min.y * scale,
        -center.z * scale
      );
      modelRoot.add(optimizedRoot);
      applyLayers();

      const scaledWidth = size.x * scale;
      const scaledDepth = size.z * scale;
      shadow.scale.set(
        Math.max(0.72, scaledWidth * 0.7),
        Math.max(0.34, scaledDepth * 1.7),
        1
      );

      handlers.onLoad();
      needsRender = true;
      start();
    },
    (event) => {
      handlers.onLoadProgress(
        event.total > 0 ? Math.min(1, event.loaded / event.total) : null
      );
    },
    () => handlers.onError()
  );

  applyPalette();
  resize();

  const world: AnatomyWorld = {
    dispose() {
      disposed = true;
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("keydown", onKeyDown);
      for (const geometry of geometries) {
        geometry.dispose();
      }
      for (const material of sharedMaterials) {
        material.dispose();
      }
      shadowTexture.dispose();
      draco.dispose();
      renderer.dispose();
      canvas.remove();
    },
    refreshPalette: applyPalette,
    setFocus(nextHovered, nextSelected) {
      externalHover = nextHovered;
      selected = nextSelected;
      needsRender = true;
      start();
    },
    setLayers(nextOrder, nextHidden) {
      layerOrder = [...nextOrder];
      hiddenMuscles = new Set(nextHidden);
      if (localHover && hiddenMuscles.has(localHover)) {
        localHover = null;
        handlers.onHover(null);
      }
      applyLayers();
    },
    setLevels(levels) {
      for (const [id, group] of groups) {
        group.level = levels[id] ?? 0;
        group.target.copy(palette.heat[group.level] ?? palette.base);
      }
      needsRender = true;
      start();
    },
    setView(next) {
      cameraTargetAngle = next === "front" ? 0 : Math.PI;
      start();
    }
  };

  return world;
}

export function BodyMapV2({
  view,
  viewRequest,
  metric,
  muscleById,
  max,
  selected,
  hovered,
  onHover,
  onSelect,
  onViewChange
}: BodyMapV2Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<AnatomyWorld | null>(null);
  const handlersRef = useRef({ onHover, onSelect, onViewChange });
  handlersRef.current = { onHover, onSelect, onViewChange };
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [layerPreferences, setLayerPreferences] = useState(
    readLayerPreferences
  );

  const moveLayer = (muscle: MuscleId, direction: -1 | 1) => {
    setLayerPreferences((current) => {
      const index = current.order.indexOf(muscle);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.order.length) {
        return current;
      }
      const order = [...current.order];
      [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
      return { ...current, order };
    });
  };

  const toggleLayer = (muscle: MuscleId) => {
    setLayerPreferences((current) => {
      const hidden = new Set(current.hidden);
      if (hidden.has(muscle)) {
        hidden.delete(muscle);
      } else {
        hidden.add(muscle);
      }
      return { ...current, hidden };
    });
  };

  const resetLayers = () => {
    setLayerPreferences({
      order: [...DEFAULT_LAYER_ORDER],
      hidden: new Set()
    });
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let world: AnatomyWorld;
    try {
      world = createWorld(
        container,
        {
          onHover: (muscle) => handlersRef.current.onHover(muscle),
          onSelect: (muscle) => handlersRef.current.onSelect(muscle),
          onViewChange: (next) => handlersRef.current.onViewChange?.(next),
          onLoad: () => {
            setLoading(false);
            setFailed(false);
          },
          onLoadProgress: setProgress,
          onError: () => {
            setLoading(false);
            setFailed(true);
          }
        },
        reducedMotion
      );
    } catch {
      setLoading(false);
      setFailed(true);
      return;
    }
    worldRef.current = world;

    const themeObserver = new MutationObserver(() => world.refreshPalette());
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });

    return () => {
      themeObserver.disconnect();
      world.dispose();
      worldRef.current = null;
    };
  }, []);

  useEffect(() => {
    const levels = {} as Record<MuscleId, number>;
    for (const [id, stat] of Object.entries(muscleById) as [
      MuscleId,
      MuscleStat
    ][]) {
      levels[id] = heatLevel(metricValue(stat, metric), max);
    }
    worldRef.current?.setLevels(levels);
  }, [metric, max, muscleById]);

  useEffect(() => {
    worldRef.current?.setFocus(hovered, selected);
  }, [hovered, selected]);

  useEffect(() => {
    worldRef.current?.setView(view);
  }, [view, viewRequest]);

  useEffect(() => {
    worldRef.current?.setLayers(
      layerPreferences.order,
      layerPreferences.hidden
    );
    try {
      localStorage.setItem(
        LAYER_STORAGE_KEY,
        JSON.stringify({
          order: layerPreferences.order,
          hidden: [...layerPreferences.hidden]
        })
      );
    } catch {
      // The renderer still works when storage is unavailable.
    }
  }, [layerPreferences]);

  return (
    <div className="body-map anatomy-body-map" ref={containerRef}>
      {loading ? (
        <div className="anatomy-model-status" role="status" aria-live="polite">
          <span className="anatomy-model-skeleton" aria-hidden="true" />
          <strong>Loading anatomical model</strong>
          <span>
            {progress === null ? "Preparing the muscle system" : `${Math.round(progress * 100)}%`}
          </span>
        </div>
      ) : null}
      {failed ? (
        <p className="body-map-fallback" role="alert">
          The Anatomy Engine model could not load. The muscle ranking beside it
          still contains the complete workload breakdown.
        </p>
      ) : null}
      <div className={`anatomy-layer-control${layersOpen ? " is-open" : ""}`}>
        <button
          type="button"
          className="anatomy-layer-trigger"
          aria-expanded={layersOpen}
          aria-controls="anatomy-muscle-layers"
          onClick={() => setLayersOpen((current) => !current)}
        >
          <Layers3 size={15} aria-hidden="true" />
          <span>Muscle layers</span>
        </button>
        {layersOpen ? (
          <section
            className="anatomy-layer-panel"
            id="anatomy-muscle-layers"
            aria-label="Muscle layer settings"
          >
            <header>
              <div>
                <strong>Muscle layers</strong>
                <span>Front to back</span>
              </div>
              <button
                type="button"
                className="anatomy-layer-reset"
                aria-label="Reset muscle layers"
                title="Reset layers"
                onClick={resetLayers}
              >
                <RotateCcw size={14} aria-hidden="true" />
              </button>
            </header>
            <ol aria-label="Muscle render order, front to back">
              {layerPreferences.order.map((muscle, index) => {
                const hidden = layerPreferences.hidden.has(muscle);
                const label = MUSCLE_BY_ID[muscle].label;
                return (
                  <li key={muscle} className={hidden ? "is-hidden" : ""}>
                    <button
                      type="button"
                      className="anatomy-layer-visibility"
                      aria-label={`${hidden ? "Show" : "Hide"} ${label}`}
                      aria-pressed={!hidden}
                      title={`${hidden ? "Show" : "Hide"} ${label}`}
                      onClick={() => toggleLayer(muscle)}
                    >
                      {hidden ? (
                        <EyeOff size={14} aria-hidden="true" />
                      ) : (
                        <Eye size={14} aria-hidden="true" />
                      )}
                    </button>
                    <span>{label}</span>
                    <div className="anatomy-layer-move">
                      <button
                        type="button"
                        aria-label={`Move ${label} forward`}
                        title="Move forward"
                        disabled={index === 0}
                        onClick={() => moveLayer(muscle, -1)}
                      >
                        <ChevronUp size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${label} backward`}
                        title="Move backward"
                        disabled={index === layerPreferences.order.length - 1}
                        onClick={() => moveLayer(muscle, 1)}
                      >
                        <ChevronDown size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ) : null}
      </div>
      <span className="sr-only" aria-live="polite">
        {hovered ? MUSCLE_BY_ID[hovered].label : ""}
      </span>
    </div>
  );
}
