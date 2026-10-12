/// <reference types="@cloudflare/workers-types" />

// Cloudflare Pages Function: POST /api/answer
// Uses the free Workers AI binding to stream an interview answer.

interface Env {
  AI: Ai;
}

// Free model with strong instruction-following. Swap for a smaller/faster one
// (e.g. "@cf/meta/llama-3.1-8b-instruct-fast") if you hit the daily allowance.
const MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

const SYSTEM_INSTRUCTIONS = `You are an elite interview coach speaking AS THE CANDIDATE, in real time.
You receive the running transcript, the interviewer's most recent question, and the candidate's
résumé + job description.

Output ONLY the words the candidate should say — first person, natural, confident.

Hard rules:
- START WITH THE SUBSTANCE. No opening filler — never begin with "Great question", "Sure", "Well",
  "Honestly", "So", "I think", "In my experience", or by restating the question. The first words
  must be the actual answer.
- Length: balanced. Substantive but not a speech — usually 3-6 sentences. Don't pad, don't be a
  one-liner.
- Tie the answer to WHERE THE CANDIDATE ACTUALLY USED IT in the résumé — name the real project,
  role, or company and how they applied it (e.g. "when I built the payments dashboard at my last role,
  I used this to…"). The example must come from the résumé, not a made-up scenario.
- Ground every specific in the résumé. Never invent employers, numbers, or experience; if the résumé
  lacks a detail, lean on the closest real experience it does contain.
- Behavioral → one real story from the résumé with an outcome (situation → action → result), spoken
  naturally, not labeled.
- Technical concept → direct definition first, then a real example from the résumé of where the
  candidate used it and what it achieved.
- Coding / problem question → state the approach in 1-2 sentences, then a clean, correct solution with code.
- Answer the EXACT question asked. No preamble, no meta, no sign-off.`;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: {
    resume?: string;
    jobDescription?: string;
    transcript?: string;
    question?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    resume = "",
    jobDescription = "",
    transcript = "",
    question = "",
  } = body;

  if (!question.trim()) {
    return Response.json({ error: "No question provided" }, { status: 400 });
  }

  const system =
    `${SYSTEM_INSTRUCTIONS}\n\n` +
    `CANDIDATE RESUME:\n${resume || "(none provided)"}\n\n` +
    `JOB DESCRIPTION:\n${jobDescription || "(none provided)"}`;

  const user =
    `RECENT TRANSCRIPT:\n${transcript || "(none)"}\n\n` +
    `INTERVIEWER JUST ASKED:\n"${question}"\n\n` +
    `Give the candidate's spoken answer now.`;

  try {
    const stream = (await env.AI.run(MODEL, {
      stream: true,
      max_tokens: 1024,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    })) as ReadableStream;

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      },
    });
  } catch (err: any) {
    return Response.json({ error: `AI Error: ${err?.message || err}` }, { status: 500 });
  }
};
