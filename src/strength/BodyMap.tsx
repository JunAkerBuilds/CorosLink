import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  Box3,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry
} from "three";
import {
  BODY_PARTS,
  FIGURE_HEIGHT,
  MUSCLE_PATCHES,
  BodySegment,
  buildMusclePatch,
  buildTube,
  normalizeAngle
} from "./bodyGeometry";
import { MUSCLE_BY_ID, type MuscleId } from "./muscles";
import {
  heatLevel,
  metricValue,
  type HeatMetric,
  type MuscleStat
} from "./strengthAnalytics";

export type BodyView = "front" | "back";

interface BodyMapProps {
  view: BodyView;
  /** Changes for every explicit Front/Back command, including a command for
   *  the already-selected semantic side. */
  viewRequest: number;
  metric: HeatMetric;
  muscleById: Record<MuscleId, MuscleStat>;
  max: number;
  selected: MuscleId | null;
  hovered: MuscleId | null;
  onHover: (muscle: MuscleId | null) => void;
  onSelect: (muscle: MuscleId) => void;
  /** Fired when a drag turns the figure past its side, so the Front/Back
   *  control keeps agreeing with what is actually on screen. */
  onViewChange?: (view: BodyView) => void;
}

/** Radians of turn per pixel dragged — deliberate enough for muscle picking. */
const ROTATE_PER_PX = 0.0045;
const PITCH_PER_PX = 0.0035;
const PITCH_MIN = -0.2;
const PITCH_MAX = 0.34;
/** Pointer travel below this still counts as a click, not a drag. */
const CLICK_SLOP = 5;
const FOV = 24;
const TARGET_Y = FIGURE_HEIGHT * 0.5 + 0.02;

const FALLBACK = {
  base: "#3a434c",
  heat: ["#3f4952", "#2fbe91", "#7fbe6a", "#d89b22", "#e5783c", "#e5484d"],
  rim: "#7fe8c4",
  sky: "#93b8dc",
  ground: "#151a1f",
  ambient: 0.5,
  key: 1,
  shadow: 0.5,
  exposure: 1
};

interface Palette {
  base: Color;
  heat: Color[];
  rim: Color;
  sky: Color;
  ground: Color;
  ambient: number;
  /** Multiplier on the three directional lights, so a light theme can drop
   *  the contrast without restating every intensity. */
  key: number;
  shadow: number;
  exposure: number;
}

function readPalette(element: HTMLElement): Palette {
  const style = getComputedStyle(element);
  const color = (name: string, fallback: string) => {
    const raw = style.getPropertyValue(name).trim();
    try {
      return new Color(raw || fallback);
    } catch {
      return new Color(fallback);
    }
  };
  const number = (name: string, fallback: number) => {
    const raw = Number.parseFloat(style.getPropertyValue(name));
    return Number.isFinite(raw) ? raw : fallback;
  };

  return {
    base: color("--m3d-base", FALLBACK.base),
    heat: FALLBACK.heat.map((fallback, level) =>
      color(`--m3d-heat-${level}`, fallback)
    ),
    rim: color("--m3d-rim", FALLBACK.rim),
    sky: color("--m3d-sky", FALLBACK.sky),
    ground: color("--m3d-ground", FALLBACK.ground),
    ambient: number("--m3d-ambient", FALLBACK.ambient),
    key: number("--m3d-key", FALLBACK.key),
    shadow: number("--m3d-shadow", FALLBACK.shadow),
    exposure: number("--m3d-exposure", FALLBACK.exposure)
  };
}

