import { expect, test } from '@playwright/test';
import type { PdfDocuments as Documents } from '../../src/pdf/documents';
import type {
  PageImages as Images,
  pageImageKey as Key,
} from '../../src/pdf/page-images';
import type { planClarityPdf as Fixture } from './pdf-fixtures';
import type { RasterLease } from '../../src/pdf/raster';
import type { decodeJpegXl as Decode } from '../../src/pdf/jpeg-xl-decode';
import type { jpegXlModule as Codec } from '../../src/pdf/jpeg-xl';

test('one quality-80 JPEG XL cache image yields real coarse, screen and final pixels', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/browser/pdf-rendering-harness.html');
  const result = await page.evaluate(async () => {
    const documentsPath = '/src/pdf/documents.ts',
      imagesPath = '/src/pdf/page-images.ts',
      fixturePath = '/tests/browser/pdf-fixtures.ts';
    const { PdfDocuments } = (await import(documentsPath)) as {
      PdfDocuments: typeof Documents;
    };
    const { PageImages, pageImageKey } = (await import(imagesPath)) as {
      PageImages: typeof Images;
      pageImageKey: typeof Key;
    };
    const { planClarityPdf } = (await import(fixturePath)) as {
      planClarityPdf: typeof Fixture;
    };
    const source = planClarityPdf();
    const documents = new PdfDocuments(() => Promise.resolve(source.slice()));
    const [sheet] = await documents.import('jxl-test', 'Linework.pdf', source);
    if (!sheet) throw new Error('Missing JPEG XL fixture');
    const stored = new Map<string, Uint8Array>();
    let saved!: () => void;
    const savedMaster = new Promise<void>((resolve) => {
      saved = resolve;
    });
    const dimension = 2048;
    const key = pageImageKey(sheet, dimension);
    const store = {
      read: (key: string) => Promise.resolve(stored.get(key)?.slice() ?? null),
      exists: (key: string) => Promise.resolve(stored.has(key)),
      write: (key: string, bytes: Uint8Array) => {
        stored.set(key, bytes.slice());
        if (key === pageImageKey(sheet, dimension)) saved();
        return Promise.resolve();
      },
    };
    const first = new PageImages(
      (sheet, dimension, signal, paused, priority) =>
        documents.raster(sheet, dimension, signal, paused, priority, true),
      store,
    );
    const cached = new PageImages(() => {
      throw new Error('Saved JXL must not rerender the PDF');
    }, store);
    const pixels = (
      lease: Pick<RasterLease, 'source' | 'width' | 'height'>,
    ) => {
      const canvas = document.createElement('canvas');
      canvas.width = lease.width;
      canvas.height = lease.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Missing comparison canvas');
      context.drawImage(lease.source, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const stages: {
      stage: string;
      width: number;
      height: number;
      ink: number;
    }[] = [];
    const original = await first.acquire(sheet, dimension);
    let final: RasterLease | undefined;
    try {
      await savedMaster;
      final = await cached.acquire(sheet, dimension, undefined, {
        dimension: 512,
        onProgress(lease, stage) {
          const data = pixels(lease);
          let ink = 0;
          for (let i = 0; i < data.length; i += 4)
            if ((data[i] ?? 255) < 240) ink++;
          stages.push({ stage, width: lease.width, height: lease.height, ink });
          lease.release();
        },
      });
      const before = pixels(original),
        after = pixels(final);
      let error = 0,
        beforeInk = 0,
        afterInk = 0;
      for (let i = 0; i < before.length; i += 4) {
        for (let channel = 0; channel < 3; channel++)
          error += Math.abs(
            (before[i + channel] ?? 0) - (after[i + channel] ?? 0),
          );
        if ((before[i] ?? 255) < 200) beforeInk++;
        if ((after[i] ?? 255) < 200) afterInk++;
      }
      const bytes = stored.get(key);
      if (!bytes) throw new Error('Missing encoded JPEG XL master');
      const decodePath = '/src/pdf/jpeg-xl-decode.ts',
        codecPath = '/src/pdf/jpeg-xl.ts';
      const { decodeJpegXl } = (await import(decodePath)) as {
        decodeJpegXl: typeof Decode;
      };
      const { jpegXlModule } = (await import(codecPath)) as {
        jpegXlModule: typeof Codec;
      };
      const codec = await jpegXlModule();
      const flush = codec._bw_decoder_flush.bind(codec),
        dc = codec._bw_decoder_dc.bind(codec);
      let flushes = 0,
        dcImages = 0;
      codec._bw_decoder_flush = (decoder) => {
        flushes++;
        return flush(decoder);
      };
      codec._bw_decoder_dc = (decoder) => {
        const pointer = dc(decoder);
        if (pointer) dcImages++;
        return pointer;
      };
      const fitStages: {
        stage: string;
        dimension: number;
        ink: number;
        fullFlushes: number;
      }[] = [];
      try {
        const fit = await decodeJpegXl(
          bytes,
          () => true,
          (bitmap, stage) => {
            const data = pixels({
              source: bitmap,
              width: bitmap.width,
              height: bitmap.height,
            });
            let ink = 0;
            for (let i = 0; i < data.length; i += 4)
              if ((data[i] ?? 255) < 240) ink++;
            fitStages.push({
              stage,
              dimension: Math.max(bitmap.width, bitmap.height),
              ink,
              fullFlushes: flushes,
            });
            bitmap.close();
          },
          128,
        );
        fit.close();
      } finally {
        codec._bw_decoder_flush = flush;
        codec._bw_decoder_dc = dc;
      }
      return {
        stages,
        fitStages,
        dcImages,
        fullFlushes: flushes,
        header: [...bytes.slice(0, 2)],
        encodedBytes: bytes.length,
        width: final.width,
        height: final.height,
        expectedWidth: original.width,
        expectedHeight: original.height,
        meanError: error / ((before.length / 4) * 3),
        inkRatio: afterInk / beforeInk,
      };
    } finally {
      original.release();
      final?.release();
      first.clear();
      cached.clear();
      await documents.clear();
    }
  });
  await info.attach('jpeg-xl', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  expect(result.header).toEqual([255, 10]);
  expect(result.stages.map((stage) => stage.stage)).toEqual([
    'coarse',
    'screen',
  ]);
  expect(
    Math.max(result.stages[0]?.width ?? 0, result.stages[0]?.height ?? 0),
  ).toBe(256);
  expect(
    Math.max(result.stages[1]?.width ?? 0, result.stages[1]?.height ?? 0),
  ).toBe(512);
  expect(result.stages.every((stage) => stage.ink > 0)).toBe(true);
  expect(
    result.fitStages.map((stage) => [stage.stage, stage.dimension]),
  ).toEqual([
    ['coarse', 64],
    ['screen', 128],
  ]);
  expect(result.fitStages.every((stage) => stage.ink > 0)).toBe(true);
  expect(result.dcImages).toBe(1);
  expect(result.fullFlushes).toBe(0);
  expect([result.width, result.height]).toEqual([
    result.expectedWidth,
    result.expectedHeight,
  ]);
  expect(result.meanError).toBeLessThan(3);
  expect(result.inkRatio).toBeGreaterThan(0.9);
  expect(result.inkRatio).toBeLessThan(1.1);
  expect(errors).toEqual([]);
});
