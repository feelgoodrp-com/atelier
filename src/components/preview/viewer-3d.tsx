/**
 * R3F viewport for the workbench 3D preview.
 *
 * Renders one GLB model per previewed drawable (each loaded independently via
 * GLTFLoader on a cached blob URL), on a Feelgood dark stage: hemisphere +
 * two directional lights and a dark grid floor — deliberately no bright HDRI.
 * The camera frames the combined bounds of all loaded models; presets pick a
 * target/position relative to those bounds.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { Box3, Texture, Vector3 } from "three";
import type { Group, Mesh, Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { CameraPreset } from "@/lib/stores/preview-3d-store";

export interface ViewerModel {
  /** Drawable uuid (stable identity across texture switches). */
  id: string;
  /** Blob URL of the cached GLB. */
  url: string;
}

interface Viewer3DProps {
  models: ViewerModel[];
  preset: CameraPreset;
  /** Bumped externally to force a re-frame (Fokus button). */
  frameNonce: number;
  autoRotate: boolean;
  /**
   * GLB parse failure of a single model (the others keep rendering). Keyed by
   * blob URL so stale errors die with their cache entry.
   */
  onModelError: (url: string, message: string) => void;
}

/** Frees GPU resources of a loaded GLTF scene graph. */
function disposeObject(root: Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

function GlbModel({
  url,
  onBounds,
  onError,
}: {
  url: string;
  /** Reports the model bounds after load; null on unmount. */
  onBounds: (box: Box3 | null) => void;
  onError: (message: string) => void;
}) {
  const [scene, setScene] = useState<Group | null>(null);

  // Keep callbacks out of the effect deps — parents pass fresh closures every
  // render and reloading the GLB for that would thrash the GPU.
  const onBoundsRef = useRef(onBounds);
  onBoundsRef.current = onBounds;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let disposed = false;
    let loaded: Group | null = null;
    new GLTFLoader().load(
      url,
      (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }
        loaded = gltf.scene;
        setScene(gltf.scene);
        onBoundsRef.current(new Box3().setFromObject(gltf.scene));
      },
      undefined,
      (err) => {
        if (!disposed) {
          onErrorRef.current(
            err instanceof Error ? err.message : "GLB konnte nicht geladen werden",
          );
        }
      },
    );
    return () => {
      disposed = true;
      if (loaded) disposeObject(loaded);
      setScene(null);
      onBoundsRef.current(null);
    };
  }, [url]);

  return scene ? <primitive object={scene} /> : null;
}

/** Camera target + position for a preset, relative to the combined bounds. */
function frameForPreset(
  bounds: Box3,
  preset: CameraPreset,
): { position: Vector3; target: Vector3 } {
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.1);
  const height = Math.max(size.y, 0.1);
  const minY = bounds.min.y;

  let target = center.clone();
  let distance = maxDim * 1.85;

  switch (preset) {
    case "kopf":
      target = new Vector3(center.x, minY + height * 0.92, center.z);
      distance = Math.max(maxDim * 0.55, 0.35);
      break;
    case "torso":
      target = new Vector3(center.x, minY + height * 0.62, center.z);
      distance = Math.max(maxDim * 0.85, 0.45);
      break;
    case "beine":
      target = new Vector3(center.x, minY + height * 0.3, center.z);
      distance = Math.max(maxDim * 0.85, 0.45);
      break;
    case "fuesse":
      target = new Vector3(center.x, minY + height * 0.06, center.z);
      distance = Math.max(maxDim * 0.5, 0.3);
      break;
    case "gesamt":
      break;
  }

  const direction = new Vector3(0.55, 0.28, 1).normalize();
  return { position: target.clone().add(direction.multiplyScalar(distance)), target };
}

/** Rounded bounds signature — avoids re-framing on float jitter. */
function boundsSignature(bounds: Box3): string {
  const round = (v: number) => Math.round(v * 50) / 50;
  return [
    round(bounds.min.x),
    round(bounds.min.y),
    round(bounds.min.z),
    round(bounds.max.x),
    round(bounds.max.y),
    round(bounds.max.z),
  ].join(",");
}

function CameraRig({
  bounds,
  preset,
  frameNonce,
  autoRotate,
}: {
  bounds: Box3 | null;
  preset: CameraPreset;
  frameNonce: number;
  autoRotate: boolean;
}) {
  const camera = useThree((s) => s.camera);
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const lastFrame = useRef<string | null>(null);

  useEffect(() => {
    if (!bounds || bounds.isEmpty()) return;
    // Re-frame when the rendered set (bounds), the preset or the explicit
    // Fokus nonce changes — texture switches keep the camera untouched.
    const signature = `${preset}|${frameNonce}|${boundsSignature(bounds)}`;
    if (lastFrame.current === signature) return;
    lastFrame.current = signature;

    const { position, target } = frameForPreset(bounds, preset);
    camera.position.copy(position);
    const controls = controlsRef.current;
    if (controls) {
      controls.target.copy(target);
      controls.update();
    } else {
      camera.lookAt(target);
    }
  }, [bounds, preset, frameNonce, camera]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      autoRotate={autoRotate}
      autoRotateSpeed={1.2}
      minDistance={0.05}
      maxDistance={50}
    />
  );
}

export function Viewer3D({
  models,
  preset,
  frameNonce,
  autoRotate,
  onModelError,
}: Viewer3DProps) {
  const [boundsById, setBoundsById] = useState<Record<string, Box3>>({});

  const handleBounds = useCallback((id: string, box: Box3 | null) => {
    setBoundsById((prev) => {
      if (box === null) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: box };
    });
  }, []);

  /** Union of all currently loaded model bounds (null until the first load). */
  const combinedBounds = useMemo(() => {
    const visible = new Set(models.map((m) => m.id));
    let union: Box3 | null = null;
    for (const [id, box] of Object.entries(boundsById)) {
      if (!visible.has(id) || box.isEmpty()) continue;
      union = union ? union.union(box) : box.clone();
    }
    return union;
  }, [boundsById, models]);

  const floorY = combinedBounds ? combinedBounds.min.y : 0;

  return (
    <Canvas
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      camera={{ fov: 40, near: 0.01, far: 200, position: [1.4, 0.9, 2.4] }}
    >
      {/* Feelgood dark stage — subtle hemisphere + key/rim, no bright HDRI.
          All lights stay color-neutral so the embedded textures (skin tones
          especially) read true instead of picking up a cool cast. */}
      <ambientLight intensity={0.25} />
      <hemisphereLight args={["#c4c4c4", "#15151a", 0.5]} />
      <directionalLight position={[2.5, 4, 2.5]} intensity={1.4} />
      <directionalLight position={[-3, 2, -2.5]} intensity={0.5} />

      {models.map((model) => (
        <GlbModel
          key={`${model.id}:${model.url}`}
          url={model.url}
          onBounds={(box) => handleBounds(model.id, box)}
          onError={(message) => onModelError(model.url, message)}
        />
      ))}

      <Grid
        position={[0, floorY - 0.001, 0]}
        infiniteGrid
        cellSize={0.1}
        sectionSize={0.5}
        cellThickness={0.6}
        sectionThickness={1}
        cellColor="#26262e"
        sectionColor="#3a3a47"
        fadeDistance={12}
        fadeStrength={1.5}
      />

      <CameraRig
        bounds={combinedBounds}
        preset={preset}
        frameNonce={frameNonce}
        autoRotate={autoRotate}
      />
    </Canvas>
  );
}
