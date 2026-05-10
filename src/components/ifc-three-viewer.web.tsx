import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { IfcGeometryIndex, IfcGeometryPiece } from '@/ifc';

interface IfcThreeViewerProps {
  geometry?: IfcGeometryIndex;
  selectedExpressID?: number;
  hiddenTypes: Set<string>;
  onSelect(expressID: number): void;
}

export default function IfcThreeViewer({
  geometry,
  selectedExpressID,
  hiddenTypes,
  onSelect,
}: IfcThreeViewerProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return undefined;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f6f7f9');
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    const root = new THREE.Group();
    scene.add(root);
    scene.add(new THREE.HemisphereLight('#ffffff', '#93a0aa', 2.4));
    const keyLight = new THREE.DirectionalLight('#ffffff', 2.2);
    keyLight.position.set(8, 10, 6);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight('#b7d7ff', 0.8);
    fillLight.position.set(-8, 4, -6);
    scene.add(fillLight);

    if (geometry?.pieces.length) {
      geometry.pieces
        .filter((piece) => !hiddenTypes.has(piece.typeName))
        .forEach((piece) => root.add(meshFromPiece(piece, piece.expressID === selectedExpressID)));
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const resize = () => {
      const width = Math.max(mount.clientWidth, 1);
      const height = Math.max(mount.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const fit = () => {
      const bounds = geometry?.bounds;
      const radius = bounds?.radius ?? 5;
      const center = bounds?.center ?? [0, 0, 0];
      camera.position.set(center[0] + radius * 1.6, center[1] - radius * 1.8, center[2] + radius * 1.25);
      camera.near = Math.max(radius / 1000, 0.01);
      camera.far = radius * 1000;
      camera.updateProjectionMatrix();
      controls.target.set(center[0], center[1], center[2]);
      controls.update();
    };

    const onPointerDown = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(root.children, true)[0];
      const expressID = hit?.object.userData.expressID;
      if (typeof expressID === 'number') {
        onSelectRef.current(expressID);
      }
    };

    resize();
    fit();
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    let frame = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      controls.dispose();
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((material) => material.dispose());
        } else {
          mesh.material?.dispose?.();
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [geometry, hiddenTypes, selectedExpressID]);

  return (
    <div className="ifc-viewer">
      <div className="ifc-viewer-canvas" ref={mountRef} />
      {!geometry?.pieces.length && (
        <div className="ifc-viewer-empty">
          <strong>No geometry loaded</strong>
          <span>Metadata-only model or unsupported geometry.</span>
        </div>
      )}
    </div>
  );
}

function meshFromPiece(piece: IfcGeometryPiece, selected: boolean) {
  const buffer = new THREE.BufferGeometry();
  buffer.setAttribute('position', new THREE.BufferAttribute(piece.positions, 3));
  if (piece.normals) {
    buffer.setAttribute('normal', new THREE.BufferAttribute(piece.normals, 3));
  } else {
    buffer.computeVertexNormals();
  }
  buffer.setIndex(new THREE.BufferAttribute(piece.indices, 1));
  const color = selected
    ? new THREE.Color('#f59e0b')
    : new THREE.Color(piece.color[0], piece.color[1], piece.color[2]);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.78,
    metalness: 0.04,
    transparent: piece.color[3] < 0.99,
    opacity: Math.max(0.12, piece.color[3]),
    side: THREE.DoubleSide,
  });
  if (selected) {
    material.emissive = new THREE.Color('#5f3b00');
    material.emissiveIntensity = 0.18;
  }
  const mesh = new THREE.Mesh(buffer, material);
  mesh.applyMatrix4(new THREE.Matrix4().fromArray(piece.matrix));
  mesh.userData.expressID = piece.expressID;
  mesh.userData.typeName = piece.typeName;
  return mesh;
}
