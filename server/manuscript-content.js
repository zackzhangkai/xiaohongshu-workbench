import { extractPostBody, extractPostTitle } from '../src/copy-body.js';

// A manuscript stores the publishable draft, not the conversational wrapper
// around it. Only replies with an explicitly labelled 正文 section are
// rewritten — the same never-guess contract as the chat copy button — so
// plans and free-form replies keep their full raw text.
export function publishableDraft(markdown) {
  const body = extractPostBody(markdown);
  if (!body) return null;
  // A reply may wrap the whole copy in one “整段复制” code fence; publishing
  // wants the text itself. Fences inside the body (real code samples) stay.
  const wrapped = body.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  const content = wrapped ? wrapped[1].trim() : body;
  return { title: extractPostTitle(markdown), content };
}
