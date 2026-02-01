// app/static/labo/editor/pdfjs.js
export function ensurePdfJsWorker() {
  try {
    if (typeof window.pdfjsLib === "undefined") return false;
    if (!window.pdfjsLib.GlobalWorkerOptions?.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "/static/vendor/pdfjs/pdf.worker.min.js";
    }
    return true;
  } catch {
    return false;
  }
}

export async function ensurePdfJsReady() {
  if (ensurePdfJsWorker()) return;
  throw new Error("pdfjsLib indisponible (pdf.min.js non chargé).");
}
