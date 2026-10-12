import { useRef, useState } from "react";
import type { DragEvent } from "react";
// Vite emits the pdf.js worker as a separate asset and gives us its URL.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Extract plain text from a dropped/selected résumé file.
async function parseFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) {
    return (await file.text()).trim();
  }

  if (name.endsWith(".docx")) {
    const mammoth: any = await import("mammoth/mammoth.browser");
    const arrayBuffer = await file.arrayBuffer();
    const { value } = await mammoth.extractRawText({ arrayBuffer });
    return (value || "").trim();
  }

  if (name.endsWith(".pdf")) {
    const pdfjs: any = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const data = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text +=
        content.items
          .map((it: any) => ("str" in it ? it.str : ""))
          .join(" ") + "\n";
    }
    return text.trim();
  }

  throw new Error("Unsupported file — use .pdf, .docx, .txt, or .md (or paste below).");
}

interface Props {
  value: string;
  onChange: (text: string) => void;
}

export default function ResumeField({ value, onChange }: Props) {
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<{ kind: "idle" | "loading" | "done" | "error"; msg: string }>(
    { kind: "idle", msg: "" },
  );
  const inputRef = useRef<HTMLInputElement | null>(null);

  const ingest = async (file: File) => {
    setStatus({ kind: "loading", msg: `Reading ${file.name}…` });
    try {
      const text = await parseFile(file);
      if (!text) throw new Error("No text found in that file.");
      onChange(text);
      setStatus({ kind: "done", msg: `${file.name} · ${text.length.toLocaleString()} chars imported` });
    } catch (err) {
      setStatus({ kind: "error", msg: (err as Error).message });
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) ingest(file);
  };

  return (
    <div className="field">
      <label>Your résumé</label>

      <div
        className={`dropzone ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
          <path
            d="M12 16V4m0 0 4 4m-4-4-4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>
          <strong>Drag &amp; drop</strong> your résumé, or <u>browse</u>
        </span>
        <small>PDF · DOCX · TXT · MD</small>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) ingest(file);
            e.target.value = "";
          }}
        />
      </div>

      {status.kind !== "idle" && (
        <p className={`drop-status ${status.kind}`}>{status.msg}</p>
      )}

      <textarea
        placeholder="…or paste your résumé here. Every answer is grounded in this."
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
