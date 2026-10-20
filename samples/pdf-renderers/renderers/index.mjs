// Add a renderer here. The page, file picker and timing code stay the same.
export const renderers = [
  { name: 'PDF.js 6.4.299', load: () => import('./pdfjs.mjs') },
  { name: 'Hayro WASM SIMD', load: () => import('./hayro.mjs') },
  { name: 'PDFium WASM', load: () => import('./pdfium.mjs') },
];
