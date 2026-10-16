'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DetectTab } from './DetectTab';
import { ColorsTab } from './ColorsTab';
import { CandleTab } from './CandleTab';
import { ExportTab } from './ExportTab';

export function SidePanel() {
  return (
    <aside className="border-border p-4 lg:w-80 lg:shrink-0 lg:border-l">
      <Tabs defaultValue="detect">
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
