'use client';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export default function PrismBackground({ paused }: { paused: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); } catch { return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    node.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
    camera.position.z = 8;
    const geometry = new THREE.OctahedronGeometry(2.6, 0);
    const material = new THREE.MeshPhysicalMaterial({ color: '#9047ff', metalness: .65, roughness: .13, transparent: true, opacity: .65, side: THREE.DoubleSide });
    const prism = new THREE.Mesh(geometry, material);
    prism.scale.set(1, 1.4, .7);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: '#dfbaff', transparent: true, opacity: .65 }));
    prism.add(edges); scene.add(prism);
    scene.add(new THREE.AmbientLight('#d5baff', 2));
    const light = new THREE.PointLight('#f7d7ff', 80); light.position.set(3, 3, 4); scene.add(light);
    const blue = new THREE.PointLight('#6a5dff', 65); blue.position.set(-4, -2, 2); scene.add(blue);
    let dirty = true;
    const resize = () => { const { width, height } = node.getBoundingClientRect(); renderer.setSize(width, height); camera.aspect = width / Math.max(height, 1); camera.updateProjectionMatrix(); dirty = true; };
    const observer = new ResizeObserver(resize); observer.observe(node); resize();
    const start = performance.now();
    renderer.setAnimationLoop(() => {
      if (document.hidden || (paused && !dirty)) return;
      const time = paused ? 0 : (performance.now() - start) / 1000;
      prism.rotation.set(.15 + Math.sin(time * .2) * .12, .5 + time * .12, .3);
      prism.position.x = camera.aspect > 1.2 ? -1.7 : 0;
      renderer.render(scene, camera); dirty = false;
    });
    return () => { observer.disconnect(); renderer.setAnimationLoop(null); geometry.dispose(); material.dispose(); edges.geometry.dispose(); (edges.material as THREE.Material).dispose(); renderer.dispose(); renderer.domElement.remove(); };
  }, [paused]);
  return <div ref={host} aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />;
}
