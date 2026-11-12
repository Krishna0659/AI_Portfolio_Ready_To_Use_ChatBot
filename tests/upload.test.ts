import test from 'node:test';
import assert from 'node:assert/strict';
import {validateUpload} from '../packages/domain/upload-validator';

test('validateUpload: accepts valid document types and magic byte headers', () => {
  // Valid PDF
  const validPdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
  const pdfRes = validateUpload(validPdf, 'pdf');
  assert.equal(pdfRes.ext, 'pdf');
  assert.equal(pdfRes.mimeType, 'application/pdf');

  // Valid DOCX (starts with PK\x03\x04)
  const validDocx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('mock-docx-zip-stream')]);
  const docxRes = validateUpload(validDocx, 'docx');
  assert.equal(docxRes.ext, 'docx');
  assert.ok(docxRes.mimeType.includes('openxmlformats'));

  // Valid TXT
  const validTxt = Buffer.from('Valid plain text resume description');
  const txtRes = validateUpload(validTxt, 'txt');
  assert.equal(txtRes.ext, 'txt');

  // Valid Markdown
  const validMd = Buffer.from('# Portfolio Highlights\n- Achievement 1');
  const mdRes = validateUpload(validMd, 'md');
  assert.equal(mdRes.ext, 'md');
});

test('validateUpload: rejects disguised or corrupted files missing magic bytes', () => {
  // Fake PDF without %PDF- signature
  const fakePdf = Buffer.from('This is actually a plain text file pretending to be PDF');
  assert.throws(
    () => validateUpload(fakePdf, 'pdf'),
    /Invalid PDF format/
  );

  // Fake DOCX without PK header
  const fakeDocx = Buffer.from('Corrupted file without zip header');
  assert.throws(
    () => validateUpload(fakeDocx, 'docx'),
    /Invalid DOCX format/
  );

  // Binary content in TXT file (null bytes)
  const binaryTxt = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x57, 0x6f, 0x72, 0x6c, 0x64]);
  assert.throws(
    () => validateUpload(binaryTxt, 'txt'),
    /Binary content detected/
  );

  // Empty file
  assert.throws(
    () => validateUpload(Buffer.alloc(0), 'pdf'),
    /file is empty/
  );

  // Unsupported file extension
  assert.throws(
    () => validateUpload(Buffer.from('executable binary'), 'exe'),
    /Unsupported file type/
  );
});

