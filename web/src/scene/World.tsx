// The one 3D space behind the HUD. A single canvas holds the Moon world (stages 1 and 2) and the
// terrain world (stage 3); the camera director flies between them.

import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { actions, appStore } from '../state/app';
import { useData, type KnownSite } from '../state/data';
import { useStore } from '../state/store';
import { useIsPhone, useReducedMotion } from '../state/useMedia';
import { CameraDirector } from './CameraDirector';
import { cssColor } from './colors';
import { MoonWorld } from './MoonWorld';
import type { SceneData } from './sceneData';
import { Stars } from './Stars';

const STAGE_LABEL = {
  orbit: 'The Moon with the Sun and Earth on their rings, in the directions the data gives. Sizes and distances are not to scale.',
  mission: 'The Moon with landing site markers. The selected site carries a reticle.',
  site: 'The terrain at the selected site.',
} as const;

export function World() {
  const d = useData();
  const stage = useStore(appStore, (s) => s.stage);
  const saved = useStore(appStore, (s) => s.saved);
  const pickEnabled = useStore(appStore, (s) => s.stage === 'mission' && s.drawerOpen && s.drawerMode === 'custom');
  const isPhone = useIsPhone();
  const reducedMotion = useReducedMotion();
  const savedIds = useMemo(() => new Set(saved.map((s) => s.id)), [saved]);

  const data: SceneData = {
    track: d.track.data,
    landingMs: d.landingMs,
    stayEndMs: d.windowEndMs,
    landingGeometry: d.landingGeometry,
    sites: d.allSites,
    focus: d.focus ?? (stage === 'orbit' ? d.reference : null),
    savedIds,
    horizon: d.horizon.data,
    hardware: d.hardwareChosen,
    isPhone,
    reducedMotion,
    pickEnabled,
    onSiteClick: (site: KnownSite) => actions.highlight(site.id, site),
    onPickPoint: (lat: number, lon: number) => actions.setCustomSite(lat, lon),
  };

  return (
    <div className="absolute inset-0" data-testid="world" data-stage={stage}>
      <Canvas flat dpr={[1, 2]} gl={{ antialias: true, powerPreference: 'high-performance' }} camera={{ position: [4.2, 3.2, 6.4], fov: 34, near: 0.05, far: 400 }} aria-label={STAGE_LABEL[stage]} role="img">
        <color attach="background" args={[cssColor('--ch-space')]} />
        <Stars />
        <MoonWorld data={data} visible={stage !== 'site'} />
        <OrbitControls makeDefault enablePan={false} enableDamping dampingFactor={0.08} rotateSpeed={0.45} zoomSpeed={0.7} />
        <CameraDirector data={data} />
      </Canvas>
    </div>
  );
}
