import type { Sheet } from '../core/types';
import type { SheetNameSuggestion } from './sheet-names';

export interface PdfRenderBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfOpenMetadata {
  numPages: number;
  version: string;
}

export interface PdfWorkerError {
  name: string;
  message: string;
}

export interface RasterTimings {
  drawMs?: number;
  resizeMs?: number;
  encodeMs?: number;
  totalMs?: number;
}

export interface PdfWorkerTimings extends Required<RasterTimings> {
  thread: 'worker';
}

export interface EncodedRaster {
  bytes: Uint8Array;
  previewBytes?: Uint8Array;
}

/** Pixels become available before the worker finishes encoding cache bytes. */
export interface RasterImage {
  bitmap: ImageBitmap;
  previewBitmap?: ImageBitmap;
  encoded: Promise<EncodedRaster>;
}

export type PdfWorkerRequest =
  | {
      type: 'open';
      id: number;
      parserPort: MessagePort;
      source: { bytes: Uint8Array } | { length: number };
      assetBaseUrl: string;
    }
  | { type: 'import'; id: number; assetId: string; name: string }
  | { type: 'name'; id: number; sheet: Sheet }
  | {
      type: 'render';
      id: number;
      sheet: Sheet;
      bounds: PdfRenderBounds;
      dimension: number;
      paused: boolean;
      priority: number;
    }
  | { type: 'cancel'; id: number }
  | { type: 'pause'; id: number; paused: boolean }
  | { type: 'priority'; id: number; priority: number }
  | {
      type: 'range-result';
      rangeId: number;
      bytes?: Uint8Array;
      error?: string;
    };

export type PdfWorkerResponse =
  | { type: 'ready'; id: number; value: PdfOpenMetadata }
  | { type: 'result'; id: number; value: Sheet[] | SheetNameSuggestion }
  | { type: 'range'; rangeId: number; begin: number; end: number }
  | { type: 'fatal'; error: PdfWorkerError }
  | { type: 'error'; id: number; error: PdfWorkerError }
  | {
      type: 'raster';
      id: number;
      bitmap: ImageBitmap;
      previewBitmap?: ImageBitmap;
      timings: PdfWorkerTimings;
    }
  | {
      type: 'encoded';
      id: number;
      bytes: Uint8Array;
      previewBytes?: Uint8Array;
      timings: PdfWorkerTimings;
    };
