export const metadata = {
  label: "Low-poly sports car",
  category: "vehicles",
  tags: ["car", "sports", "low-poly", "vehicle"]
};

export function createAsset({ THREE }) {
  const group = new THREE.Group();
  group.name = "Low-poly sports car";
  group.rotation.y = Math.PI;

  const materials = {
    body: new THREE.MeshStandardMaterial({ color: 0xe73b31, roughness: 0.62, flatShading: true }),
    bodyLight: new THREE.MeshStandardMaterial({ color: 0xff6256, roughness: 0.64, flatShading: true }),
    bodyDark: new THREE.MeshStandardMaterial({ color: 0xbc211f, roughness: 0.68, flatShading: true }),
    glass: new THREE.MeshStandardMaterial({ color: 0xc7d5df, roughness: 0.28, metalness: 0.05, flatShading: true }),
    dark: new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: 0.76, flatShading: true }),
    tire: new THREE.MeshStandardMaterial({ color: 0x1d2025, roughness: 0.86, flatShading: true }),
    rim: new THREE.MeshStandardMaterial({ color: 0xd9dce0, roughness: 0.5, metalness: 0.08, flatShading: true }),
    light: new THREE.MeshStandardMaterial({ color: 0x93f4f5, roughness: 0.18, emissive: 0x164748, emissiveIntensity: 0.35 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xffb24c, roughness: 0.38, emissive: 0x3a1e05, emissiveIntensity: 0.18 })
  };

  const body = new THREE.Group();
  body.name = "body";

  const lowerBody = new THREE.Mesh(
    createSectionedPrism(THREE, [
      { z: -2.25, bottom: 0.28, top: 0.58, bottomHalf: 0.58, topHalf: 0.5 },
      { z: -1.8, bottom: 0.18, top: 0.76, bottomHalf: 0.9, topHalf: 0.82 },
      { z: -0.55, bottom: 0.18, top: 0.88, bottomHalf: 1.08, topHalf: 1.0 },
      { z: 0.95, bottom: 0.2, top: 0.82, bottomHalf: 1.05, topHalf: 0.96 },
      { z: 1.95, bottom: 0.28, top: 0.62, bottomHalf: 0.84, topHalf: 0.72 }
    ]),
    materials.body
  );
  lowerBody.name = "facetedLowerBody";
  body.add(lowerBody);

  const hood = new THREE.Mesh(
    createSectionedPrism(THREE, [
      { z: -2.15, bottom: 0.61, top: 0.68, bottomHalf: 0.46, topHalf: 0.54 },
      { z: -1.28, bottom: 0.78, top: 0.88, bottomHalf: 0.86, topHalf: 0.94 },
      { z: -0.54, bottom: 0.88, top: 0.95, bottomHalf: 0.96, topHalf: 0.98 }
    ]),
    materials.bodyLight
  );
  hood.name = "lowWedgeHood";
  body.add(hood);

  const rearDeck = new THREE.Mesh(
    createSectionedPrism(THREE, [
      { z: 1.0, bottom: 0.78, top: 0.9, bottomHalf: 0.87, topHalf: 0.88 },
      { z: 1.95, bottom: 0.58, top: 0.74, bottomHalf: 0.7, topHalf: 0.65 }
    ]),
    materials.bodyDark
  );
  rearDeck.name = "fastbackRearDeck";
  body.add(rearDeck);

  const cabin = new THREE.Mesh(
    createSectionedPrism(THREE, [
      { z: -0.62, bottom: 0.9, top: 1.08, bottomHalf: 0.78, topHalf: 0.5 },
      { z: 0.2, bottom: 0.95, top: 1.48, bottomHalf: 0.86, topHalf: 0.64 },
      { z: 1.12, bottom: 0.82, top: 1.35, bottomHalf: 0.74, topHalf: 0.52 }
    ]),
    materials.body
  );
  cabin.name = "fastbackCabin";
  body.add(cabin);

  body.add(createPanel(THREE, "windshield", materials.glass, [1.0, 0.06, 0.78], [0, 1.12, -0.58], [-0.62, 0, 0]));
  body.add(createPanel(THREE, "rearWindow", materials.glass, [0.92, 0.05, 0.56], [0, 1.1, 1.08], [0.62, 0, 0]));

  const leftSideWindow = createPanel(THREE, "sideWindowLeft", materials.glass, [0.06, 0.46, 1.1], [-0.88, 1.03, 0.22], [0, 0, -0.08]);
  const rightSideWindow = leftSideWindow.clone();
  rightSideWindow.name = "sideWindowRight";
  rightSideWindow.position.x = 0.88;
  body.add(leftSideWindow, rightSideWindow);

  body.add(createPanel(THREE, "frontGrille", materials.dark, [1.02, 0.22, 0.08], [0, 0.48, -2.28], [0, 0, 0]));
  body.add(createPanel(THREE, "frontBumper", materials.dark, [1.28, 0.12, 0.1], [0, 0.24, -2.22], [0, 0, 0]));
  body.add(createPanel(THREE, "rearBumper", materials.dark, [1.2, 0.14, 0.12], [0, 0.34, 1.98], [0, 0, 0]));

  const headlightLeft = createPanel(THREE, "headlightLeft", materials.light, [0.42, 0.22, 0.08], [-0.48, 0.55, -2.3], [0, 0.18, 0]);
  const headlightRight = headlightLeft.clone();
  headlightRight.name = "headlightRight";
  headlightRight.position.x = 0.48;
  headlightRight.rotation.y = -0.18;
  body.add(headlightLeft, headlightRight);

  const tailLeft = createPanel(THREE, "tailLightLeft", materials.amber, [0.28, 0.14, 0.07], [-0.48, 0.48, 2.02], [0, 0, 0]);
  const tailRight = tailLeft.clone();
  tailRight.name = "tailLightRight";
  tailRight.position.x = 0.48;
  body.add(tailLeft, tailRight);

  const mirrorLeft = createMirror(THREE, materials.dark, -1);
  const mirrorRight = createMirror(THREE, materials.dark, 1);
  body.add(mirrorLeft, mirrorRight);
  group.add(body);

  const wheels = new THREE.Group();
  wheels.name = "wheels";
  [
    ["wheelFL", -0.9, -1.42],
    ["wheelFR", 0.9, -1.42],
    ["wheelRL", -0.9, 1.18],
    ["wheelRR", 0.9, 1.18]
  ].forEach(([name, x, z]) => {
    const wheel = createWheel(THREE, materials, name);
    wheel.position.set(x, 0.34, z);
    wheels.add(wheel);
  });
  group.add(wheels);

  return group;
}

