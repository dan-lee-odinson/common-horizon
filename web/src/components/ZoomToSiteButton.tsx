// "Zoom in to this site": the main action for the highlighted site. The Moon camera flies down to
// the site, then the site scene opens (an instant switch for visitors who prefer reduced motion).
// Used in the selected-site card of the Sites pane and beside the site's label on the Moon.

import type { MouseEvent, PointerEvent } from 'react';
import { actions, appStore } from '../state/app';
import { useStore } from '../state/store';
import { Icon } from './Icon';

export function ZoomToSiteButton({ siteName, compact = false, testId = 'zoom-to-site' }: { siteName: string; compact?: boolean; testId?: string }) {
  const flight = useStore(appStore, (s) => s.flight);
  // On the Moon the button sits over the 3D canvas: keep its presses away from the Moon underneath.
  const stop = (e: PointerEvent | MouseEvent) => e.stopPropagation();
  return (
    <button
      type="button"
      className={`btn btn-primary shrink-0 whitespace-nowrap ${compact ? 'h-7 min-h-7 px-2 text-[12px]' : ''}`}
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={(e) => {
        stop(e);
        actions.zoomToSite();
      }}
      disabled={flight !== null}
      title={`Fly down to ${siteName} and open its site scene`}
      data-testid={testId}
    >
      <Icon name="zoom-in" size={compact ? 14 : 16} />
      Zoom in to this site
    </button>
  );
}