/** Soft elliptical blob used as the figure's contact shadow. */
function createShadowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2
    );
    gradient.addColorStop(0, "rgba(0,0,0,0.85)");
    gradient.addColorStop(0.45, "rgba(0,0,0,0.42)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

interface MuscleGroup {
  material: MeshPhysicalMaterial;
  node: Group;
  target: Color;
  /** Reused each frame so the dim blend never allocates. */
  scratch: Color;
  level: number;
  emissive: number;
  pulse: boolean;
}

interface SculptRuntime {
  nodes: Record<string, Object3D>;
  meshes: Record<string, Mesh>;
  sockets: Record<string, Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, Object3D[]>;
  muscleNodes: Partial<Record<MuscleId, Group>>;
  /** Separates semantic parts by scaling their layout around the body centre. */
  setExploded: (amount: number) => void;
  resolvePart: (object: Object3D) => Object3D | null;
}

/** Colour distance below which a tween has visibly arrived. */
const COLOR_EPSILON = 0.0016;

function colorDistance(a: Color, b: Color): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

interface World {
  dispose: () => void;
  setLevels: (levels: Record<MuscleId, number>) => void;
  setFocus: (hovered: MuscleId | null, selected: MuscleId | null) => void;
  setView: (view: BodyView) => void;
  refreshPalette: () => void;
}

function createWorld(
  container: HTMLDivElement,
  handlers: {
    onHover: (muscle: MuscleId | null) => void;
    onSelect: (muscle: MuscleId) => void;
    onViewChange: (view: BodyView) => void;
  },
  reducedMotion: boolean
): World {
  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance"
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearAlpha(0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;

  const canvas = renderer.domElement;
  canvas.className = "body-map-canvas";
  canvas.style.touchAction = "none";
  canvas.style.cursor = "grab";
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  canvas.setAttribute(
    "aria-label",
    "Rotatable 3D muscle map. Drag or use the arrow keys to turn the figure."
  );
  container.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 100);

  /* Lights live in world space rather than on the figure, so turning the body
     moves it through a fixed studio rig instead of dragging the key light
     along with it. */
  const hemi = new HemisphereLight(0x93b8dc, 0x151a1f, 0.62);
  const key = new DirectionalLight(0xfff8ed, 2.55);
  key.position.set(-2.7, 4.1, 3.6);
  const fill = new DirectionalLight(0xc4dcff, 0.88);
  fill.position.set(3.4, 1.4, 2.7);
  /* A cool rim from behind separates the silhouette from the panel — the same
     job the SVG's edge occlusion used to do. */
  const rim = new DirectionalLight(0x7fe8c4, 1.48);
  rim.position.set(0.7, 2.1, -3.8);
  const KEY_BASE = key.intensity;
  const FILL_BASE = fill.intensity;
  const RIM_BASE = rim.intensity;
  scene.add(hemi, key, fill, rim);

  const figure = new Group();
  figure.name = "strength-muscle-mannequin";
  figure.userData.partId = "root";
  /* The reference's heroic anatomy is broader than a naturalistic seven-head
     template. Apply the measured 12% lateral correction at the shared root so
     muscles, base segments, sockets, colliders and picking surfaces retain
     exact registration with one another. */
  figure.scale.x = 1.12;
  scene.add(figure);

  const geometries: BufferGeometry[] = [];
  const materials: (
    | MeshStandardMaterial
    | MeshPhysicalMaterial
    | MeshBasicMaterial
  )[] = [];
  const pickTargets: Object3D[] = [];
  const nodes: Record<string, Object3D> = { root: figure };
  const meshes: Record<string, Mesh> = {};
  const sockets: Record<string, Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, Object3D[]> = {
    body: [],
    muscles: []
  };
  const explodableParts: Group[] = [];

  const baseMaterial = new MeshPhysicalMaterial({
    color: new Color(FALLBACK.base),
    roughness: 0.48,
    metalness: 0.02,
    clearcoat: 0.16,
    clearcoatRoughness: 0.42
  });
  materials.push(baseMaterial);

  // ---- Base body -------------------------------------------------------
  const segments = new Map<string, BodySegment>();
  for (const [name, part] of Object.entries(BODY_PARTS)) {
    const sides = part.paired ? [false, true] : [false];
    for (const mirrored of sides) {
      const segment = new BodySegment(part.rings, mirrored);
      segments.set(`${name}:${mirrored ? "l" : "r"}`, segment);
      const geometry = buildTube(segment, {
        radial: part.radial,
        axial: part.axial,
        capTop: part.capTop,
        capBottom: part.capBottom
      });
      geometries.push(geometry);
      const side = mirrored ? "left" : part.paired ? "right" : "center";
      const partId = `body-${name}-${side}`;
      const pivot = new Group();
      pivot.name = partId;
      pivot.userData.partId = partId;
      pivot.userData.kind = "body-segment";
      const mesh = new Mesh(geometry, baseMaterial);
      mesh.name = `${partId}-visual`;
      mesh.renderOrder = 0;
      mesh.userData.partId = partId;
      mesh.userData.explodeWithParent = true;
      pivot.add(mesh);
      figure.add(pivot);
      nodes[partId] = pivot;
      meshes[mesh.name] = mesh;
      colliders[partId] = {
        type: name === "head" ? "sphere" : "capsule",
        source: "procedural-ring-envelope",
        isTrigger: false
      };
      destructionGroups.body.push(pivot);
      explodableParts.push(pivot);
      pickTargets.push(mesh);
    }
  }

  // ---- Anatomical base detail -----------------------------------------
  /*
   * The swept envelopes establish a continuous silhouette; these smaller
   * volumes are the landmarks the reference relies on at human scale. They
   * stay children of the existing semantic part pivots, so explode, picking
   * and disposal still agree on what constitutes a hand, head, knee or foot.
   */
  const addBaseDetail = (
    parentId: string,
    name: string,
    geometry: BufferGeometry,
    position: [number, number, number],
    scale: [number, number, number] = [1, 1, 1],
    rotation: [number, number, number] = [0, 0, 0]
  ) => {
    const parent = nodes[parentId];
    if (!(parent instanceof Group)) {
      geometry.dispose();
      return;
    }
    geometries.push(geometry);
    const mesh = new Mesh(geometry, baseMaterial);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    mesh.rotation.set(...rotation);
    mesh.userData.partId = parentId;
    mesh.userData.explodeWithParent = true;
    parent.add(mesh);
    meshes[name] = mesh;
    pickTargets.push(mesh);
  };

  const detailSphere = () => new SphereGeometry(1, 24, 16);
  addBaseDetail(
    "body-head-center",
    "body-head-ear-right",
    detailSphere(),
    [0.174, 3.2, -0.002],
    [0.026, 0.052, 0.018],
    [0, 0, -0.08]
  );
  addBaseDetail(
    "body-head-center",
    "body-head-ear-left",
    detailSphere(),
    [-0.174, 3.2, -0.002],
    [0.026, 0.052, 0.018],
    [0, 0, 0.08]
  );

  for (const sign of [1, -1] as const) {
    const side = sign > 0 ? "right" : "left";
    const handId = `body-hand-${side}`;
    const handX = sign * 0.766;
    addBaseDetail(
      handId,
      `body-hand-${side}-palm`,
      detailSphere(),
      [handX, 1.53, 0.046],
      [0.097, 0.145, 0.06],
      [0.06, 0, -sign * 0.035]
    );
    const fingerOffsets = [-0.054, -0.018, 0.018, 0.052];
    fingerOffsets.forEach((offset, index) => {
      const length = 0.132 + index * 0.009;
      addBaseDetail(
        handId,
        `body-hand-${side}-finger-${index + 1}`,
        new CapsuleGeometry(0.021, length, 5, 10),
        [handX + sign * offset, 1.31 + index * 0.004, 0.052],
        [1, 1, 0.86],
        [0.02 * (index - 1.5), 0, -sign * 0.035 * (index - 1.5)]
      );
    });
    addBaseDetail(
      handId,
      `body-hand-${side}-thumb`,
      new CapsuleGeometry(0.021, 0.118, 5, 10),
      [sign * 0.828, 1.485, 0.065],
      [1, 1, 0.9],
      [0.08, 0, -sign * 0.32]
    );
    addBaseDetail(
      `body-thigh-${side}`,
      `body-knee-${side}-patella`,
      detailSphere(),
      [sign * 0.143, 0.905, 0.096],
      [0.084, 0.122, 0.042]
    );

    const footId = `body-foot-${side}`;
    const toeOffsets = [-0.069, -0.034, 0, 0.033, 0.061];
    toeOffsets.forEach((offset, index) => {
      const size = 1 - index * 0.085;
      addBaseDetail(
        footId,
        `body-foot-${side}-toe-${index + 1}`,
        detailSphere(),
        [sign * (0.132 + offset), 0.036, 0.305 - index * 0.006],
        [0.034 * size, 0.022 * size, 0.062 * size]
      );
    });
  }

  // ---- Muscles ---------------------------------------------------------
  const groups = new Map<MuscleId, MuscleGroup>();
  const groupOf = (id: MuscleId): MuscleGroup => {
    const existing = groups.get(id);
    if (existing) {
      return existing;
    }
    const material = new MeshPhysicalMaterial({
      color: new Color(FALLBACK.heat[0]),
      roughness: 0.34,
      metalness: 0.02,
      clearcoat: 0.34,
      clearcoatRoughness: 0.28,
      emissive: new Color(FALLBACK.heat[0]),
      emissiveIntensity: 0
    });
    materials.push(material);
    const node = new Group();
    node.name = `muscle-${id}`;
    node.userData.partId = node.name;
    node.userData.muscle = id;
    node.userData.kind = "selectable-muscle";
    figure.add(node);
    nodes[node.name] = node;
    destructionGroups.muscles.push(node);
    explodableParts.push(node);
    const group: MuscleGroup = {
      material,
      node,
      target: new Color(FALLBACK.heat[0]),
      scratch: new Color(),
      level: 0,
      emissive: 0,
      pulse: false
    };
    groups.set(id, group);
    return group;
  };

  const musclePatchCounts = new Map<MuscleId, number>();
  for (const def of MUSCLE_PATCHES) {
    const patchIndex = musclePatchCounts.get(def.id) ?? 0;
    musclePatchCounts.set(def.id, patchIndex + 1);
    const sides = def.bilateral ? [false, true] : [false];
    for (const mirrored of sides) {
      const partIsPaired = BODY_PARTS[def.part].paired;
      /* Torso and head are single segments, so a bilateral belly on them
         mirrors its angular span instead of switching segment. */
      const segment = segments.get(
        `${def.part}:${partIsPaired && mirrored ? "l" : "r"}`
      );
      if (!segment) {
        continue;
      }
      const geometry = buildMusclePatch(segment, def, mirrored);
      geometries.push(geometry);
      const group = groupOf(def.id);
      const mesh = new Mesh(geometry, group.material);
      const side = def.bilateral ? (mirrored ? "left" : "right") : "center";
      mesh.name = `muscle-${def.id}-${patchIndex}-${side}`;
      mesh.renderOrder = 1;
      mesh.userData.muscle = def.id;
      mesh.userData.partId = group.node.name;
      mesh.userData.explodeWithParent = true;
      group.node.add(mesh);
      meshes[mesh.name] = mesh;
      pickTargets.push(mesh);
    }
  }

  // ---- Action-ready runtime -------------------------------------------
  const socketDefinitions: Record<string, [number, number, number]> = {
    neck: [0, 2.96, 0],
    "left-shoulder": [0.42, 2.82, 0],
    "right-shoulder": [-0.42, 2.82, 0],
    "left-elbow": [0.55, 2.18, 0],
    "right-elbow": [-0.55, 2.18, 0],
    "left-wrist": [0.65, 1.73, 0],
    "right-wrist": [-0.65, 1.73, 0],
    "left-hip": [0.16, 1.78, 0],
    "right-hip": [-0.16, 1.78, 0],
    "left-knee": [0.14, 0.92, 0],
    "right-knee": [-0.14, 0.92, 0],
    "left-ankle": [0.13, 0.16, 0],
    "right-ankle": [-0.13, 0.16, 0]
  };
  for (const [id, position] of Object.entries(socketDefinitions)) {
    const socket = new Object3D();
    socket.name = `socket-${id}`;
    socket.position.set(...position);
    socket.userData.socketId = id;
    figure.add(socket);
    sockets[id] = socket;
  }

  const modelCenter = new Vector3(0, TARGET_Y, 0);
  const bounds = new Box3();
  const partCenter = new Vector3();
  const explosionVectors = new Map<Group, Vector3>();
  for (const part of explodableParts) {
    bounds.setFromObject(part).getCenter(partCenter);
    const layoutVector = partCenter.clone().sub(modelCenter);
    const distanceFromCenter = layoutVector.length();
    if (distanceFromCenter < 0.04) {
      layoutVector.set(0, 0, part.name.startsWith("muscle-") ? 1 : -1);
    } else {
      layoutVector.normalize();
    }
    explosionVectors.set(
      part,
      layoutVector.multiplyScalar(0.08 + distanceFromCenter * 0.34)
    );
  }

  const runtime: SculptRuntime = {
    nodes,
    meshes,
    sockets,
    colliders,
    destructionGroups,
    muscleNodes: Object.fromEntries(
      [...groups].map(([id, group]) => [id, group.node])
    ) as Partial<Record<MuscleId, Group>>,
    setExploded(amount) {
      const clamped = Math.min(1, Math.max(0, amount));
      for (const part of explodableParts) {
        part.position.copy(explosionVectors.get(part)!).multiplyScalar(clamped);
      }
      figure.userData.explodeAmount = clamped;
      needsRender = true;
      start();
    },
    resolvePart(object) {
      let current: Object3D | null = object;
      while (current && current !== figure) {
        const partId = current.userData.partId;
        if (typeof partId === "string" && nodes[partId]) {
          return nodes[partId];
        }
        current = current.parent;
      }
      return current === figure ? figure : null;
    }
  };
  figure.userData.sculptRuntime = runtime;

  // ---- Contact shadow --------------------------------------------------
  const shadowTexture = createShadowTexture();
  const shadowMaterial = new MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    depthWrite: false,
    opacity: FALLBACK.shadow
  });
  materials.push(shadowMaterial);
  const shadowGeometry = new PlaneGeometry(1, 1);
  geometries.push(shadowGeometry);
  const shadow = new Mesh(shadowGeometry, shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.006;
  shadow.scale.set(1.66, 0.72, 1);
  shadow.renderOrder = -1;
  scene.add(shadow);

  // ---- Palette ---------------------------------------------------------
  let palette = readPalette(container);
  const applyPalette = () => {
    palette = readPalette(container);
    baseMaterial.color.copy(palette.base);
    rim.color.copy(palette.rim);
    hemi.color.copy(palette.sky);
    hemi.groundColor.copy(palette.ground);
    hemi.intensity = palette.ambient;
    key.intensity = KEY_BASE * palette.key;
    fill.intensity = FILL_BASE * palette.key;
    rim.intensity = RIM_BASE * palette.key;
    shadowMaterial.opacity = palette.shadow;
    renderer.toneMappingExposure = palette.exposure;
    for (const group of groups.values()) {
      group.target.copy(palette.heat[group.level] ?? palette.heat[0]);
    }
    needsRender = true;
  };

  // ---- Interaction state ----------------------------------------------
  let rotation = 0;
  let rotationTarget: number | null = null;
  /* True while the figure is turning because the Front/Back control asked it
     to. Facing is reported from user gestures only — reporting mid-snap would
     bounce the control back to the side we are leaving. */
  let snapping = false;
  let spin = 0;
  let pitch = 0.06;
  let facing: BodyView = "front";
  let hoveredId: MuscleId | null = null;
  let selectedId: MuscleId | null = null;
  let externalHover: MuscleId | null = null;
  let needsRender = true;
  let visible = true;
  let frame = 0;
  let clock = 0;
  let last = performance.now();

  const pointer = new Vector2();
  const raycaster = new Raycaster();
  let pointerInside = false;
  let hoverDirty = false;
  let dragging = false;
  let activePointer = -1;
  let lastX = 0;
  let lastY = 0;
  let travel = 0;

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
    const hits = raycaster.intersectObjects(pickTargets, false);
    const muscle = hits.length > 0 ? hits[0].object.userData.muscle : undefined;
    return typeof muscle === "string" ? (muscle as MuscleId) : null;
  };

  const reportFacing = () => {
    const next: BodyView = Math.cos(rotation) >= 0 ? "front" : "back";
    if (next !== facing) {
      facing = next;
      handlers.onViewChange(next);
    }
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }
    dragging = true;
    activePointer = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    travel = 0;
    spin = 0;
    rotationTarget = null;
    snapping = false;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
    start();
  };

  const onPointerMove = (event: PointerEvent) => {
    pointerInside = true;
    updatePointer(event);
    if (!dragging) {
      hoverDirty = true;
      start();
      return;
    }
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    travel += Math.abs(dx) + Math.abs(dy);
    rotation += dx * ROTATE_PER_PX;
    /* Smoothed so the throw after release follows the gesture rather than
       whatever the final pointer event happened to be. */
    spin = Math.max(
      -0.35,
      Math.min(0.35, spin * 0.65 + dx * ROTATE_PER_PX * 60 * 0.01)
    );
    pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, pitch - dy * PITCH_PER_PX));
    reportFacing();
    needsRender = true;
  };

  const endDrag = (event: PointerEvent) => {
    if (!dragging || event.pointerId !== activePointer) {
      return;
    }
    dragging = false;
    activePointer = -1;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    canvas.style.cursor = "grab";
    if (travel < CLICK_SLOP) {
      spin = 0;
      updatePointer(event);
      const hit = pick();
      if (hit) {
        handlers.onSelect(hit);
      }
    } else if (reducedMotion) {
      spin = 0;
    }
    needsRender = true;
  };

  const onPointerLeave = () => {
    pointerInside = false;
    if (!dragging && hoveredId !== null) {
      hoveredId = null;
      handlers.onHover(null);
      needsRender = true;
    }
  };

  const onDoubleClick = () => {
    rotationTarget = rotation + normalizeAngle((facing === "front" ? 0 : Math.PI) - rotation);
    snapping = false;
    pitch = 0.06;
    spin = 0;
    start();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const step = (event.key === "ArrowRight" ? 1 : -1) * (Math.PI / 12);
      rotationTarget = (rotationTarget ?? rotation) + step;
      snapping = false;
      start();
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const step = (event.key === "ArrowUp" ? 1 : -1) * 0.06;
      pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, pitch + step));
      needsRender = true;
      start();
    }
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("dblclick", onDoubleClick);
  canvas.addEventListener("keydown", onKeyDown);

  // ---- Sizing ----------------------------------------------------------
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
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

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

  /* The app pauses decorative motion by class on blur; picking the window back
     up has to restart the loop, or the figure stays frozen. */
  const onVisibility = () => {
    if (!document.hidden) {
      start();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", onVisibility);

  // ---- Frame -----------------------------------------------------------
  /* Distance is derived from the framing rather than fixed, so the figure
     fills whatever height the panel gives it. */
  const distance = (FIGURE_HEIGHT * 1.035) / (2 * Math.tan((FOV * Math.PI) / 360));

  const tick = () => {
    frame = 0;
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (document.hidden || !visible) {
      return;
    }

    const idle = !reducedMotion && !document.body.classList.contains("is-backgrounded");
    if (idle) {
      clock += dt;
    }
    let animating = idle;

    if (dragging) {
      animating = true;
    } else if (Math.abs(spin) > 0.02) {
      rotation += spin * dt;
      spin *= Math.exp(-dt * 4.5);
      reportFacing();
      animating = true;
    } else if (rotationTarget !== null) {
      const delta = rotationTarget - rotation;
      if (Math.abs(delta) < 0.002) {
        rotation = rotationTarget;
        rotationTarget = null;
        snapping = false;
      } else {
        rotation += delta * (1 - Math.exp(-dt * (reducedMotion ? 40 : 9)));
        animating = true;
      }
      if (!snapping) {
        reportFacing();
      }
    }

    if (hoverDirty && !dragging && pointerInside) {
      hoverDirty = false;
      const hit = pick();
      if (hit !== hoveredId) {
        hoveredId = hit;
        handlers.onHover(hit);
      }
      canvas.style.cursor = hit ? "pointer" : "grab";
    }

    // Colour and glow settle toward their targets instead of snapping.
    const active = hoveredId ?? externalHover;
    const colorStep = 1 - Math.exp(-dt * 7);
    const glowStep = 1 - Math.exp(-dt * 8);
    for (const [id, group] of groups) {
      const dim = selectedId !== null && selectedId !== id;
      /* Isolating a muscle washes every other belly back toward the body so
         the selection is the only saturated thing on the figure. */
      const wanted = dim
        ? group.scratch.copy(group.target).lerp(palette.base, 0.62)
        : group.target;
      if (colorDistance(group.material.color, wanted) > COLOR_EPSILON) {
        group.material.color.lerp(wanted, colorStep);
        animating = true;
      } else {
        group.material.color.copy(wanted);
      }
      group.material.emissive.copy(group.material.color);

      const focused = id === active || id === selectedId;
      const pulse =
        group.pulse && idle && !focused
          ? 0.05 * (0.5 + 0.5 * Math.sin(clock * 1.7 + group.level))
          : 0;
      const wantedGlow = (focused ? 0.5 : dim ? 0 : 0.06) + pulse;
      if (Math.abs(group.emissive - wantedGlow) > 0.001) {
        group.emissive += (wantedGlow - group.emissive) * glowStep;
        animating = true;
      } else {
        group.emissive = wantedGlow;
      }
      group.material.emissiveIntensity = group.emissive;
    }

    figure.rotation.y = rotation;
    const bob = idle ? Math.sin(clock * 0.85) * 0.016 : 0;
    figure.position.y = bob;
    shadow.scale.x = 1.66 - bob * 2.4;
    shadow.scale.y = 0.72 - bob * 1.15;

    camera.position.set(
      0,
      TARGET_Y + Math.sin(pitch) * distance,
      Math.cos(pitch) * distance
    );
    camera.lookAt(0, TARGET_Y, 0);

    if (animating || needsRender) {
      needsRender = false;
      renderer.render(scene, camera);
    }

    if (animating || dragging) {
      frame = requestAnimationFrame(tick);
    }
  };

  /* The loop is demand-driven: anything that changes the picture calls
     `start`, and `tick` stops requesting frames once everything has settled
     and the figure is not idling. */
  function start() {
    if (frame !== 0 || document.hidden || !visible) {
      return;
    }
    last = performance.now();
    frame = requestAnimationFrame(tick);
  }

  applyPalette();
  start();

  return {
    dispose() {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endDrag);
      canvas.removeEventListener("pointercancel", endDrag);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("dblclick", onDoubleClick);
      canvas.removeEventListener("keydown", onKeyDown);
      for (const geometry of geometries) {
        geometry.dispose();
      }
      for (const material of materials) {
        material.dispose();
      }
      shadowTexture.dispose();
      renderer.dispose();
      canvas.remove();
    },
    setLevels(levels) {
      for (const [id, group] of groups) {
        const level = levels[id] ?? 0;
        group.level = level;
        group.pulse = level >= 4;
        group.target.copy(palette.heat[level] ?? palette.heat[0]);
      }
      needsRender = true;
      start();
    },
    setFocus(nextHovered, nextSelected) {
      externalHover = nextHovered;
      selectedId = nextSelected;
      needsRender = true;
      start();
    },
    setView(next) {
      const targetAngle = next === "front" ? 0 : Math.PI;
      const delta = normalizeAngle(targetAngle - rotation);
      if (Math.abs(delta) < 0.002) {
        return;
      }
      facing = next;
      snapping = true;
      rotationTarget = rotation + delta;
      spin = 0;
      start();
    },
    refreshPalette: applyPalette
  };
}

