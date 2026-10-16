import { toast } from 'sonner';
import { buildSvg } from '@/lib/svg/buildSvg';
import { selectActivePreset, usePresetStore } from '@/store/presetStore';
import { useChartStore } from '@/store/chartStore';
import { useUiStore } from '@/store/uiStore';
import { copyText } from './clipboard';
import { downloadBlob, downloadText } from './download';
import { svgToPngBlob } from './png';

/** The SVG for the current candles, preset and export options. null if there is nothing yet. */
export function currentSvg(): string | null {
  const { image, candles } = useChartStore.getState();
  if (!image || candles.length === 0) return null;
  const preset = selectActivePreset(usePresetStore.getState());
  const { exportBackground } = useUiStore.getState();
  return buildSvg(
    candles,
    preset,
    { width: image.width, height: image.height },
    {
      background: exportBackground,
    },
  );
}

function baseName(): string {
  const name = useChartStore.getState().image?.name ?? 'candles';
  return `${name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-') || 'candles'}`;
}

export async function copySvg(): Promise<void> {
  const svg = currentSvg();
  if (!svg) {
    toast.error('Nothing to copy yet. Load a screenshot with candles first.');
    return;
  }
  if (await copyText(svg)) toast.success('SVG copied. Paste in Figma with Ctrl+V.');
  else toast.error('Could not copy. Use Download SVG instead.');
}

export function downloadSvgFile(): void {
  const svg = currentSvg();
  if (!svg) {
    toast.error('Nothing to download yet.');
    return;
  }
  downloadText(svg, `${baseName()}-candles.svg`, 'image/svg+xml');
  toast.success('SVG downloaded.');
}

export async function downloadPngFile(): Promise<void> {
  const svg = currentSvg();
  const image = useChartStore.getState().image;
  if (!svg || !image) {
    toast.error('Nothing to download yet.');
    return;
  }
  const scale = useUiStore.getState().pngScale;
  try {
    const blob = await svgToPngBlob(svg, image.width, image.height, scale);
    downloadBlob(blob, `${baseName()}-candles@${scale}x.png`);
    toast.success(`PNG downloaded at ${scale}x.`);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not create the PNG.');
  }
}
