import * as THREE from 'three';

/** A continuous river valley, generated locally without borrowed scene assets. */
export function createScenery(random: () => number, lowQuality: boolean) {
  const group = new THREE.Group();
  const heightAt = (x: number, z: number) => {
    const shore = 7.5 + Math.sin(z * .15) * 2;
    const bank = THREE.MathUtils.smoothstep(Math.abs(x), shore, shore + 8);
    const ridge = THREE.MathUtils.smoothstep(-z, 18, 42);
    const wave = Math.sin(x * .28 + z * .13) * Math.cos(z * .21) + .5 * Math.sin(x * .63 - z * .34);
    return -.45 + bank * (1.2 + wave * .6) + ridge * (4 + wave * 2.8);
  };
  const terrain = new THREE.PlaneGeometry(100, 90, 120, 100);
  terrain.rotateX(-Math.PI / 2);
  const positions = terrain.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i) - 20;
    positions.setXYZ(i, x, heightAt(x, z), z);
  }
  terrain.computeVertexNormals();
  group.add(new THREE.Mesh(terrain, new THREE.MeshStandardMaterial({ color: '#765399', roughness: .94, flatShading: true })));

  // Tapered, bent ribbons read as blades, and share one instanced draw call.
  const blade = new THREE.BufferGeometry();
  blade.setAttribute('position', new THREE.Float32BufferAttribute([
    -.055, 0, 0, .055, 0, 0, -.035, .4, .055, .035, .4, .055, .1, 1, .19,
  ], 3));
  blade.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
  blade.computeVertexNormals();
  const grass = new THREE.InstancedMesh(blade, new THREE.MeshStandardMaterial({ color: '#a063ca', side: THREE.DoubleSide, roughness: .9 }), lowQuality ? 5000 : 14000);
  const transform = new THREE.Object3D();
  const tint = new THREE.Color();
  for (let i = 0; i < grass.count; i++) {
    const z = random() * 48 - 27;
    const side = random() > .5 ? 1 : -1;
    const x = side * (9.5 + Math.sin(z * .15) * 2 + Math.pow(random(), 1.8) * 22);
    transform.position.set(x, heightAt(x, z), z);
    transform.rotation.set(0, random() * Math.PI * 2, (random() - .5) * .3);
    transform.scale.set(.6 + random(), .35 + random() * .9, .6 + random());
    transform.updateMatrix();
    grass.setMatrixAt(i, transform.matrix);
    grass.setColorAt(i, tint.setHSL(.76 + random() * .055, .3 + random() * .3, .35 + random() * .3));
  }
  group.add(grass);

  // A sculptural gateway gives the camera journey a physical destination.
  const archMaterial = new THREE.MeshStandardMaterial({ color: '#382147', metalness: .35, roughness: .45 });
  const arch = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-3, 0, 0), new THREE.Vector3(-3, 4, 0),
    new THREE.Vector3(0, 7, 0), new THREE.Vector3(3, 4, 0), new THREE.Vector3(3, 0, 0),
  ]);
  arch.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, .35, 8, false), archMaterial));
  arch.position.set(0, 0, -18);
  group.add(arch);
  return group;
}