export function BodyMap({
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
}: BodyMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<World | null>(null);
  const [failed, setFailed] = useState(false);

  /* Handlers change identity every render; the scene is built once, so it
     reads them through a ref rather than being rebuilt. */
  const handlersRef = useRef({ onHover, onSelect, onViewChange });
  handlersRef.current = { onHover, onSelect, onViewChange };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let world: World;
    try {
      world = createWorld(
        container,
        {
          onHover: (muscle) => handlersRef.current.onHover(muscle),
          onSelect: (muscle) => handlersRef.current.onSelect(muscle),
          onViewChange: (next) => handlersRef.current.onViewChange?.(next)
        },
        Boolean(reducedMotion)
      );
    } catch {
      setFailed(true);
      return;
    }
    worldRef.current = world;

    /* The heat ramp lives in CSS custom properties, so a theme switch has to
       be pulled back into the materials. */
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
    const world = worldRef.current;
    if (!world) {
      return;
    }
    const levels = {} as Record<MuscleId, number>;
    for (const [id, stat] of Object.entries(muscleById) as [MuscleId, MuscleStat][]) {
      levels[id] = heatLevel(metricValue(stat, metric), max);
    }
    world.setLevels(levels);
  }, [metric, max, muscleById]);

  useEffect(() => {
    worldRef.current?.setFocus(hovered, selected);
  }, [hovered, selected]);

  useEffect(() => {
    worldRef.current?.setView(view);
  }, [view, viewRequest]);

  return (
    <div className="body-map" ref={containerRef}>
      {failed ? (
        <p className="body-map-fallback">
          The 3D muscle map needs hardware graphics, which this window could not
          start. The muscle list beside it still covers every group.
        </p>
      ) : (
        <p className="body-map-hint" aria-hidden="true">
          Drag to turn
        </p>
      )}
      <span className="sr-only" aria-live="polite">
        {hovered ? MUSCLE_BY_ID[hovered].label : ""}
      </span>
    </div>
  );
}
