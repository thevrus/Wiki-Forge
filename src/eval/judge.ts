import { tryGenerateJSON } from "../providers/json"
import type { LLMProvider } from "../providers/types"
import { JudgementSchema } from "../schemas"
import type { RetrievedDoc } from "./retrieve"

export type Judgement = {
  score: number // 0..1
  missing: string[]
  hallucinated: string[]
  notes: string
}

const ANSWER_SYSTEM =
  "You are answering questions using ONLY the provided documentation excerpts. If the excerpts don't contain the answer, say so. Be concise: 2-4 sentences. Do not invent facts beyond what the excerpts state."

function formatExcerpts(docs: RetrievedDoc[]): string {
  return docs.map((d) => `### ${d.path}\n\n${d.excerpt}`).join("\n\n---\n\n")
}

export async function answerQuestion(
  question: string,
  retrieved: RetrievedDoc[],
  provider: LLMProvider,
): Promise<string> {
  if (retrieved.length === 0) {
    return "No relevant documentation found."
  }
  const prompt = `Question: ${question}\n\nDocumentation:\n\n${formatExcerpts(retrieved)}\n\nAnswer:`
  return provider.generate(prompt, ANSWER_SYSTEM)
}

const JUDGE_SYSTEM = `You score whether an answer contains a set of expected facts.

For each expected fact, decide if it is present in the answer (exact wording not required — equivalent meaning counts).
Also flag any claims in the answer that are NOT present in the expected facts AND NOT in the provided documentation excerpts — those are hallucinations.

Respond with a JSON object matching:
- present: facts the answer contains
- missing: facts the answer does not contain
- hallucinated: claims in the answer not supported by docs or expected facts
- notes: one sentence summary`

export async function judgeAnswer(
  question: string,
  expectedFacts: string[],
  answer: string,
  retrieved: RetrievedDoc[],
  provider: LLMProvider,
): Promise<Judgement> {
  const prompt = [
    `QUESTION: ${question}`,
    "",
    `EXPECTED FACTS:\n${expectedFacts.map((f) => `- ${f}`).join("\n")}`,
    "",
    `ANSWER:\n${answer}`,
    "",
    `DOCUMENTATION EXCERPTS (for hallucination check):\n${retrieved.map((d) => `### ${d.path}\n${d.excerpt}`).join("\n\n")}`,
  ].join("\n")

  const parsed = await tryGenerateJSON(
    provider,
    JudgementSchema,
    prompt,
    JUDGE_SYSTEM,
  )
  if (!parsed) {
    return {
      score: 0,
      missing: [],
      hallucinated: [],
      notes: "judge parse failed",
    }
  }
  const score =
    expectedFacts.length === 0 ? 1 : parsed.present.length / expectedFacts.length
  return {
    score,
    missing: parsed.missing,
    hallucinated: parsed.hallucinated,
    notes: parsed.notes,
  }
}
