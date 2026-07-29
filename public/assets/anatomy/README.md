# Z-Anatomy runtime assets

`muscular_lite.glb` and `skeletal_lite.glb` are exported directly from
[Z-Anatomy’s human anatomy atlas](https://github.com/Z-Anatomy/Models-of-human-anatomy),
revision `b16b4c2eb7de824722f5eef9d5f56c5569a3d640`.

The upstream 306 MB Blender atlas is not bundled with CorosLink. To regenerate
the browser assets, extract `Z-Anatomy/Startup.blend` from the upstream
`Z-Anatomy.zip` and run:

```sh
/Applications/Blender.app/Contents/MacOS/Blender \
  --background /path/to/Z-Anatomy/Startup.blend \
  --python scripts/export-z-anatomy-models.py -- \
  --out-dir public/assets/anatomy
```

The exporter selects a complete set of superficial muscles used by the strength
heat map, the original linea alba mesh, and visible bone meshes. Z-Anatomy's
intact anatomical-right surface is mirrored at runtime so the viewer does not
expose the atlas's asymmetric teaching-dissection side. The export adds
CorosLink muscle-group metadata, applies bounded decimation, and
Draco-compresses both GLBs.
