// The one reticle that stays on the landing point from mission select down to the site.
//
// While the camera dives from the Moon it follows the selected site's marker; at the site it
// follows the lander. It is the same element throughout, so the eye keeps its target across the
// change from the Moon's world to the site's. Its name appears once the camera has come to rest:
// the lander's name when a lander stands there, "Landing point" before the landing, with no lander
// in the mission, or while the lander's shape is not in the picture.

import { AnchorReticle } from '../hud/AnchorReticle';
import { siteArrival } from '../scene/siteView';
import { appStore, simClock } from '../state/app';
import { useData } from '../state/data';
import { modelShapes, primaryLanderId } from '../state/models';
import { useStore } from '../state/store';
import { useIsPhone } from '../state/useMedia';

export function LanderReticle() {
  const atSite = useStore(appStore, (s) => s.stage === 'site');
  const diving = useStore(appStore, (s) => s.flight === 'in');
  const isPhone = useIsPhone();
  const { catalog, hardwareChosen, landingMs } = useData();
  const landerId = primaryLanderId(hardwareChosen.map((h) => h.id));
  const landerDrawn = useStore(modelShapes, (s) => landerId !== null && s[landerId] === 'ready');
  const landerName = landerId ? (catalog.data?.items.find((c) => c.id === landerId)?.name ?? landerId) : null;

  const getLabel = () => {
    if (!atSite || !siteArrival.settled) return '';
    const now = simClock.get().nowMs;
    const beforeLanding = now !== null && landingMs !== null && now < landingMs;
    return landerName !== null && landerDrawn && !beforeLanding ? landerName : 'Landing point';
  };
  return <AnchorReticle anchor={atSite ? 'lander' : diving ? 'site' : null} getLabel={getLabel} size={isPhone ? 56 : 72} />;
}
