import type { AssetRange } from '../../src/platform/storage-model';

const encoder = new TextEncoder();

function join(parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function stream(content: string | Uint8Array, dictionary = ''): Uint8Array {
  const bytes = typeof content === 'string' ? encoder.encode(content) : content;
  return join([
    encoder.encode(
      `<< /Length ${String(bytes.length)} ${dictionary} >>\nstream\n`,
    ),
    bytes,
    encoder.encode('\nendstream'),
  ]);
}

/** Small uncompressed PDFs keep each rendering feature inspectable. */
function pdf(objects: (string | Uint8Array)[]): Uint8Array {
  const header = encoder.encode('%PDF-1.7\n');
  const parts: Uint8Array[] = [header];
  const offsets = [0];
  let length = header.length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const part = join([
      encoder.encode(`${String(index + 1)} 0 obj\n`),
      typeof object === 'string' ? encoder.encode(object) : object,
      encoder.encode('\nendobj\n'),
    ]);
    parts.push(part);
    length += part.length;
  });
  parts.push(
    encoder.encode(
      `xref\n0 ${String(offsets.length)}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
        .join(
          '',
        )}trailer\n<< /Size ${String(offsets.length)} /Root 1 0 R >>\nstartxref\n${String(length)}\n%%EOF\n`,
    ),
  );
  return join(parts);
}

