# Road car pack

11 standalone cars: compact, coupe, hatchback, minivan, offroad, pickup, sedan,
sport, SUV, wagon, and Tesla Model 3.

Each car folder contains:

- `<car>.glb`: one complete car, with its required textures embedded.
- `vehicle.json`: named parts, wheel hubs/radii, lamp controls, dimensions,
  approximate collision box, source attribution, and preparation notes.
- `asset.json`: metadata for the existing asset catalog.
- `preview.png`, `preview-rear.png`, `preview-side.png`: rendered views.

`manifest.json` lists the model and metadata paths. `validation.json` records
Khronos glTF validation and structural checks for each exported model.

## Coordinates and moving parts

All cars use meters, +Y up, +Z forward, and +X on the driver's left. The origin is
on the ground below the midpoint of the axles. A visual transform is not a center
of mass: offset the visual root relative to the rigid body if the physics engine
places that body at its center of mass.

```text
CarRoot
├── Chassis
│   ├── Body / Paint and other fixed surfaces
│   ├── Glass
│   ├── Headlight_L / Headlight_R
│   ├── Taillight_L / Taillight_R
│   ├── Indicator_FL / Indicator_FR
│   ├── Indicator_RL / Indicator_RR
│   └── ReverseLight_L / ReverseLight_R (passenger cars)
└── Wheels
    ├── Suspension_FL
    │   └── Steering_FL
    │       └── Wheel_FL
    ├── Suspension_FR → Steering_FR → Wheel_FR
    ├── Suspension_RL → Steering_RL → Wheel_RL
    └── Suspension_RR → Steering_RR → Wheel_RR
```

Move `CarRoot` with the vehicle's rigid body. Move each `Suspension_*` along Y
relative to its rest position in `vehicle.json`. Rotate `Steering_FL/FR` around Y
for front-wheel steering. Rotate each `Wheel_*` around its local X axis for spin.
The rear steering nodes are supplied for a consistent hierarchy; normal rear
wheels keep zero steering angle. Tire and rim surfaces rotate together.

The GLBs contain visual parts, not an implemented vehicle simulation. The
collision box is an initial approximation in car-root coordinates. Mass, center
of mass, inertia, suspension travel, springs, dampers, tires, drivetrain, and
controls still need to be configured by the simulator. No physical values have
been inferred merely from the appearance of the meshes.

## Lights

Each listed lamp has a separate named material, initially with zero emission.
Use its `emissiveOn` RGB value from `vehicle.json` and vary emissive intensity.
Toggle the front/rear indicators on one side together for turn signals; toggle
both sides for hazards. Use the taillight lens at lower intensity for running
lights and higher intensity for brakes. There is no separate brake lens.

Emission makes the lens visible; it does not project a beam onto the road. Add
spotlights at the recorded headlight positions when needed. No real light sources,
shadows, blink animations, or bloom are included in these GLBs.

When cloning a loaded car in Three.js, clone the materials whose colors or light
states must differ per car. Ordinary object cloning shares materials. Geometry
and textures can remain shared.

## Paint

Passenger-car body textures and UVs are preserved. Tinting the complete body
material also affects textured trim; a dedicated paint mask has not been created.
The Tesla has a separate untextured `Paint` material for direct color changes.

## Preparation and limits

Passenger vehicles were extracted with their original four wheel assemblies.
Their display arrangement and scene scale were removed, and model dimensions
were interpreted as millimeters before conversion to meters. The exported size
is a practical asset convention, not calibrated real-world vehicle measurements.
All 69,280 source vehicle triangles are preserved; the pack's display ground is
excluded. The shared optics atlas was used to split red, amber, and white lens
faces into individual controls. No texture resampling was needed.

The Tesla `model3-chassis-low.glb` has no wheels and contains inconsistent
transforms: nine assembled body meshes and five tiny detached meshes whose
original placements are unavailable. The export uses the assembled body and
matching `tesla_model3/wheel.glb`. Wheel hubs/radii were fitted visually to the
arches; body length was set to 4.69 m. These are approximate fit choices.

The Tesla's existing assembled front lenses provide the headlights. Front and
rear indicator bands were assigned from existing lens faces; their shapes and
colors are approximations, not an exact factory lamp layout. The five misplaced
source parts are omitted and named in `tesla-model-3/vehicle.json`. The source
does not supply an independently identifiable reverse-light lens.

Passenger models have 6,022–7,951 triangles each. The Tesla with its companion
wheels has 22,661 triangles. Separating lamps increases draw calls, so these
exports prioritize independently controllable parts. They are not instanced or
LOD-optimized. Source geometry and textures are unchanged except for the
documented transforms, lens separation, and Tesla preparation.

## Attribution

Attribution below is copied from embedded source metadata. Changes are described
above and in each car's `vehicle.json`; original source files are preserved.

Generic passenger car pack: Comrade1280, **CC BY 4.0**.

- Author: https://sketchfab.com/comrade1280
- Source: https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5
- License: https://creativecommons.org/licenses/by/4.0/

Tesla companion wheel: iSteven, **CC BY-NC 4.0** (noncommercial).

- Author: https://sketchfab.com/OneSteven
- Source: https://sketchfab.com/3d-models/tesla-model-3-117d7dbdd6f94df9886c42995cdd06db
- License: https://creativecommons.org/licenses/by-nc/4.0/

The low chassis GLB contains no embedded attribution/license declaration. Its
provenance remains the supplied local file; the wheel's attribution does not
establish a separate license for the chassis.
