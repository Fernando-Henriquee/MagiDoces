import { encode } from 'uqr';

/**
 * QR code gerado no próprio aparelho (sem serviço externo). A borda branca (zona
 * de silêncio) faz parte da matriz e é necessária para a leitura pela câmera.
 */

export const QR_INK = '#2b1d17';

export function qrModules(value: string) {
  return encode(value, { ecc: 'M', border: 2 });
}

/** Baixa o QR code como PNG (para imprimir), com uma legenda embaixo. */
export async function downloadQrPng(value: string, fileName: string, caption?: string) {
  const qr = qrModules(value);
  const scale = 16;
  const captionHeight = caption ? 72 : 0;
  const canvas = document.createElement('canvas');
  canvas.width = qr.size * scale;
  canvas.height = qr.size * scale + captionHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Não foi possível gerar a imagem neste navegador.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = QR_INK;
  qr.data.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) context.fillRect(x * scale, y * scale, scale, scale);
    }),
  );
  if (caption) {
    context.font = '600 30px Inter Variable, system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(caption, canvas.width / 2, qr.size * scale + captionHeight / 2 - 8, canvas.width - 32);
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Não foi possível gerar a imagem neste navegador.');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