/** Synthetic linearized pages: unrotated red, rotated blue, and green with UserUnit 2. */
export function linearizedPdf(): Uint8Array {
  const bytes = atob(
    'JVBERi0xLjcKJb/3ov4KOCAwIG9iago8PCAvTGluZWFyaXplZCAxIC9MIDE3NTcgL0ggWyA1ODcgMTI1IF0gL08gMTEgL0UgOTQyIC9OIDMgL1QgMTQ3OSA+PgplbmRvYmoKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKeHJlZgo4IDYKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwNTAxIDAwMDAwIG4gCjAwMDAwMDA1ODcgMDAwMDAgbiAKMDAwMDAwMDcxMiAwMDAwMCBuIAowMDAwMDAwODM0IDAwMDAwIG4gCjAwMDAwMDA4NTYgMDAwMDAgbiAKdHJhaWxlciA8PCAvUm9vdCA5IDAgUiAvU2l6ZSAxNCAvUHJldiAxNDcxICAgICAgICAgICAgICAgICAgL0lEIFs8YzM5MjU0MGU0NTc0YzM4NmMyYWRjMmEyYzI5ZWMzODg+PDFlZWZlZjg0ZTZmZjM4MTg1NjY4Y2IyMzZhMTA5NzgyPl0gPj4Kc3RhcnR4cmVmCjAKJSVFT0YKOSAwIG9iago8PCAvSW5mbyA8PCAvUHJvZHVjZXIgKE11UERGIDEuMjguMikgPj4gL1BhZ2VzIDcgMCBSIC9UeXBlIC9DYXRhbG9nID4+CmVuZG9iagoxMCAwIG9iago8PCAvUyA0MCAvTGVuZ3RoIDY4ID4+CnN0cmVhbQoAAAADAAACSwAAAAAA3wAEAAAAAAAAAAAA3wAEAAAAAgAAAARwsHCwAAAAAAAAAAAAAAADAAAAAwAAAAAAFgAHyAIAAAplbmRzdHJlYW0KZW5kb2JqCjExIDAgb2JqCjw8IC9Db250ZW50cyBbIDEzIDAgUiBdIC9NZWRpYUJveCBbIDAgMCAxMjggOTYgXSAvUGFyZW50IDcgMCBSIC9SZXNvdXJjZXMgMTIgMCBSIC9Sb3RhdGUgMCAvVHlwZSAvUGFnZSA+PgplbmRvYmoKMTIgMCBvYmoKPDwgPj4KZW5kb2JqCjEzIDAgb2JqCjw8IC9MZW5ndGggMzUgPj4Kc3RyZWFtCgpxCjAgMCAxMjggOTYgcmUKaAoxIDAgMCByZyBmClEKCiUKCmVuZHN0cmVhbQplbmRvYmoKMSAwIG9iago8PCAvQ29udGVudHMgWyAzIDAgUiBdIC9NZWRpYUJveCBbIDAgMCAxMjggOTYgXSAvUGFyZW50IDcgMCBSIC9SZXNvdXJjZXMgMiAwIFIgL1JvdGF0ZSA5MCAvVHlwZSAvUGFnZSA+PgplbmRvYmoKMiAwIG9iago8PCA+PgplbmRvYmoKMyAwIG9iago8PCAvTGVuZ3RoIDMyID4+CnN0cmVhbQoKcQowIDAgMTI4IDk2IHJlCmgKMCAwIDEgcmcgZgpRCgplbmRzdHJlYW0KZW5kb2JqCjQgMCBvYmoKPDwgL0NvbnRlbnRzIFsgNiAwIFIgXSAvTWVkaWFCb3ggWyAwIDAgMTI4IDk2IF0gL1BhcmVudCA3IDAgUiAvUmVzb3VyY2VzIDUgMCBSIC9Sb3RhdGUgMCAvVHlwZSAvUGFnZSAvVXNlclVuaXQgMiA+PgplbmRvYmoKNSAwIG9iago8PCA+PgplbmRvYmoKNiAwIG9iago8PCAvTGVuZ3RoIDMyID4+CnN0cmVhbQoKcQowIDAgMTI4IDk2IHJlCmgKMCAxIDAgcmcgZgpRCgplbmRzdHJlYW0KZW5kb2JqCjcgMCBvYmoKPDwgL0NvdW50IDMgL0tpZHMgWyAxMSAwIFIgMSAwIFIgNCAwIFIgXSAvVHlwZSAvUGFnZXMgPj4KZW5kb2JqCnhyZWYKMCA4CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDk0MiAwMDAwMCBuIAowMDAwMDAxMDYyIDAwMDAwIG4gCjAwMDAwMDEwODMgMDAwMDAgbiAKMDAwMDAwMTE2NSAwMDAwMCBuIAowMDAwMDAxMjk2IDAwMDAwIG4gCjAwMDAwMDEzMTcgMDAwMDAgbiAKMDAwMDAwMTM5OSAwMDAwMCBuIAp0cmFpbGVyIDw8IC9TaXplIDggL0lEIFs8YzM5MjU0MGU0NTc0YzM4NmMyYWRjMmEyYzI5ZWMzODg+PDFlZWZlZjg0ZTZmZjM4MTg1NjY4Y2IyMzZhMTA5NzgyPl0gPj4Kc3RhcnR4cmVmCjIxNgolJUVPRgo=',
  );
  return Uint8Array.from(bytes, (value) => value.charCodeAt(0));
}

/** Several full architectural sheets exercise pixel transfer, encoding and eviction. */
export function preparationPdf(): Uint8Array {
  const count = 7;
  const objects: (string | Uint8Array)[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: count }, (_, index) => `${String(3 + index * 2)} 0 R`).join(' ')}] /Count ${String(count)} >>`,
  ];
  for (let index = 0; index < count; index++) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 2592 3456] /Resources << >> /Contents ${String(4 + index * 2)} 0 R >>`,
      stream(
        Array.from(
          { length: 400 },
          (_, line) =>
            `0.2 w ${String(60 + index)} ${String(60 + line * 8)} m 2500 ${String(65 + line * 8)} l S`,
        ).join('\n'),
      ),
    );
  }
  return pdf(objects);
}

export function planClarityPdf(): Uint8Array {
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1728 2592] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    stream(
      '0 g BT /F1 12 Tf 72 2492 Td (FLUID-APPLIED WATER-RESISTIVE AND AIR BARRIER) Tj ET\n0 G 0.2 w 72 2470 m 650 2450 l S\n1 0 0 rg 72 2412 24 12 re f',
    ),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

