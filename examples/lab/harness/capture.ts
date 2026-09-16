export interface CanvasCaptureOptions { readonly type?: string; readonly quality?: number }

/** Encodes a canvas and starts a browser download. */
export function downloadCanvasCapture(canvas: HTMLCanvasElement, filename = 'clouds-capture.png', options: CanvasCaptureOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) { reject(new Error('Canvas capture returned no image')); return; }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      setTimeout(() => { anchor.remove(); URL.revokeObjectURL(url); resolve(); }, 0);
    }, options.type ?? 'image/png', options.quality);
  });
}
