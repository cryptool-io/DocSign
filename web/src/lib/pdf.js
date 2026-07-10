import { pdfjs } from 'react-pdf';

// react-pdf needs a worker. Bundle it from the installed package so the strict
// CSP on the served app never has to reach a CDN.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { Document, Page } from 'react-pdf';
