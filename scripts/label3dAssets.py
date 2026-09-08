#!/usr/bin/env python3
"""Label 3D asset folders with reusable semantic metadata via an AI CLI."""

from __future__ import annotations

import argparse
import contextlib
import json
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
MODEL_EXTENSIONS = {".glb", ".gltf"}
SOCKET_DIRECTIONS = {"north", "east", "south", "west", "top", "bottom", "front", "back", "left", "right"}
KNOWN_KINDS = {
    "road_tile",
    "building",
    "building_part",
    "vegetation",
    "traffic_sign",
    "prop",
    "vehicle",
    "character",
    "terrain",
    "unknown",
}
ROTATION_STEPS = {1, 5, 15, 30, 45, 90, 180, 360}
REVIEW_STATUSES = {"needs_review", "approved"}
PLACEMENT_SIDES = {"left", "right", "both"}
FACE_TOWARD_VALUES = {"road", "incoming_lane", "away_from_road", "random"}
SCRIPT_NAME = "scripts/label3dAssets.py"


@dataclass(frozen=True)
class AssetFolder:
    folder: Path
    metadata_file: Path
    metadata: dict[str, Any]
    model_files: list[Path]
    image_files: list[Path]


def main() -> int:
    args = parse_args()
    asset_root = args.asset_root.resolve()
    repo_root = Path.cwd().resolve()
    generated_by = args.generated_by or f"{args.provider}-cli"

    if not asset_root.exists():
        print(f"Asset path does not exist: {asset_root}", file=sys.stderr)
        return 2

    folders = discover_asset_folders(asset_root)
    if args.limit is not None:
        folders = folders[: args.limit]

    if not folders:
        print(f"No asset.json files found under {asset_root}", file=sys.stderr)
        return 1

    if args.render_previews and shutil.which(args.blender_bin) is None:
        print(f"warning: {args.blender_bin} was not found; using existing preview images only", file=sys.stderr)

    with preview_workspace(args) as preview_dir:
        changed = 0
        skipped = 0
        for asset in folders:
            asset_id = str(asset.metadata.get("id") or asset.folder.name)
            if asset.metadata.get("semantics") and not args.force:
                skipped += 1
                print(f"skip {asset_id}: semantics already exist")
                continue

            working_asset = with_rendered_preview(args, asset, preview_dir)
            prompt = build_prompt(working_asset, repo_root, args.provider)
            if args.prompt_only:
                print(f"\n--- {asset_id} ---\n{prompt}")
                continue

            try:
                raw = run_ai_cli(args, working_asset, prompt, repo_root)
                semantics = parse_json_object(raw)
                normalized = normalize_semantics(semantics)
            except Exception as error:
                print(f"error {asset_id}: {error}", file=sys.stderr)
                continue

            next_metadata = dict(asset.metadata)
            next_metadata["semantics"] = with_generation_marker(normalized, generated_by)

            if args.dry_run:
                print(f"\n--- {asset.metadata_file} ---")
                print(json.dumps(next_metadata, indent=2, ensure_ascii=False))
            else:
                asset.metadata_file.write_text(json.dumps(next_metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                print(f"labeled {asset_id}")
            changed += 1

    print(f"\nProcessed {len(folders)} assets: {changed} labeled, {skipped} skipped.")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Use an AI CLI to add reusable 3D semantic labels to asset.json files.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("asset_root", type=Path, help="Asset pack folder, or any folder containing asset.json files.")
    parser.add_argument("--provider", choices=("claude", "codex"), default="claude", help="AI CLI provider.")
    parser.add_argument("--claude-bin", default="claude", help="Claude CLI executable.")
    parser.add_argument("--codex-bin", default="codex", help="Codex CLI executable.")
    parser.add_argument("--model", help="Optional model name passed to the selected provider.")
    parser.add_argument("--dry-run", action="store_true", help="Print updated asset.json content instead of writing files.")
    parser.add_argument("--force", action="store_true", help="Relabel assets that already have a semantics block.")
    parser.add_argument("--limit", type=positive_int, help="Only process the first N discovered assets.")
    parser.add_argument("--prompt-only", action="store_true", help="Print prompts without calling an AI CLI or writing files.")
    parser.add_argument("--render-previews", action="store_true", help="Render temporary GLB/GLTF preview images with Blender before calling an AI CLI.")
    parser.add_argument("--blender-bin", default="blender", help="Blender executable used by --render-previews.")
    parser.add_argument("--generated-by", help="Value stored in semantics.extensions.labeling.generatedBy.tool.")
    return parser.parse_args()


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("must be greater than 0")
    return parsed


def discover_asset_folders(root: Path) -> list[AssetFolder]:
    metadata_files = sorted(root.rglob("asset.json"))
    folders: list[AssetFolder] = []

    for metadata_file in metadata_files:
        folder = metadata_file.parent
        metadata = json.loads(metadata_file.read_text(encoding="utf-8"))
        files = sorted(path for path in folder.iterdir() if path.is_file())
        model_files = [path for path in files if path.suffix.lower() in MODEL_EXTENSIONS]
        image_files = [path for path in files if path.suffix.lower() in IMAGE_EXTENSIONS]
        folders.append(AssetFolder(folder, metadata_file, metadata, model_files, image_files))

    return folders


def build_prompt(asset: AssetFolder, repo_root: Path, provider: str) -> str:
    relative_folder = relative_to(asset.folder, repo_root)
    model_names = [path.name for path in asset.model_files]
    image_names = [path.name for path in asset.image_files]
    existing_metadata = {key: value for key, value in asset.metadata.items() if key != "semantics"}

    if not image_names:
        visual_hint = "No preview image is available; infer conservatively from filenames and metadata."
    elif provider == "codex":
        visual_hint = "Use the attached preview image(s) as the primary evidence."
    else:
        visual_hint = "Preview image files are in the asset folder; inspect them if your CLI supports visual/file reading. Otherwise infer conservatively from filenames and metadata."

    return f"""You are labeling one reusable 3D asset for a procedural city/scene generator.

Return ONLY one JSON object. Do not include markdown, prose, comments, or code fences.

Asset folder: {relative_folder}
Existing metadata:
{json.dumps(existing_metadata, indent=2, ensure_ascii=False)}
Model files: {json.dumps(model_names)}
Preview image files: {json.dumps(image_names)}
Visual evidence: {visual_hint}

Create a reusable semantic label for this asset. Do not describe one specific scene.

Use this JSON shape:
{{
  "schemaVersion": 1,
  "kind": "road_tile | building | building_part | vegetation | traffic_sign | prop | vehicle | character | terrain | unknown",
  "label": "short human-readable semantic label",
  "description": "short reusable visual/functional description",
  "roles": ["road.surface"],
  "sockets": {{
    "north": {{ "type": "road", "profile": "two_lane_asphalt", "lanes": 2, "agents": ["vehicle"] }},
    "top": {{ "type": "stack", "accepts": ["building.floor", "building.roof"] }}
  }},
  "rotation": {{ "allowed": true, "stepDegrees": 90 }},
  "footprint": {{ "width": 1, "depth": 1, "height": 1 }},
  "stacking": {{ "allowed": false, "maxHeight": 1, "requiresSupport": false }},
  "anchors": [
    {{
      "id": "top",
      "position": {{ "x": 0, "y": 1, "z": 0 }},
      "accepts": ["building_part", "roof_prop"]
    }}
  ],
  "wfc": {{
    "weight": 1,
    "allowedZones": ["residential", "commercial", "park"],
    "forbiddenZones": ["roadway", "intersection"],
    "preferNeighbors": [
      {{ "direction": "east", "roles": ["sidewalk"], "socketTypes": ["curb"] }}
    ],
    "minDistanceByRole": {{ "traffic.sign": 1 }},
    "randomYaw": true,
    "requiresSupport": false,
    "maxStackHeight": 8,
    "attachTo": ["intersection.approach"],
    "placementSide": ["right"],
    "faceToward": "incoming_lane"
  }},
  "extensions": {{}},
  "confidence": 0.0,
  "reviewStatus": "needs_review"
}}

Rules:
- schemaVersion must be 1.
- Use kind "traffic_sign" for stop signs, yield signs, lights, speed signs, and crosswalk signs.
- Use roles as the generator contract. Use top-level asset.json tags only for search; do not return tags inside this object.
- Use sockets for visual connectivity in the asset's unrotated local orientation.
- Valid socket directions are north, east, south, west, top, bottom, front, back, left, right.
- If the asset is a road tile, road sockets describe its unrotated local topology.
- If the asset can be turned to face different directions, set rotation.allowed true and choose a stepDegrees value.
- Use an empty sockets object for assets without connector or attachment surfaces.
- Use approximate footprint dimensions in grid cells; use height for vertical stacking decisions.
- Include stacking and anchors only when a generator could attach or stack another asset there.
- Use wfc only for optional materialization hints such as weights, neighbor preferences, frontage, scatter spacing, support, facing, or zone constraints.
- Put type-specific future data under extensions using namespaced keys. Do not invent new core fields.
- Set reviewStatus to "needs_review" unless the asset is completely obvious from the visual evidence.
- Set confidence lower when inferring only from filenames.
"""


@contextlib.contextmanager
def preview_workspace(args: argparse.Namespace):
    if not args.render_previews or args.prompt_only:
        yield None
        return

    with tempfile.TemporaryDirectory(prefix="label3d-assets-") as directory:
        yield Path(directory)


def with_rendered_preview(args: argparse.Namespace, asset: AssetFolder, preview_dir: Path | None) -> AssetFolder:
    if not args.render_previews or preview_dir is None or shutil.which(args.blender_bin) is None:
        return asset

    preview = render_model_preview(args.blender_bin, asset, preview_dir)
    if preview is None:
        return asset

    return AssetFolder(
        folder=asset.folder,
        metadata_file=asset.metadata_file,
        metadata=asset.metadata,
        model_files=asset.model_files,
        image_files=[preview, *asset.image_files],
    )


def render_model_preview(blender_bin: str, asset: AssetFolder, preview_dir: Path) -> Path | None:
    if not asset.model_files:
        return None

    model_file = asset.model_files[0]
    output_file = preview_dir / f"{asset.folder.name}.png"
    script = blender_preview_script(model_file, output_file)
    result = subprocess.run([blender_bin, "--background", "--python-expr", script], text=True, capture_output=True, check=False)
    if result.returncode != 0 or not output_file.exists():
        message = result.stderr.strip() or result.stdout.strip() or f"Blender exited with status {result.returncode}"
        print(f"warning: could not render {asset.folder.name}: {message}", file=sys.stderr)
        return None

    return output_file


def blender_preview_script(model_file: Path, output_file: Path) -> str:
    model = json.dumps(str(model_file))
    output = json.dumps(str(output_file))
    return f"""
import math
import bpy
from mathutils import Vector

model_file = {model}
output_file = {output}

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
bpy.ops.import_scene.gltf(filepath=model_file)

meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
if not meshes:
    raise SystemExit(2)

corners = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
min_corner = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
max_corner = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
center = (min_corner + max_corner) * 0.5
size = max_corner - min_corner
radius = max(size.x, size.y, size.z, 0.001)

camera_data = bpy.data.cameras.new("LabelPreviewCamera")
camera_data.type = "ORTHO"
camera_data.ortho_scale = radius * 1.8
camera = bpy.data.objects.new("LabelPreviewCamera", camera_data)
bpy.context.collection.objects.link(camera)
camera.location = center + Vector((radius * 1.2, -radius * 1.4, radius * 0.9))
direction = center - camera.location
camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
bpy.context.scene.camera = camera

light_data = bpy.data.lights.new("LabelPreviewKey", "AREA")
light_data.energy = 450
light_data.size = radius * 3
light = bpy.data.objects.new("LabelPreviewKey", light_data)
bpy.context.collection.objects.link(light)
light.location = center + Vector((radius, -radius, radius * 2))

bpy.context.scene.world.color = (0.78, 0.80, 0.84)
bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [item.identifier for item in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
bpy.context.scene.render.resolution_x = 1024
bpy.context.scene.render.resolution_y = 1024
bpy.context.scene.render.film_transparent = False
bpy.context.scene.render.filepath = output_file
bpy.ops.render.render(write_still=True)
"""


def run_ai_cli(args: argparse.Namespace, asset: AssetFolder, prompt: str, repo_root: Path) -> str:
    if args.provider == "codex":
        return run_codex(args, asset, prompt, repo_root)
    if args.provider == "claude":
        return run_claude(args, prompt, repo_root)
    raise ValueError(f"Unsupported provider: {args.provider}")


def run_codex(args: argparse.Namespace, asset: AssetFolder, prompt: str, repo_root: Path) -> str:
    command = [
        args.codex_bin,
        "exec",
        "--ephemeral",
        "--ask-for-approval",
        "never",
        "--sandbox",
        "read-only",
        "-C",
        str(repo_root),
    ]

    if args.model:
        command.extend(["--model", args.model])

    for image_file in asset.image_files[:3]:
        command.extend(["--image", str(image_file)])

    command.append("-")
    result = subprocess.run(command, input=prompt, text=True, capture_output=True, check=False)
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or f"Codex exited with status {result.returncode}"
        raise RuntimeError(message)
    return result.stdout


def run_claude(args: argparse.Namespace, prompt: str, repo_root: Path) -> str:
    command = [
        args.claude_bin,
        "--print",
        "--input-format",
        "text",
        "--output-format",
        "text",
    ]

    if args.model:
        command.extend(["--model", args.model])

    result = subprocess.run(command, input=prompt, text=True, capture_output=True, check=False, cwd=repo_root)
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or f"Claude exited with status {result.returncode}"
        raise RuntimeError(message)
    return result.stdout


def parse_json_object(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:].strip()

    start = text.find("{")
    if start < 0:
        raise ValueError("AI CLI response did not contain a JSON object")

    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                value = json.loads(text[start : index + 1])
                if not isinstance(value, dict):
                    raise ValueError("Codex response JSON was not an object")
                return value

    raise ValueError("Codex response contained incomplete JSON")


def normalize_semantics(value: dict[str, Any]) -> dict[str, Any]:
    footprint = value.get("footprint") if isinstance(value.get("footprint"), dict) else {}
    anchors = value.get("anchors") if isinstance(value.get("anchors"), list) else []
    wfc = value.get("wfc") if isinstance(value.get("wfc"), dict) else None

    normalized = {
        "schemaVersion": 1,
        "kind": known_kind(value.get("kind")),
        "label": string_value(value.get("label"), "Unlabeled asset"),
        "description": string_value(value.get("description"), ""),
        "roles": string_list(value.get("roles")),
        "sockets": normalize_sockets(value),
        "rotation": normalize_rotation(value),
        "footprint": {
            "width": positive_number(footprint.get("width"), 1),
            "depth": positive_number(footprint.get("depth"), 1),
            "height": positive_number(footprint.get("height"), 1),
        },
        "stacking": normalize_stacking(value),
        "anchors": [normalize_anchor(anchor) for anchor in anchors if isinstance(anchor, dict)],
        "extensions": normalize_extensions(value),
        "confidence": clamp_number(value.get("confidence"), 0, 1, 0),
        "reviewStatus": review_status(value.get("reviewStatus")),
    }
    if wfc:
        normalized["wfc"] = normalize_wfc(wfc)
    return normalized


def known_kind(value: Any) -> str:
    kind = string_value(value, "unknown")
    return kind if kind in KNOWN_KINDS else "unknown"


def string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def normalize_sockets(value: dict[str, Any]) -> dict[str, Any]:
    sockets = value.get("sockets") if isinstance(value.get("sockets"), dict) else {}

    if not sockets:
        connections = value.get("canonicalConnections") if isinstance(value.get("canonicalConnections"), list) else []
        sockets = {direction: {"type": "road"} for direction in connections}

    normalized: dict[str, Any] = {}
    for direction, socket in sockets.items():
        if direction not in SOCKET_DIRECTIONS or not isinstance(socket, dict):
            continue
        normalized_socket = {"type": string_value(socket.get("type"), "generic")}
        if isinstance(socket.get("profile"), str) and socket["profile"].strip():
            normalized_socket["profile"] = socket["profile"].strip()
        if socket.get("lanes") is not None:
            lanes = int_value(socket.get("lanes"), 0)
            if lanes > 0:
                normalized_socket["lanes"] = lanes
        agents = [agent for agent in string_list(socket.get("agents")) if agent in {"vehicle", "pedestrian", "bicycle"}]
        if agents:
            normalized_socket["agents"] = agents
        accepts = string_list(socket.get("accepts"))
        if accepts:
            normalized_socket["accepts"] = accepts
        normalized[direction] = normalized_socket
    return normalized


def normalize_rotation(value: dict[str, Any]) -> dict[str, Any]:
    rotation = value.get("rotation") if isinstance(value.get("rotation"), dict) else {}
    allowed = rotation.get("allowed", value.get("rotatable", True))
    step = int_value(rotation.get("stepDegrees", value.get("rotationStepDegrees", 90)), 90)
    if step not in ROTATION_STEPS:
        step = 90
    return {"allowed": bool(allowed), "stepDegrees": step}


def normalize_stacking(value: dict[str, Any]) -> dict[str, Any]:
    stacking = value.get("stacking") if isinstance(value.get("stacking"), dict) else {}
    allowed = stacking.get("allowed", value.get("stackable", False))
    normalized = {"allowed": bool(allowed)}
    if stacking.get("maxHeight") is not None:
        max_height = positive_number(stacking.get("maxHeight"), 1)
        normalized["maxHeight"] = max_height
    if stacking.get("requiresSupport") is not None:
        normalized["requiresSupport"] = bool(stacking.get("requiresSupport"))
    return normalized


def normalize_anchor(anchor: dict[str, Any]) -> dict[str, Any]:
    position = anchor.get("position") if isinstance(anchor.get("position"), dict) else {}
    return {
        "id": string_value(anchor.get("id"), "anchor"),
        "position": {
            "x": number_value(position.get("x"), 0),
            "y": number_value(position.get("y"), 0),
            "z": number_value(position.get("z"), 0),
        },
        "accepts": string_list(anchor.get("accepts")),
    }


def normalize_wfc(wfc: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    if wfc.get("weight") is not None:
        normalized["weight"] = positive_number(wfc.get("weight"), 1)

    for key in ("allowedZones", "forbiddenZones", "requiresFrontage", "attachTo"):
        values = string_list(wfc.get(key))
        if values:
            normalized[key] = values

    for key in ("forbidNeighbors", "preferNeighbors"):
        rules = wfc.get(key)
        if isinstance(rules, list):
            normalized_rules = [normalize_neighbor_rule(rule) for rule in rules if isinstance(rule, dict)]
            normalized_rules = [rule for rule in normalized_rules if rule]
            if normalized_rules:
                normalized[key] = normalized_rules

    for key in ("minDistanceByRole", "maxCountPerZone"):
        values = normalize_positive_number_map(wfc.get(key))
        if values:
            normalized[key] = values

    if wfc.get("randomYaw") is not None:
        normalized["randomYaw"] = bool(wfc.get("randomYaw"))
    if wfc.get("requiresSupport") is not None:
        normalized["requiresSupport"] = bool(wfc.get("requiresSupport"))
    if wfc.get("maxStackHeight") is not None:
        normalized["maxStackHeight"] = positive_number(wfc.get("maxStackHeight"), 1)

    placement_side = [side for side in string_list(wfc.get("placementSide")) if side in PLACEMENT_SIDES]
    if placement_side:
        normalized["placementSide"] = placement_side

    face_toward = string_value(wfc.get("faceToward"), "")
    if face_toward in FACE_TOWARD_VALUES:
        normalized["faceToward"] = face_toward

    return normalized


def normalize_neighbor_rule(rule: dict[str, Any]) -> dict[str, Any]:
    direction = string_value(rule.get("direction"), "")
    if direction not in SOCKET_DIRECTIONS:
        return {}
    normalized: dict[str, Any] = {"direction": direction}
    for key in ("roles", "socketTypes", "socketProfiles"):
        values = string_list(rule.get(key))
        if values:
            normalized[key] = values
    return normalized


def normalize_positive_number_map(value: Any) -> dict[str, float]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, float] = {}
    for key, raw in value.items():
        if not isinstance(key, str) or not key.strip():
            continue
        parsed = positive_number(raw, 0)
        if parsed > 0:
            normalized[key.strip()] = parsed
    return normalized


def normalize_extensions(value: dict[str, Any]) -> dict[str, Any]:
    extensions = value.get("extensions") if isinstance(value.get("extensions"), dict) else {}
    normalized = dict(extensions)
    core_fields = {
        "schemaVersion",
        "kind",
        "label",
        "description",
        "roles",
        "sockets",
        "rotation",
        "footprint",
        "stacking",
        "anchors",
        "wfc",
        "extensions",
        "confidence",
        "reviewStatus",
        "canonicalConnections",
        "rotatable",
        "rotationStepDegrees",
        "stackable",
        "tags",
    }
    extra = {key: raw for key, raw in value.items() if key not in core_fields}
    if extra:
        normalized["unrecognized"] = extra
    return normalized


def with_generation_marker(semantics: dict[str, Any], tool: str) -> dict[str, Any]:
    result = dict(semantics)
    extensions = dict(result.get("extensions") if isinstance(result.get("extensions"), dict) else {})
    labeling = dict(extensions.get("labeling") if isinstance(extensions.get("labeling"), dict) else {})
    labeling["generatedBy"] = {
        "tool": tool,
        "script": SCRIPT_NAME,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
    extensions["labeling"] = labeling
    result["extensions"] = extensions
    return result


def review_status(value: Any) -> str:
    return value if value in REVIEW_STATUSES else "needs_review"


def string_value(value: Any, fallback: str) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else fallback


def int_value(value: Any, fallback: int) -> int:
    if isinstance(value, bool):
        return fallback
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def positive_number(value: Any, fallback: float) -> float:
    parsed = number_value(value, fallback)
    return parsed if parsed > 0 else fallback


def number_value(value: Any, fallback: float) -> float:
    if isinstance(value, bool):
        return fallback
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def clamp_number(value: Any, minimum: float, maximum: float, fallback: float) -> float:
    parsed = number_value(value, fallback)
    return min(max(parsed, minimum), maximum)


def relative_to(path: Path, root: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


if __name__ == "__main__":
    raise SystemExit(main())
