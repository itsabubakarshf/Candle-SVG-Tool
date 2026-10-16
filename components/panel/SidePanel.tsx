'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUiStore, type PanelTab } from '@/store/uiStore';
import { DetectTab } from './DetectTab';
import { ColorsTab } from './ColorsTab';
import { CandleTab } from './CandleTab';
import { ExportTab } from './ExportTab';

export function SidePanel() {
  const tab = useUiStore((s) => s.tab);
  const setTab = useUiStore((s) => s.setTab);
  return (
    <aside
      aria-label="Settings"
      className="min-h-0 overflow-y-auto border-border p-4 lg:w-80 lg:shrink-0 lg:border-l"
    >
      <Tabs value={tab} onValueChange={(v) => setTab(v as PanelTab)}>
        <TabsList aria-label="Side panel">
          <TabsTrigger value="detect">Detect</TabsTrigger>
          <TabsTrigger value="colors">Colors</TabsTrigger>
          <TabsTrigger value="candle">Candle</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
        </TabsList>
        <TabsContent value="detect">
          <DetectTab />
        </TabsContent>
        <TabsContent value="colors">
          <ColorsTab />
        </TabsContent>
        <TabsContent value="candle">
          <CandleTab />
        </TabsContent>
        <TabsContent value="export">
          <ExportTab />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
