import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createPdfRuntime } from '@embedpdf/engine-runtime';
import { PdfiumDocument } from '../../src/pdf/pdfium-document';
import {
  PdfAvailabilityError,
  PdfiumSource,
} from '../../src/pdf/pdfium-source';
import { vectorPdf } from '../browser/pdf-fixtures';

void test('a PDF availability error falls back to a complete document and loads the page', async () => {
  const bytes = vectorPdf();
  const wasmBinary = await readFile(
    'node_modules/@embedpdf/engine-runtime-wasm32/lib/embedpdf.wasm',
  );
  const runtime = await createPdfRuntime({ prefer: 'wasm', wasmBinary });
  runtime.fn.EPDF_InitThread();
  const source = new PdfiumSource(
    runtime,
    bytes.length,
    (rangeId, begin, end) => {
      queueMicrotask(() => {
        source.receive({
          type: 'range-result',
          rangeId,
          bytes: bytes.slice(begin, end),
        });
      });
    },
  );
  const streamed = await source.document(() => {});
  const document = Object.assign(
    Object.create(PdfiumDocument.prototype) as object,
    { runtime, source, document: streamed },
  ) as unknown as PdfiumDocument;
  source.page = () => Promise.reject(new PdfAvailabilityError());
  const page = await document['page'](
    0,
    () => {},
    (pending) => pending,
  );
  assert.notEqual(page, 0n);
  assert.equal(runtime.fn.FPDF_GetPageWidthF(page), 64);
  runtime.fn.FPDF_ClosePage(page);
});
