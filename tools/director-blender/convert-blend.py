"""Run inside Blender with --disable-autoexec. Never save the source project."""
import sys
from pathlib import Path
import bpy


def convert(source, destination):
    source = Path(source).resolve(strict=True)
    destination = Path(destination).resolve()
    if source.suffix.lower() != '.blend' or destination.suffix.lower() != '.glb':
        raise ValueError('Expected a .blend source and .glb destination')
    if destination.exists():
        raise FileExistsError('Choose a new output filename; existing files are not overwritten')
    if not destination.parent.is_dir():
        raise ValueError('Output directory does not exist')
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
    result = bpy.ops.export_scene.gltf(filepath=str(destination), export_format='GLB',
                                       use_visible=True, export_animations=False,
                                       export_cameras=False, export_lights=False)
    if 'FINISHED' not in result or not destination.is_file():
        raise RuntimeError('GLB export failed')
    print('DIRECTOR_CONVERSION_OK')


if __name__ == '__main__':
    arguments = sys.argv[sys.argv.index('--') + 1:]
    if len(arguments) != 2:
        raise ValueError('Expected source and destination after --')
    convert(*arguments)
