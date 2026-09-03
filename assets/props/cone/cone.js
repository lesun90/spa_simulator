export const metadata = {
  label: "Traffic cone",
  category: "props",
  tags: ["traffic", "temporary", "marker"]
};

export function createAsset({ THREE }) {
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.36, 0.46, 0.12, 4),
    new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.82 })
  );
  base.position.y = 0.06;

  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.28, 0.9, 24),
    new THREE.MeshStandardMaterial({ color: 0xf36b2b, roughness: 0.58 })
  );
  cone.position.y = 0.58;

  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.19, 0.23, 0.08, 24),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 })
  );
  band.position.y = 0.5;

  group.add(base, cone, band);
  return group;
}
