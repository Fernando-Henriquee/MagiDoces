import { useMemo } from 'react';
import { cn } from '@/lib/cn';
import { QR_INK, qrModules } from '@/lib/qr';

/** QR code desenhado como SVG a partir da matriz de módulos. */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrModules(value);
    let d = '';
    qr.data.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { size: qr.size, path: d };
  }, [value]);
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" className={cn('block bg-white', className)}>
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill={QR_INK} />
    </svg>
  );
}
