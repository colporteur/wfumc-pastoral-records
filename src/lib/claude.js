// Claude integration for the Pastoral Records app.
//
// Routes through the same `claude-proxy` Edge Function that the
// Bulletin / Sermons / Worship apps use — they all share one Supabase
// project, so the proxy is already deployed. The proxy is auth-gated
// (any signed-in staff member can call it) and pulls the Anthropic
// key from public.church_settings server-side, so the API key never
// reaches the browser.
//
// Higher-level helpers in this file:
//   summarizeTranscript        — Claude-write a short summary
//   proposeTranscriptTrim      — propose a trimmed transcript focused
//                                on pastorally-relevant content
//   suggestCoreIssues          — propose 1-3 candidate core pastoral
//                                issues from a transcript / interaction
//                                / note, with high-precision default
//                                and a speculative toggle

import { supabase, withTimeout } from './supabase';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

/**
 * Low-level proxy call. Mirrors the bulletin/sermons callClaude.
 * @param {Object} body { messages, system?, max_tokens?, model? }
 * @param {Object} [opts]
 * @param {number} [opts.timeoutMs=60000] LLM calls can be slow.
 */
export async function callClaude(body, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 60000;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  let res;
  try {
    res = await withTimeout(
      fetch(`${supabaseUrl}/functions/v1/claude-proxy`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      }),
      timeoutMs
    );
  } catch (e) {
    if (String(e?.message || '').includes('Request timed out')) {
      throw new Error(
        `Claude took longer than ${Math.round(timeoutMs / 1000)}s to respond. ` +
          `For long transcripts try splitting into shorter sections.`
      );
    }
    throw e;
  }
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Claude proxy ${res.status}: ${errBody.slice(0, 400)}`);
  }
  return res.json();
}

// Pull the first text block out of a Claude response, trimmed.
function firstText(result) {
  return result?.content?.[0]?.text?.trim() || '';
}

// Strip code-fence wrappers ("```json ... ```") that Claude sometimes
// adds around JSON output, then JSON.parse. Throws with a readable
// message if the cleanup still doesn't yield valid JSON.
function parseClaudeJson(text) {
  if (!text) throw new Error('Claude returned no text.');
  let cleaned = text.trim();
  // Strip surrounding ```...``` if present.
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(cleaned);
  if (fence) cleaned = fence[1].trim();
  // Strip leading "Here is..." chatter before the first {  or [
  const firstBrace = cleaned.search(/[\[{]/);
  if (firstBrace > 0) cleaned = cleaned.slice(firstBrace);
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(
      'Claude returned text that did not parse as JSON: ' +
        text.slice(0, 200) +
        (text.length > 200 ? '…' : '')
    );
  }
}

// =====================================================================
// 4b — Summarize a transcript
// =====================================================================
//
// Returns a 2-4 sentence summary suitable for the transcript.summary
// field. The prompt deliberately steers Claude away from theological
// commentary or "this is sad" emotional editorializing — pastoral
// records are a working tool, not a journal.

export async function summarizeTranscript({ transcriptText, personName, title }) {
  const text = (transcriptText || '').trim();
  if (!text) throw new Error('No transcript text to summarize.');
  const ctx = [];
  if (personName) ctx.push(`Person: ${personName}`);
  if (title) ctx.push(`Conversation title: ${title}`);

  const result = await callClaude({
    system:
      'You are helping a pastor maintain quick reference notes on conversations with parishioners. ' +
      'When asked to summarize a transcript, return ONLY a 2-4 sentence factual summary of what was discussed. ' +
      'Use plain pastoral language. Do NOT add theological commentary, emotional editorializing, or pastoral advice — ' +
      'the pastor will draw their own conclusions. Do NOT include speaker labels or quotes — just summarize the content. ' +
      'Plain text only, no markdown.',
    messages: [
      {
        role: 'user',
        content:
          (ctx.length > 0 ? ctx.join('\n') + '\n\n' : '') +
          'Transcript:\n' +
          text,
      },
    ],
    max_tokens: 600,
  });
  const summary = firstText(result);
  if (!summary) throw new Error('Claude returned no summary.');
  return summary;
}

// =====================================================================
// 4c — Trim transcript to pastorally-relevant content
// =====================================================================
//
// Returns { trimmed_text, removed_summary } — the trimmed version
// (a clean, readable transcript focused on substance) plus a one-line
// note about what was cut. The pastor previews + accepts/edits before
// the trim is committed.

export async function proposeTranscriptTrim({
  transcriptText,
  personName,
  title,
}) {
  const text = (transcriptText || '').trim();
  if (!text) throw new Error('No transcript text to trim.');
  const ctx = [];
  if (personName) ctx.push(`Person: ${personName}`);
  if (title) ctx.push(`Conversation title: ${title}`);

  const result = await callClaude({
    system:
      'You are helping a pastor trim a recorded-conversation transcript down to its pastorally relevant content. ' +
      'Keep: anything about the person\'s spiritual life, family relationships, health concerns, work / financial stress, ' +
      'griefs, joys, doubts, questions about faith, requests for prayer, plans for the future, anything they shared in ' +
      'confidence that the pastor would want to remember. ' +
      'Cut: small talk, weather, tangents about TV / sports / weather, repeated stories, side conversations with third ' +
      'parties unrelated to the person, audio-recorder fumbling, and anything purely procedural ("can you hear me", "turn that off"). ' +
      'PRESERVE THE PERSON\'S OWN WORDS — do not paraphrase. Just remove the irrelevant bits and stitch the rest together ' +
      'into a clean readable flow. Use ellipses (...) where you cut chunks so the pastor knows something was removed. ' +
      'Output JSON ONLY in this exact shape, no other text:\n' +
      '{"trimmed_text": "...the trimmed transcript with ellipses where cuts were made...", ' +
      '"removed_summary": "one short sentence describing what kind of content was cut"}',
    messages: [
      {
        role: 'user',
        content:
          (ctx.length > 0 ? ctx.join('\n') + '\n\n' : '') +
          'Original transcript:\n' +
          text,
      },
    ],
    max_tokens: 8000,
  });
  const parsed = parseClaudeJson(firstText(result));
  return {
    trimmed_text: typeof parsed.trimmed_text === 'string' ? parsed.trimmed_text : '',
    removed_summary:
      typeof parsed.removed_summary === 'string' ? parsed.removed_summary : '',
  };
}

// =====================================================================
// 4d — Suggest core pastoral issues
// =====================================================================
//
// Returns an array of { title, description, rationale } suggestions.
//
// Two precision modes:
//   'precise' (default) — only surface clearly-named pastoral concerns
//                          (the person literally mentioned grief,
//                          struggle, doubt, illness, conflict, etc.)
//   'speculative'        — also surface subtle hints, things between
//                          the lines

export async function suggestCoreIssues({
  sourceText,
  sourceLabel, // 'interaction', 'transcript', 'note' — for prompt context
  personName,
  mode = 'precise',
}) {
  const text = (sourceText || '').trim();
  if (!text) throw new Error('No source text to analyze.');

  const speculativeClause =
    mode === 'speculative'
      ? 'Look BOTH at what the person explicitly named AND at subtler cues, things implied but not stated, patterns ' +
        'across the conversation that suggest something the pastor should pay attention to. Mark speculative items as ' +
        'such in the rationale field (e.g. "rationale": "Implied — they kept changing the subject when X came up.").'
      : 'ONLY surface concerns the person clearly NAMED OR DISCUSSED — illness, grief, family conflict, financial worry, ' +
        'doubt, faith struggle, big life decisions, etc. Do NOT speculate about subtext. If nothing pastorally weighty ' +
        'was discussed, return an empty list.';

  const ctxLines = [];
  if (personName) ctxLines.push(`Person: ${personName}`);
  ctxLines.push(`Source type: ${sourceLabel || 'unknown'}`);

  const result = await callClaude({
    system:
      'You help a pastor identify "core pastoral issues" — ongoing concerns worth tracking across visits and ' +
      'conversations with a parishioner. Examples: "Wife\'s recent cancer diagnosis", "Grief over father\'s death", ' +
      '"Conflict with adult son", "Doubt about prayer". ' +
      speculativeClause +
      '\n\nReturn 0-3 candidates as a JSON ARRAY (no other text), each with:\n' +
      '  - title: short noun phrase (3-8 words), the way the pastor would write it on a sticky note\n' +
      '  - description: 1-2 sentences of context the pastor will want when re-reading the issue later\n' +
      '  - rationale: one sentence on why you flagged this (cite a phrase from the source if possible)\n\n' +
      'Return [] if there\'s nothing pastorally weighty enough to track. Plain JSON, no code fences.',
    messages: [
      {
        role: 'user',
        content:
          ctxLines.join('\n') + '\n\nSource content:\n' + text,
      },
    ],
    max_tokens: 1500,
  });
  const parsed = parseClaudeJson(firstText(result));
  if (!Array.isArray(parsed)) {
    throw new Error('Claude returned non-array JSON for core-issue suggestions.');
  }
  return parsed
    .filter((s) => s && typeof s === 'object' && typeof s.title === 'string')
    .map((s) => ({
      title: s.title.trim(),
      description: typeof s.description === 'string' ? s.description.trim() : '',
      rationale: typeof s.rationale === 'string' ? s.rationale.trim() : '',
    }));
}

// =====================================================================
// Phase 7 — Summarize a document
// =====================================================================
//
// Pastor pasted a body, captured a link with metadata, or uploaded a
// file — but we only have what's typeable as text. (We don't read
// arbitrary files server-side; Phase 7 keeps it simple.) Claude
// summarizes whatever text we can give it, in pastoral terms.
//
// `sourceText` should be: the doc body (for kind='note'), the doc's
// existing pastor-typed notes (for files/links — Claude can't read
// the file), or a short description the pastor gives.

export async function summarizeDocument({ sourceText, personName, title }) {
  const text = (sourceText || '').trim();
  if (!text) throw new Error('No text to summarize.');
  const ctx = [];
  if (personName) ctx.push(`Person: ${personName}`);
  if (title) ctx.push(`Document title: ${title}`);

  const result = await callClaude({
    system:
      'You are helping a pastor maintain quick reference notes on documents and ' +
      'artifacts attached to a parishioner\'s record. When given a document\'s text, ' +
      'return ONLY a 1-3 sentence factual summary of what the document is and what ' +
      'it says — the kind of summary the pastor would want to see in a list view ' +
      'without re-reading the full document. Plain pastoral language. Do NOT add ' +
      'theological commentary or emotional editorializing. Plain text, no markdown.',
    messages: [
      {
        role: 'user',
        content:
          (ctx.length > 0 ? ctx.join('\n') + '\n\n' : '') +
          'Document text / description:\n' +
          text,
      },
    ],
    max_tokens: 400,
  });
  const summary = firstText(result);
  if (!summary) throw new Error('Claude returned no summary.');
  return summary;
}

// =====================================================================
// Phase 6 — Draft a eulogy outline from gathered pastoral data
// =====================================================================
//
// Takes a payload assembled by the EulogyDraftModal (already filtered
// to the sections the pastor wants to include) and asks Claude to
// produce a chronological outline of the person's life suitable as
// a starting point for a eulogy. Pastor edits the result before it
// lands in eulogy_notes.
//
// The data gathering happens client-side; this function just sends
// the assembled context to Claude.

export async function draftEulogyOutline({ personLabel, sectionsContext }) {
  const text = (sectionsContext || '').trim();
  if (!text) {
    throw new Error(
      'No source data selected. Pick at least one section to include.'
    );
  }
  const result = await callClaude({
    system:
      'You are helping a United Methodist pastor write a eulogy outline. ' +
      'You will receive a parishioner\'s pastoral record, organized by section. ' +
      'Produce a thoughtful, chronological outline of their life — the kind a ' +
      'pastor could turn into a 5-10 minute eulogy with a few hours of reflection. ' +
      '\n\nSTRUCTURE the outline this way (skip any section the data doesn\'t support):\n' +
      '  ## Early life and family of origin\n' +
      '  ## Faith journey\n' +
      '  ## Marriage, family, vocation\n' +
      '  ## Life in the church and community\n' +
      '  ## Final season\n' +
      '  ## Hopes for the resurrection / words for the family\n' +
      '\nUNDER each heading, use bullet points with concrete facts and notable moments. ' +
      'When the data has a date, INCLUDE it. When the pastor\'s notes describe a ' +
      'meaningful moment, summarize it in the person\'s own framing. ' +
      '\nMARK uncertainty: when a fact would normally appear (date of birth, place, ' +
      'parents\' names, etc.) but isn\'t in the record, include a placeholder like ' +
      '"[date of birth — to confirm with family]" so the pastor knows what to fill in. ' +
      '\nTONE: warm but factual. This is a draft for the pastor\'s eyes — they will ' +
      'add the theological framing, the personal stories, the pastoral voice. Don\'t ' +
      'add your own theological commentary. Don\'t include items the data marked ' +
      'rejected, private, or not for the eulogy. ' +
      '\nOutput plain markdown. No preamble, no closing remarks — just the outline.',
    messages: [
      {
        role: 'user',
        content:
          (personLabel ? `Person: ${personLabel}\n\n` : '') +
          'Pastoral record:\n\n' +
          text,
      },
    ],
    max_tokens: 4000,
    timeoutMs: 90000, // synthesis is the slowest call we make
  });
  const outline = firstText(result);
  if (!outline) throw new Error('Claude returned no outline.');
  return outline;
}
