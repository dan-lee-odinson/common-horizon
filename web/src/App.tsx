import { useEffect } from 'react';
import { AssistantBar } from './components/AssistantBar';
import { ComparePanel } from './components/ComparePanel';
import { Drawer } from './components/Drawer';
import { PlannerPanel } from './components/PlannerPanel';
import { TopBar } from './components/TopBar';
import { Playback, Workspace } from './components/Workspace';
import { actions, appStore } from './state/app';
import { DataProvider } from './state/data';
import { useStore } from './state/store';
import { useIsPhone } from './state/useMedia';

export function App() {
  return (
    <DataProvider>
      <Shell />
      <Playback />
    </DataProvider>
  );
}

function Shell() {
  const isPhone = useIsPhone();
  const drawer = useStore(appStore, (s) => s.drawer);
  const compareOpen = useStore(appStore, (s) => s.compareOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && appStore.get().compareOpen) actions.setCompareOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto]">
      <TopBar />
      <main className="relative grid min-h-0 grid-cols-1 md:grid-cols-[minmax(0,1fr)_340px]">
        <div className="relative min-h-0">
          <Workspace />
          {compareOpen ? <ComparePanel /> : null}
        </div>
        {isPhone ? (
          <Drawer open={drawer === 'planner'} side="right" label="Mission planner" onClose={() => actions.setDrawer('none')} testId="planner-drawer">
            <PlannerPanel />
          </Drawer>
        ) : (
          <aside className="min-h-0 border-l border-line bg-surface">
            <PlannerPanel />
          </aside>
        )}
      </main>
      <AssistantBar />
    </div>
  );
}
