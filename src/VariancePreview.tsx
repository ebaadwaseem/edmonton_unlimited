import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { FormMarker } from "../shared/form-fields";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url
).toString();

export default function VariancePreview({ url, width, markers }: {
  url: string;
  width: number;
  markers: FormMarker[];
}) {
  const [pageCount, setPageCount] = useState(0);
  return (
    <Document
      file={url}
      onLoadSuccess={({ numPages }) => setPageCount(numPages)}
      loading={<p>Loading PDF…</p>}
      error={<p>Could not load the PDF preview.</p>}
    >
      {Array.from({ length: pageCount }, (_, index) => (
        <div className="variance-pdf-page" key={index}>
          <Page pageNumber={index + 1} width={width} renderTextLayer={false} renderAnnotationLayer={false} />
          {markers.filter((marker) => marker.page === index + 1).map((marker, markerIndex) => (
            <div
              className="variance-marker"
              key={`${marker.key}-${markerIndex}`}
              style={{
                top: `${marker.top * 100}%`, left: `${marker.left * 100}%`,
                width: `${marker.width * 100}%`, height: `${marker.height * 100}%`,
              }}
              role="note"
              aria-label={marker.label}
            >
              {marker.label}
            </div>
          ))}
        </div>
      ))}
    </Document>
  );
}