export function vectorPdf(): Uint8Array {
  const shapes = Array.from(
    { length: 256 },
    (_, index) =>
      `q ${String(index % 2)} 0 ${String(1 - (index % 2))} rg ${String(index % 64)} ${String(Math.floor(index / 64))} 1 1 re f Q`,
  );
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 64 64] /Resources << >> /Contents 4 0 R >>',
    stream(
      `${shapes.join('\n')}\n1 0 0 rg 0 0 32 64 re f\n0 0 1 rg 32 0 32 64 re f\n`,
    ),
  ]);
}

export function transferPdf(): Uint8Array {
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 128 96] /Resources << /ExtGState << /TR 5 0 R >> /XObject << /Im 7 0 R >> /Shading << /Sh 8 0 R >> /Pattern << /P 9 0 R >> >> /Contents 4 0 R >>',
    stream(
      '/TR gs 1 0 0 rg 0 48 64 48 re f\nq 64 0 0 48 64 48 cm /Im Do Q\nq 0 0 64 48 re W n /Sh sh Q\n/Pattern cs /P scn 64 0 64 48 re f',
    ),
    '<< /Type /ExtGState /TR 6 0 R >>',
    '<< /FunctionType 2 /Domain [0 1] /Range [0 1] /C0 [1] /C1 [0] /N 1 >>',
    stream(
      'ff00000000ff>',
      '/Type /XObject /Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode',
    ),
    '<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 64 0] /Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >> /Extend [true true] >>',
    stream(
      '0 1 0 rg 0 0 8 8 re f 0 0 1 rg 0 0 4 4 re f',
      '/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 8 8] /XStep 8 /YStep 8 /Resources << >>',
    ),
  ]);
}

export function thinPdf(): Uint8Array {
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 1] /Resources << >> /Contents 4 0 R >>',
    stream('1 0 0 rg 0 0 50 1 re f 0 0 1 rg 50 0 50 1 re f'),
  ]);
}

export function transparencyPdf(): Uint8Array {
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 128 96] /Resources << /ExtGState << /Blend 5 0 R /Mask 6 0 R /AlphaMask 11 0 R >> /XObject << /Group 10 0 R >> >> /Contents 4 0 R >>',
    stream(
      '1 0 0 rg 0 0 128 96 re f\nq /Blend gs 0 0 1 rg 8 8 56 80 re f Q\nq /Mask gs 0 1 0 rg 64 48 64 48 re f Q\nq /AlphaMask gs 0 0 1 rg 64 0 64 48 re f Q\nq /Group Do Q',
    ),
    '<< /Type /ExtGState /ca 0.5 /BM /Multiply >>',
    '<< /Type /ExtGState /SMask << /S /Luminosity /G 7 0 R /BC [0 0 0] /TR 8 0 R >> >>',
    stream(
      '0.25 g 64 48 32 48 re f 0.75 g 96 48 32 48 re f',
      '/Type /XObject /Subtype /Form /BBox [0 0 128 96] /Resources << >> /Group << /S /Transparency /CS /DeviceGray /I true >>',
    ),
    '<< /FunctionType 2 /Domain [0 1] /Range [0 1] /C0 [0.2] /C1 [0.8] /N 1 >>',
    '<< /Type /ExtGState /ca 0.5 >>',
    stream(
      '/Half gs 1 1 0 rg 16 24 40 48 re f 0 1 1 rg 32 32 24 32 re f',
      '/Type /XObject /Subtype /Form /BBox [0 0 64 96] /Resources << /ExtGState << /Half 9 0 R >> >> /Group << /S /Transparency /CS /DeviceRGB /I true /K true >>',
    ),
    '<< /Type /ExtGState /SMask << /S /Alpha /G 12 0 R /TR 8 0 R >> >>',
    stream(
      '/Half gs 1 g 64 0 64 48 re f',
      '/Type /XObject /Subtype /Form /BBox [0 0 128 96] /Resources << /ExtGState << /Half 9 0 R >> >> /Group << /S /Transparency /CS /DeviceRGB /I true >>',
    ),
  ]);
}

