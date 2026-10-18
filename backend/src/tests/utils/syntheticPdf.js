/**
 * Synthetic PDF builder for tests — an ordinary menu-like document.
 *
 * Builds a valid PDF in memory: `pages` pages of text (Helvetica, `linesPerPage`
 * lines each, every line names its page: "Page 7 line 3: Borsch 15 rub"), and,
 * when `imageBytes` > 0, one uncompressed RGB image of about that size drawn
 * on every page — the bulk of a real menu file is its photos. Plain objects,
 * a correct cross-reference table; nothing a parser must work hard on.
 */

const header = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1');

/**
 * @param {Object} [options]
 * @param {number} [options.pages=1]
 * @param {number} [options.linesPerPage=20]
 * @param {number} [options.imageBytes=0] - Approximate size of the shared image
 * @returns {Buffer}
 */
export const buildSyntheticPdf = ({ pages = 1, linesPerPage = 20, imageBytes = 0 } = {}) => {
  const objects = []; // index i → object number i + 1, value: Buffer of the body
  const add = (body) => {
    objects.push(typeof body === 'string' ? Buffer.from(body, 'latin1') : body);
    return objects.length;
  };
  const stream = (dict, data) => Buffer.concat([
    Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, 'latin1'),
    data,
    Buffer.from('\nendstream', 'latin1'),
  ]);

  const catalog = add(''); // filled below, once the page tree number is known
  const pageTree = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  let image = null;
  let side = 0;
  if (imageBytes > 0) {
    side = Math.max(1, Math.floor(Math.sqrt(imageBytes / 3)));
    const pixels = Buffer.alloc(side * side * 3);
    for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 31) & 0xff;
    image = add(stream(
      `/Type /XObject /Subtype /Image /Width ${side} /Height ${side} /ColorSpace /DeviceRGB /BitsPerComponent 8`,
      pixels,
    ));
  }

  const kids = [];
  for (let page = 1; page <= pages; page += 1) {
    const lines = [];
    for (let line = 1; line <= linesPerPage; line += 1) {
      lines.push(`(Page ${page} line ${line}: Borsch ${10 + line} rub) Tj 0 -14 Td`);
    }
    const drawImage = image ? `q 200 0 0 200 350 550 cm /Im1 Do Q\n` : '';
    const content = add(stream('', Buffer.from(
      `${drawImage}BT /F1 11 Tf 40 800 Td\n${lines.join('\n')}\nET`,
      'latin1',
    )));
    const resources = image
      ? `<< /Font << /F1 ${font} 0 R >> /XObject << /Im1 ${image} 0 R >> >>`
      : `<< /Font << /F1 ${font} 0 R >> >>`;
    kids.push(add(
      `<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 595 842] /Resources ${resources} /Contents ${content} 0 R >>`,
    ));
  }

  objects[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pageTree} 0 R >>`, 'latin1');
  objects[pageTree - 1] = Buffer.from(
    `<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(' ')}] /Count ${kids.length} >>`,
    'latin1',
  );

  const parts = [header];
  const offsets = [];
  let offset = header.length;
  objects.forEach((body, index) => {
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, 'latin1'),
      body,
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    offsets.push(offset);
    parts.push(chunk);
    offset += chunk.length;
  });

  const xref = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.map((value) => `${String(value).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>`,
    'startxref',
    String(offset),
    '%%EOF',
    '',
  ].join('\n');
  parts.push(Buffer.from(xref, 'latin1'));

  return Buffer.concat(parts);
};
