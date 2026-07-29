import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const REQUIRED_STRUCTURES = [
  "adductor_longus",
  "adductor_magnus",
  "adductor_brevis",
  "anconeus",
  "biceps_brachii",
  "biceps_femoris",
  "brachialis",
  "brachioradialis",
  "coracobrachialis",
  "deltoid",
  "erector_spinae_lumbar",
  "external_oblique",
  "forearm_extensors",
  "forearm_flexors",
  "gastrocnemius",
  "gluteus_maximus",
  "gluteus_medius",
  "gracilis",
  "infraspinatus",
  "intrinsic_foot",
  "intrinsic_hand",
  "latissimus_dorsi",
  "levator_scapulae",
  "lower_leg_extensors",
  "lower_trapezius",
  "middle_trapezius",
  "pectoralis_major",
  "pectineus",
  "peroneals",
  "plantaris",
  "posterior_deltoid",
  "pronator_teres",
  "rectus_abdominis",
  "rectus_femoris",
  "sartorius",
  "semimembranosus",
  "semitendinosus",
  "serratus_anterior",
  "soleus",
  "sternocleidomastoid",
  "supraspinatus",
  "tensor_fasciae_latae",
  "teres_major",
  "teres_minor",
  "tibialis_anterior",
  "triceps_brachii",
  "upper_trapezius",
  "vastus_lateralis",
  "vastus_medialis"
];

async function readGlbJson(path) {
  const bytes = await readFile(new URL(path, import.meta.url));
  assert.equal(bytes.toString("ascii", 0, 4), "glTF", `${path} is not a GLB`);
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength).trim());
}

const muscles = await readGlbJson("../public/assets/anatomy/muscular_lite.glb");
const skeleton = await readGlbJson("../public/assets/anatomy/skeletal_lite.glb");
const extras = (muscles.nodes ?? []).flatMap((node) =>
  node.extras ? [node.extras] : []
);
const structures = new Set(extras.map((entry) => entry.structure_id));

for (const structure of REQUIRED_STRUCTURES) {
  assert(structures.has(structure), `missing muscle structure: ${structure}`);
}
assert(
  extras
    .filter((entry) => typeof entry.structure_id === "string")
    .every((entry) => entry.source_side === "right"),
  "muscle structures must come only from the atlas's intact right surface"
);
assert(
  extras.some(
    (entry) =>
      entry.anatomy_id === "linea_alba" && entry.tissue_role === "connective"
  ),
  "missing connective linea alba metadata"
);
assert.equal(skeleton.meshes?.length, 1, "skeleton must remain one batched mesh");
assert(
  muscles.extensionsRequired?.includes("KHR_draco_mesh_compression"),
  "muscle asset must remain Draco-compressed"
);
assert(
  skeleton.extensionsRequired?.includes("KHR_draco_mesh_compression"),
  "skeleton asset must remain Draco-compressed"
);

console.log("Anatomy assets preserve all required structures and linea alba metadata.");
