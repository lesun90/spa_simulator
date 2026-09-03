export const metadata = {
  label: "House",
  category: "buildings",
  tags: ["structure", "residential", "roof"]
};

export function createAsset({ THREE }) {
  const group = new THREE.Group();

  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 1.8, 2.0),
    new THREE.MeshStandardMaterial({ color: 0xd8c7a8, roughness: 0.85 })
  );
  walls.position.y = 0.9;

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(1.85, 1.1, 4).rotateY(Math.PI / 4),
    new THREE.MeshStandardMaterial({ color: 0x7a3b30, roughness: 0.7 })
  );
  roof.position.y = 2.35;

  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 1.0, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x4a3323, roughness: 0.75 })
  );
  door.position.set(0, 0.5, 1.03);

  const windowMaterial = new THREE.MeshStandardMaterial({ color: 0x8fc4d8, roughness: 0.3, metalness: 0.1 });
  const windowLeft = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.06), windowMaterial);
  windowLeft.position.set(-0.85, 1.15, 1.03);
  const windowRight = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.06), windowMaterial);
  windowRight.position.set(0.85, 1.15, 1.03);

  group.add(walls, roof, door, windowLeft, windowRight);
  return group;
}