export function rotatedCropPdf(rotation = 90, userUnit = 1): Uint8Array {
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 80] /CropBox [10 20 90 60] /Rotate ${String(rotation)} /UserUnit ${String(userUnit)} /Resources << >> /Contents 4 0 R >>`,
    stream(
      '1 0 0 rg 0 0 50 80 re f 0 0 1 rg 50 0 50 80 re f 0 1 0 rg 10 20 12 10 re f',
    ),
  ]);
}

export function viewAnnotationPdf(): Uint8Array {
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 128 96] /Resources << >> /Contents 4 0 R /Annots [5 0 R] >>',
    stream('0 0 1 rg 0 0 128 96 re f'),
    // Flags zero makes this appearance viewable without the Print flag.
    '<< /Type /Annot /Subtype /Square /Rect [16 24 80 72] /F 0 /AP << /N 6 0 R >> >>',
    stream(
      '1 0 0 rg 0 0 64 48 re f',
      '/Type /XObject /Subtype /Form /BBox [0 0 64 48] /Resources << >>',
    ),
  ]);
}

export function widgetPdf(): Uint8Array {
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] >> /PageLabels << /Nums [0 << /P (A-) /S /D /St 3 >>] >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 128 96] /Resources << >> /Contents 4 0 R /Annots [5 0 R] >>',
    stream('0 0 1 rg 0 0 128 96 re f'),
    '<< /Type /Annot /Subtype /Widget /FT /Tx /T (Note) /V (Field value) /Rect [16 24 80 72] /F 0 /AP << /N 6 0 R >> >>',
    stream(
      '1 0 0 rg 0 0 64 48 re f',
      '/Type /XObject /Subtype /Form /BBox [0 0 64 48] /Resources << >>',
    ),
  ]);
}

export function hiddenLayerPdf(): Uint8Array {
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R /OCProperties 7 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 64 64] /Resources << /Properties << /Hidden 5 0 R >> >> /Contents 4 0 R >>',
    stream(
      '0 0 1 rg 0 0 64 64 re f /OC /Hidden BDC 1 0 0 rg 0 0 64 64 re f EMC',
    ),
    '<< /Type /OCG /Name (Hidden drawing) >>',
    stream(' '.repeat(600_000)),
    '<< /OCGs [5 0 R] /D << /BaseState /ON /OFF [5 0 R] >> >>',
    stream(' '.repeat(600_000)),
  ]);
}

export function fallbackBoxPdf(
  kind: 'missing' | 'empty' | 'disjoint',
): Uint8Array {
  const box =
    kind === 'missing'
      ? ''
      : kind === 'empty'
        ? '/MediaBox [0 0 0 0]'
        : '/MediaBox [0 0 64 64] /CropBox [70 70 80 80]';
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R ${box} /Resources << >> /Contents 4 0 R >>`,
    stream('0 0 1 rg 0 0 612 792 re f'),
  ]);
}

export async function embeddedFontPdf(): Promise<Uint8Array> {
  // This fixture's dependency is development-only; no PDF.js assets ship.
  // This 17 KiB CFF is shipped by the pinned PDF.js package. Embed its actual
  // program so both renderers must decode the embedded font instead of falling back.
  const response = await fetch('/pdfjs/standard_fonts/FoxitFixed.pfb');
  if (!response.ok) throw new Error('Embedded font fixture unavailable');
  const font = new Uint8Array(await response.arrayBuffer());
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 128 96] /Resources << /Font << /F 5 0 R >> >> /Contents 4 0 R >>',
    stream(
      '0 0 0 rg BT /F 12 Tf 1 0 0 1 8 72 Tm (A101 PLAN) Tj 0 -20 Td (Wg 012345) Tj ET',
    ),
    `<< /Type /Font /Subtype /Type1 /BaseFont /ChromFixedOTF /FirstChar 32 /LastChar 126 /Widths [${Array.from({ length: 95 }, () => '600').join(' ')}] /Encoding /WinAnsiEncoding /FontDescriptor 6 0 R >>`,
    '<< /Type /FontDescriptor /FontName /ChromFixedOTF /Flags 33 /FontBBox [-23 -250 715 805] /ItalicAngle 0 /Ascent 805 /Descent -250 /CapHeight 562 /StemV 80 /FontFile3 7 0 R >>',
    stream(font, '/Subtype /Type1C'),
  ]);
}

