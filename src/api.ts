// Streams an answer from the Cloudflare Pages Function, invoking onChunk for
// each text delta. Returns an abort function the caller can use to cancel.
//
// Workers AI emits Server-Sent Events shaped as `data: {"response":"token"}`,
// terminated by `data: [DONE]`.

export interface AnswerRequest {
  resume: string;
  jobDescription: string;
  transcript: string;
  question: string;
}

export function streamAnswer(
  body: AnswerRequest,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (message: string) => void,
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch("/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        let detail = `Server returned ${res.status}`;
        try {
          const j = await res.json();
          if (j?.error) detail = j.error;
        } catch {
          /* not JSON */
        }
        throw new Error(detail);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const evt of events) {
          // An event may contain multiple `data:` lines.
          for (const line of evt.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data) continue;
            if (data === "[DONE]") {
              onDone();
              return;
            }
            try {
              const parsed = JSON.parse(data);
              if (typeof parsed.response === "string") onChunk(parsed.response);
            } catch {
              /* ignore keep-alive / partial lines */
            }
          }
        }
      }
      onDone();
    } catch (err) {
      if (controller.signal.aborted) return;
      onError((err as Error).message);
    }
  })();

  return () => controller.abort();
}
