export const metadata = {
  label: "Oak tree",
  category: "vegetation",
  tags: ["tree", "deciduous", "shade"]
};

export function createAsset({ THREE }) {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.22, 1.2, 12),
    new THREE.MeshStandardMaterial({ color: 0x76512e, roughness: 0.9 })
  );
  trunk.position.y = 0.6;

  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.72, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0x3f7d4c, roughness: 0.75 })
  );
  canopy.position.y = 1.35;
  canopy.scale.set(1.15, 0.85, 1);

  group.add(trunk, canopy);
  return group;
}
