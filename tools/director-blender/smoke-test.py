"""Generate our own cube fixture, then test real Blender export without user data."""
import sys
import importlib.util
from pathlib import Path
import bpy

root = Path(__file__).resolve().parents[2]
target = root / 'artifacts' / 'director-format-test'
target.mkdir(parents=True, exist_ok=True)
blend = target / 'fixture-cube.blend'
glb = target / 'fixture-cube.glb'
fbx = target / 'fixture-cube.fbx'
if any(path.exists() for path in (blend, glb, fbx)):
    raise RuntimeError('Smoke fixtures already exist; refusing to overwrite')
bpy.ops.wm.read_factory_settings(use_empty=False)
bpy.ops.wm.save_as_mainfile(filepath=str(blend))
bpy.ops.export_scene.fbx(filepath=str(fbx), object_types={'MESH'}, bake_anim=False)
spec = importlib.util.spec_from_file_location('director_convert', Path(__file__).with_name('convert-blend.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.convert(blend, glb)
print('DIRECTOR_FORMAT_SMOKE_OK')
