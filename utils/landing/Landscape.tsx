'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { createScenery } from './scenery';

/** Original procedural scene: no third-party brand models or textures. */
export default function Landscape({ reduced, lowQuality }: { reduced: boolean; lowQuality: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: !lowQuality, alpha: true }); }
    catch { return; } // The CSS landscape remains visible without WebGL.
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#c5b4e2');
    scene.fog = new THREE.FogExp2('#c5b4e2', .018);
    const camera = new THREE.PerspectiveCamera(48, 1, .1, 120);
    camera.position.set(0, 3.5, 15);
    renderer.setPixelRatio(Math.min(devicePixelRatio, lowQuality ? 1 : 1.5));
    renderer.setClearColor('#b2a0dc');
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    node.appendChild(renderer.domElement);
    delete node.dataset.failed;
    scene.add(new THREE.HemisphereLight('#eadbff', '#35204f', 2.8));
    const sun = new THREE.DirectionalLight('#ffe8ff', 3);
    sun.position.set(-4, 9, 4); scene.add(sun);
    let seed = 21;
    const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    scene.add(createScenery(random, lowQuality));
    const normals = new Uint8Array(64 * 64 * 4);
    for (let i = 0; i < 64 * 64; i++) { normals[i * 4] = 120 + random() * 16; normals[i * 4 + 1] = 120 + random() * 16; normals[i * 4 + 2] = 255; normals[i * 4 + 3] = 255; }
    const normalTexture = new THREE.DataTexture(normals, 64, 64);
    normalTexture.wrapS = normalTexture.wrapT = THREE.RepeatWrapping; normalTexture.needsUpdate = true;
    const water = new Water(new THREE.PlaneGeometry(80, 95), { textureWidth: lowQuality ? 256 : 512, textureHeight: lowQuality ? 256 : 512, waterNormals: normalTexture, sunDirection: sun.position.clone().normalize(), sunColor: '#e9caff', waterColor: '#8d66b6', distortionScale: 1.5, fog: true });
    water.rotation.x = -Math.PI / 2; water.position.set(0, 0, -20); scene.add(water);
    const count = lowQuality ? 2200 : 6500;
    const positions = new Float32Array(count * 3), target = new Float32Array(count * 3), colors = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const stem = random() < .36, angle = random() * Math.PI * 2;
      positions[i * 3] = stem ? -.85 + (random() - .5) * .28 : -.1 + Math.cos(angle) * .95;
      positions[i * 3 + 1] = stem ? (random() - .5) * 3.5 : .8 + Math.sin(angle) * .85;
      positions[i * 3 + 2] = (random() - .5) * .5;
      const a = random() * Math.PI * 2, v = Math.acos(2 * random() - 1);
      target[i * 3] = 1.6 * Math.sin(v) * Math.cos(a); target[i * 3 + 1] = 1.6 * Math.cos(v); target[i * 3 + 2] = 1.6 * Math.sin(v) * Math.sin(a);
      c.setHSL(.73 + random() * .14, .8, .55 + random() * .4); c.toArray(colors, i * 3);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('target', new THREE.BufferAttribute(target, 3)); geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, uniforms: { time: { value: 0 }, morph: { value: 0 }, pixelRatio: { value: renderer.getPixelRatio() } }, vertexShader: `attribute vec3 target; varying vec3 vColor; uniform float time; uniform float morph; uniform float pixelRatio; void main(){ vColor=color; vec3 p=mix(position,target,morph); p+=.035*sin(p.yzx*6.+time); vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv; gl_PointSize=clamp(48.*pixelRatio/-mv.z,1.,9.); }`, fragmentShader: `varying vec3 vColor; void main(){float d=length(gl_PointCoord-.5); if(d>.5) discard; gl_FragColor=vec4(vColor,pow(1.-d*2.,1.3));}` });
    const symbol = new THREE.Points(geometry, material); symbol.position.set(0, 4.5, -1); symbol.scale.setScalar(1.5); scene.add(symbol);
    const dustGeo = new THREE.BufferGeometry(); const dustPos = new Float32Array(360 * 3);
    for(let i=0;i<dustPos.length;i++) dustPos[i] = (random()-.5)*35;
    dustGeo.setAttribute('position',new THREE.BufferAttribute(dustPos,3));
    const dust = new THREE.Points(dustGeo,new THREE.PointsMaterial({color:'#ffdcff',size:.045,transparent:true,opacity:.7})); scene.add(dust);
    let needsRender = true;
    const resize = () => { const {width,height} = node.getBoundingClientRect(); renderer.setSize(width,height); camera.aspect=width/height; camera.updateProjectionMatrix(); needsRender = true; };
    const observer = new ResizeObserver(resize); observer.observe(node); resize();
    let visible=true;
    const intersection=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;}); intersection.observe(node);
    const started = performance.now();
    renderer.setAnimationLoop(() => {
      if (!visible || document.hidden || (reduced && !needsRender)) return;
      const t = reduced ? 0 : (performance.now()-started)/1000;
      const story = node.closest('[data-story]'); const rect=story?.getBoundingClientRect();
      const progress = reduced || !rect ? 0 : THREE.MathUtils.clamp(-rect.top/(rect.height-innerHeight),0,1);
      material.uniforms.time.value=t; material.uniforms.morph.value=THREE.MathUtils.smoothstep(progress,.2,.7);
      water.material.uniforms.time.value=t*.35;
      symbol.rotation.y = reduced ? -.2 : Math.sin(t*.22)*.25+progress*1.7;
      symbol.position.x = Math.sin(progress*Math.PI*2)*2;
      camera.position.set(Math.sin(progress*3)*3,3.5+progress*1.2, (camera.aspect<.8?20:15)-progress*4);
      camera.lookAt(0,3.3,-2); dust.rotation.y=t*.012; renderer.render(scene,camera); needsRender = false;
    });
    const lost=(event:Event)=>{event.preventDefault();renderer.setAnimationLoop(null);node.dataset.failed='true';};
    renderer.domElement.addEventListener('webglcontextlost',lost);
    return () => { observer.disconnect();intersection.disconnect();renderer.setAnimationLoop(null);renderer.domElement.removeEventListener('webglcontextlost',lost);scene.traverse(object=>{if(object instanceof THREE.Mesh || object instanceof THREE.Points){object.geometry.dispose();const mats=Array.isArray(object.material)?object.material:[object.material];mats.forEach(m=>m.dispose());}});normalTexture.dispose();renderer.dispose();renderer.domElement.remove(); };
  },[reduced,lowQuality]);
  return <div className="lp-landscape" ref={host} aria-hidden="true" />;
}
