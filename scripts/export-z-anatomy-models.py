"""Export the CorosLink anatomy assets directly from the Z-Anatomy Blender atlas.

Run with Blender, not the system Python:

  Blender --background /path/to/Startup.blend \
    --python scripts/export-z-anatomy-models.py -- \
    --out-dir public/assets/anatomy

The upstream atlas is intentionally not vendored. Download Z-Anatomy.zip from
https://github.com/Z-Anatomy/Models-of-human-anatomy and point Blender at the
contained Startup.blend file.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

import bpy


# These are the surface structures used by the strength heat map. The values
# are exact base names in Z-Anatomy's Startup.blend. Only the atlas's intact
# anatomical-right surface (`.r`, world negative X) is exported; the runtime
# mirrors it for a coherent bilateral body. Origin/end marker meshes are
# deliberately excluded.
MUSCLE_SOURCE_BASES: dict[str, tuple[str, ...]] = {
    "sternocleidomastoid": ("Sternocleidomastoid muscle",),
    "upper_trapezius": ("Descending part of trapezius muscle",),
    "middle_trapezius": ("Transverse part of trapezius muscle",),
    "lower_trapezius": ("Ascending part of trapezius muscle",),
    "deltoid": (
        "Acromial part of deltoid muscle",
        "Clavicular part of deltoid muscle",
    ),
    "posterior_deltoid": ("Scapular spinal part of deltoid muscle",),
    "infraspinatus": ("Infraspinatus muscle",),
    "supraspinatus": ("Supraspinatus muscle",),
    "teres_minor": ("Teres minor muscle",),
    "pectoralis_major": (
        "(Abdominal part of pectoralis major muscle)",
        "Clavicular head of pectoralis major muscle",
        "Sternocostal head of pectoralis major muscle",
    ),
    "latissimus_dorsi": ("Latissimus dorsi muscle",),
    "teres_major": ("Teres major muscle",),
    "levator_scapulae": ("Levator scapulae",),
    "serratus_anterior": ("Serratus anterior muscle",),
    "biceps_brachii": (
        "Long head of biceps brachii",
        "Short head of biceps brachii",
    ),
    "triceps_brachii": (
        "Lateral head of triceps brachii",
        "Long head of triceps brachii",
        "Medial head of triceps brachii",
    ),
    "brachioradialis": ("Brachioradialis muscle",),
    "brachialis": ("Brachialis muscle",),
    "coracobrachialis": ("Coracobrachialis muscle",),
    "pronator_teres": ("Superficial head of pronator teres",),
    "forearm_flexors": (
        "Flexor carpi radialis",
        "Palmaris longus muscle",
        "Humeral head of flexor carpi ulnaris",
        "Ulnar head of flexor carpi ulnaris",
        "Humero-ulnar head of flexor digitorum superficialis",
        "Radial head of flexor digitorum superficialis",
    ),
    "forearm_extensors": (
        "Extensor digitorum",
        "Extensor carpi radialis longus",
        "Extensor carpi radialis brevis",
        "Humeral head of extensor carpi ulnaris",
        "Ulnar head of extensor carpi ulnaris",
    ),
    "anconeus": ("Anconeus muscle",),
    "intrinsic_hand": (
        "Dorsal interossei muscles of hand",
        "Abductor digiti minimi of hand",
        "Abductor pollicis brevis",
        "Opponens pollicis muscle",
    ),
    "rectus_abdominis": ("Rectus abdominis muscle",),
    "external_oblique": ("External abdominal oblique muscle",),
    "erector_spinae_lumbar": (
        "Iliocostalis lumborum muscle",
        "Longissimus thoracis muscle",
    ),
    "gluteus_maximus": ("Gluteus maximus muscle",),
    "gluteus_medius": ("Gluteus medius muscle",),
    "tensor_fasciae_latae": ("Tensor fasciae latae",),
    "rectus_femoris": ("Rectus femoris muscle",),
    "vastus_lateralis": ("Vastus lateralis muscle",),
    "vastus_medialis": ("Vastus medialis muscle",),
    "sartorius": ("Sartorius muscle",),
    "biceps_femoris": (
        "Long head of biceps femoris",
        "Short head of biceps femoris",
    ),
    "semitendinosus": ("Semitendinosus muscle",),
    "semimembranosus": ("Semimembranosus muscle",),
    "adductor_magnus": ("Adductor magnus",),
    "adductor_longus": ("Adductor longus",),
    "adductor_brevis": ("Adductor brevis",),
    "gracilis": ("Gracilis muscle",),
    "pectineus": ("Pectineus muscle",),
    "gastrocnemius": (
        "Lateral head of gastrocnemius",
        "Medial head of gastrocnemius",
    ),
    "soleus": ("Soleus muscle",),
    "peroneals": (
        "Fibularis brevis muscle",
        "Fibularis longus muscle",
    ),
    "tibialis_anterior": ("Tibialis anterior muscle",),
    "lower_leg_extensors": (
        "Extensor digitorum longus",
        "Extensor hallucis longus",
        "Fibularis tertius muscle",
    ),
    "plantaris": ("Plantaris muscle",),
    "intrinsic_foot": (
        "Dorsal interossei muscles of foot",
        "Extensor digitorum brevis",
        "Extensor hallucis brevis",
    ),
}

MUSCLE_FACE_BUDGET = 3_200
SKELETON_OBJECT_FACE_BUDGET = 2_400
SKELETON_TOTAL_FACE_BUDGET = 100_000


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", type=Path, required=True)
    return parser.parse_args(argv)


def deselect_all() -> None:
    bpy.ops.object.select_all(action="DESELECT")


def copy_evaluated_mesh(
    source: bpy.types.Object,
    depsgraph: bpy.types.Depsgraph,
) -> bpy.types.Object:
    if source.modifiers:
        evaluated = source.evaluated_get(depsgraph)
        mesh = bpy.data.meshes.new_from_object(
            evaluated,
            preserve_all_data_layers=True,
            depsgraph=depsgraph,
        )
    else:
        # Almost every source mesh is already final geometry. Copying its mesh
        # directly avoids reevaluating the atlas's entire dependency graph for
        # each of the hundreds of exported objects.
        mesh = source.data.copy()
    copied = bpy.data.objects.new(source.name, mesh)
    bpy.context.scene.collection.objects.link(copied)
    copied.matrix_world = source.matrix_world.copy()

    # Runtime materials are solid colors, so texture/color attributes only add
    # download and GPU cost to these derivatives.
    while mesh.uv_layers:
        mesh.uv_layers.remove(mesh.uv_layers[0])
    while mesh.color_attributes:
        mesh.color_attributes.remove(mesh.color_attributes[0])
    return copied


def make_active(obj: bpy.types.Object) -> None:
    deselect_all()
    obj.hide_set(False)
    obj.hide_render = False
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def decimate_to_budget(obj: bpy.types.Object, face_budget: int) -> None:
    face_count = len(obj.data.polygons)
    if face_count <= face_budget:
        return
    make_active(obj)
    modifier = obj.modifiers.new(name="CorosLink surface budget", type="DECIMATE")
    modifier.decimate_type = "COLLAPSE"
    modifier.ratio = max(0.02, face_budget / face_count)
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def export_glb(objects: list[bpy.types.Object], output: Path) -> None:
    deselect_all()
    for obj in objects:
        obj.hide_set(False)
        obj.hide_render = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    output.parent.mkdir(parents=True, exist_ok=True)
    result = bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_tangents=False,
        export_texcoords=False,
        export_vertex_color="NONE",
        export_materials="EXPORT",
        export_extras=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=7,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"glTF export failed for {output}: {result}")


def remove_objects(objects: list[bpy.types.Object]) -> None:
    deselect_all()
    for obj in objects:
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)


def export_muscles(out_dir: Path) -> None:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    exported: list[bpy.types.Object] = []
    missing: list[str] = []
    for structure_id, bases in MUSCLE_SOURCE_BASES.items():
        for base in bases:
            source_name = f"{base}.r"
            source = bpy.data.objects.get(source_name)
            if source is None or source.type != "MESH":
                missing.append(source_name)
                continue
            copied = copy_evaluated_mesh(source, depsgraph)
            copied["structure_id"] = structure_id
            copied["source_side"] = "right"
            decimate_to_budget(copied, MUSCLE_FACE_BUDGET)
            exported.append(copied)

    linea_alba = bpy.data.objects.get("Linea alba")
    if linea_alba is None or linea_alba.type != "MESH":
        missing.append("Linea alba")
    else:
        copied = copy_evaluated_mesh(linea_alba, depsgraph)
        copied["tissue_role"] = "connective"
        copied["anatomy_id"] = "linea_alba"
        exported.append(copied)

    if missing:
        raise RuntimeError("Missing required Z-Anatomy objects: " + ", ".join(missing))

    export_glb(exported, out_dir / "muscular_lite.glb")
    print(f"Exported {len(exported)} Z-Anatomy muscle/connective objects")
    remove_objects(exported)


def is_source_bone(obj: bpy.types.Object) -> bool:
    return (
        obj.type == "MESH"
        and not obj.hide_render
        and any(material and material.name.startswith("Bone") for material in obj.data.materials)
    )


def export_skeleton(out_dir: Path) -> None:
    system = bpy.data.collections.get("1: Skeletal system")
    if system is None:
        raise RuntimeError("Z-Anatomy collection '1: Skeletal system' was not found")

    depsgraph = bpy.context.evaluated_depsgraph_get()
    bones: list[bpy.types.Object] = []
    for source in system.objects:
        if not is_source_bone(source):
            continue
        copied = copy_evaluated_mesh(source, depsgraph)
        decimate_to_budget(copied, SKELETON_OBJECT_FACE_BUDGET)
        bones.append(copied)

    if not bones:
        raise RuntimeError("No renderable Z-Anatomy bone meshes were found")

    deselect_all()
    for bone in bones:
        bone.select_set(True)
    bpy.context.view_layer.objects.active = bones[0]
    bpy.ops.object.join()
    skeleton = bpy.context.view_layer.objects.active
    skeleton.name = "skeletal_context"
    skeleton.data.name = "skeletal_context"
    skeleton.data.materials.clear()
    material = bpy.data.materials.get("CorosLink Bone") or bpy.data.materials.new(
        "CorosLink Bone"
    )
    skeleton.data.materials.append(material)
    decimate_to_budget(skeleton, SKELETON_TOTAL_FACE_BUDGET)
    for polygon in skeleton.data.polygons:
        polygon.material_index = 0
    skeleton.data.validate(clean_customdata=True)
    skeleton.data.update()
    export_glb([skeleton], out_dir / "skeletal_lite.glb")
    print(
        "Exported direct Z-Anatomy skeleton with "
        f"{len(skeleton.data.polygons)} faces"
    )


def main() -> None:
    args = parse_args()
    export_muscles(args.out_dir)
    export_skeleton(args.out_dir)


if __name__ == "__main__":
    main()
