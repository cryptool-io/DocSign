import { pdfjs } from 'react-pdf';

// react-pdf needs a worker. Bundle it from the installed package so the strict
// CSP on the served app never has to reach a CDN.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Count pages of a PDF in the browser (the server can't read encrypted PDFs). */
export const countPages = async (arrayBufferOrBytes) => {
  const data = arrayBufferOrBytes instanceof Uint8Array ? arrayBufferOrBytes : new Uint8Array(arrayBufferOrBytes);
  const pdf = await pdfjs.getDocument({ data }).promise;
  const n = pdf.numPages;
  await pdf.destroy();
  return n;
};

export { Document, Page } from 'react-pdf';