/** Open a later leaf without first enumerating the nested page tree. */
export function nestedPagesPdf() {
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 4 >>',
    '<< /Type /Pages /Parent 2 0 R /Kids [5 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Pages /Parent 2 0 R /Kids [7 0 R 8 0 R] /Count 2 >>',
    ...[3, 3, 4, 4].map(
      (parent, index) =>
        `<< /Type /Page /Parent ${String(parent)} 0 R /MediaBox [0 0 64 64] /Resources << >> /Contents ${index === 3 ? '10' : '9'} 0 R >>`,
    ),
    stream('1 0 0 rg 0 0 64 64 re f'),
    stream('0 0 1 rg 0 0 64 64 re f'),
  ]);
}

/** Unused streams occupy gaps; allocate only the ranges the engine requests. */
export function sparsePdf(twoPages = false) {
  const compact = new TextDecoder()
    .decode(vectorPdf())
    .replace(
      '/Kids [3 0 R] /Count 1',
      twoPages ? '/Kids [3 0 R 7 0 R] /Count 2' : '/Kids [3 0 R] /Count 1',
    );
  const contentStart = compact.indexOf('4 0 obj\n');
  const segments: { offset: number; bytes: Uint8Array }[] = [];
  const offsets = [
    0,
    ...[1, 2, 3].map((id) => compact.indexOf(`${String(id)} 0 obj\n`)),
  ];
  let cursor = 0;
  const append = (text: string) => {
    const bytes = encoder.encode(text);
    segments.push({ offset: cursor, bytes });
    cursor += bytes.length;
  };
  const padding = (id: number) => {
    const length = 4 * 1024 * 1024;
    offsets[id] = cursor;
    append(`${String(id)} 0 obj\n<< /Length ${String(length)} >>\nstream\n`);
    cursor += length;
    append('\nendstream\nendobj\n');
  };
  append(compact.slice(0, contentStart));
  if (twoPages) {
    offsets[7] = cursor;
    append(
      '7 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 64 64] /Resources << >> /Contents 8 0 R >>\nendobj\n',
    );
    offsets[8] = cursor;
    const content = '1 0 0 rg 0 0 32 64 re f 0 0 1 rg 32 0 32 64 re f';
    append(
      `8 0 obj\n<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream\nendobj\n`,
    );
  }
  padding(5);
  const contentOffset = cursor;
  offsets[4] = cursor;
  append(compact.slice(contentStart, compact.indexOf('xref\n')));
  padding(6);
  const xrefOffset = cursor;
  append(
    `xref\n0 ${String(offsets.length)}\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
      .join(
        '',
      )}trailer\n<< /Size ${String(offsets.length)} /Root 1 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`,
  );
  const reads: { offset: number; length: number }[] = [];
  const range: AssetRange = {
    length: cursor,
    read(offset, length) {
      reads.push({ offset, length });
      const bytes = new Uint8Array(length).fill(32);
      for (const segment of segments) {
        const start = Math.max(offset, segment.offset);
        const end = Math.min(
          offset + length,
          segment.offset + segment.bytes.length,
        );
        if (end > start)
          bytes.set(
            segment.bytes.subarray(
              start - segment.offset,
              end - segment.offset,
            ),
            start - offset,
          );
      }
      return Promise.resolve(bytes);
    },
  };
  return { range, reads, contentOffset };
}
