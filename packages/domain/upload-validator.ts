/**
 * TR09 Upload Validation:
 * Validates document byte signatures (magic bytes), structural constraints,
 * and character encoding before persisting into FileStore.
 */

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10 MiB
const ALLOWED_EXTENSIONS = new Set(['pdf', 'docx', 'txt', 'md']);

export type ValidatedUpload = {
  ext: 'pdf' | 'docx' | 'txt' | 'md';
  mimeType: string;
};

export function validateUpload(buffer: Buffer, rawExt: string): ValidatedUpload {
  if (!buffer || buffer.length === 0) {
    throw Object.assign(Error('Uploaded file is empty'), {status: 400});
  }

  if (buffer.length > MAX_UPLOAD_SIZE) {
    throw Object.assign(Error('Upload exceeds 10 MB limit'), {status: 413});
  }

  const ext = rawExt.toLowerCase().trim();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw Object.assign(Error('Unsupported file type. Use DOCX, PDF, TXT or Markdown up to 10 MB.'), {status: 400});
  }

  switch (ext) {
    case 'pdf': {
      // PDF files must begin with '%PDF-' (0x25, 0x50, 0x44, 0x46, 0x2D)
      if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
        throw Object.assign(Error('Invalid PDF format: missing %PDF- header signature'), {status: 400});
      }
      return {ext: 'pdf', mimeType: 'application/pdf'};
    }

    case 'docx': {
      // DOCX files are OpenXML ZIP packages starting with 'PK\x03\x04' (0x50, 0x4B, 0x03, 0x04)
      if (
        buffer.length < 4 ||
        buffer[0] !== 0x50 ||
        buffer[1] !== 0x4B ||
        buffer[2] !== 0x03 ||
        buffer[3] !== 0x04
      ) {
        throw Object.assign(Error('Invalid DOCX format: missing ZIP header signature (PK)'), {status: 400});
      }
      return {ext: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
    }

    case 'txt':
    case 'md': {
      // Text and Markdown documents must be valid UTF-8 and contain no null bytes
      if (buffer.includes(0x00)) {
        throw Object.assign(Error(`Binary content detected in ${ext.toUpperCase()} document`), {status: 400});
      }
      try {
        const text = new TextDecoder('utf-8', {fatal: true}).decode(buffer);
        if (text.trim().length === 0) {
          throw Object.assign(Error('Text file contains no printable content'), {status: 400});
        }
      } catch (e: any) {
        if (e.status) throw e;
        throw Object.assign(Error('Document is not valid UTF-8 text'), {status: 400});
      }
      return {
        ext: ext as 'txt' | 'md',
        mimeType: ext === 'md' ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8'
      };
    }

    default:
      throw Object.assign(Error('Unsupported file type'), {status: 400});
  }
}