function createSectionedPrism(THREE, sections) {
  const vertices = [];
  for (const section of sections) {
    vertices.push(
      -section.bottomHalf,
      section.bottom,
      section.z,
      section.bottomHalf,
      section.bottom,
      section.z,
      -section.topHalf,
      section.top,
      section.z,
      section.topHalf,
      section.top,
      section.z
    );
  }

  const indices = [];
  for (let i = 0; i < sections.length - 1; i += 1) {
    const a = i * 4;
    const b = a + 4;
    indices.push(a, b, b + 2, a, b + 2, a + 2);
    indices.push(a + 1, a + 3, b + 3, a + 1, b + 3, b + 1);
    indices.push(a + 2, b + 2, b + 3, a + 2, b + 3, a + 3);
    indices.push(a, a + 1, b + 1, a, b + 1, b);
  }

  const first = 0;
  const last = (sections.length - 1) * 4;
  indices.push(first, first + 2, first + 3, first, first + 3, first + 1);
  indices.push(last, last + 1, last + 3, last, last + 3, last + 2);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createPanel(THREE, name, material, size, position, rotation) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  mesh.name = name;
  mesh.position.set(position[0], position[1], position[2]);
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  return mesh;
}

function createMirror(THREE, material, side) {
  const mirror = new THREE.Group();
  mirror.name = side < 0 ? "mirrorLeft" : "mirrorRight";

  const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.2), material);
  stalk.position.set(side * 0.96, 0.88, -0.48);
  stalk.rotation.y = side * 0.45;

  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.12), material);
  cap.position.set(side * 1.06, 0.94, -0.55);
  cap.rotation.y = side * 0.28;

  mirror.add(stalk, cap);
  return mirror;
}

function createWheel(THREE, materials, name) {
  const wheel = new THREE.Group();
  wheel.name = name;
  wheel.rotation.z = Math.PI / 2;

  const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.26, 14), materials.tire);
  tire.name = `${name}Tire`;

  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.29, 10), materials.rim);
  rim.name = `${name}Rim`;

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.32, 10), materials.dark);
  hub.name = `${name}Hub`;

  for (let i = 0; i < 6; i += 1) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.23, 0.04), materials.rim);
    spoke.name = `${name}Spoke${i + 1}`;
    spoke.position.y = 0.12;
    spoke.rotation.z = (Math.PI * 2 * i) / 6;
    rim.add(spoke);
  }

  wheel.add(tire, rim, hub);
  return wheel;
}
