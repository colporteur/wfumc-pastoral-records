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

// =====================================================================
// Clergy Record / Obituary importer — Phase A
// =====================================================================
//
// Three helpers powering the per-person "Import Clergy Record" /
// "Import Obituary" buttons on PersonDetail:
//
//   extractClergyRecord({ imageBase64, mimeType })
//     Vision call. Clergy records vary between funeral homes; the
//     prompt describes the KIND of information to extract rather than
//     a specific form layout. The same JSON schema as extractObituary
//     so the review UI is one piece of code.
//
//   extractObituary({ url?, pastedText?, imageBase64?, mimeType? })
//     Same schema, different prompt. URLs are pre-fetched to plain
//     text by lib/recordImports.js via the url-fetch Edge Function;
//     pasted text and photos are passed straight through.
//
//   inferRelativeToRelative({ subjectName, relativeA, relativeB })
//     Tiny prompt: given subject, relativeA's role to subject, and
//     relativeB's role to subject, returns relativeA's role to
//     relativeB. Powers auto-propagation of family_links to the
//     subject's existing directory family (Sidney's brother becomes
//     Sidney's daughter's uncle).
//
// All three return JSON. Errors bubble up with readable messages.

// Canonical JSON shape both extractors target. Kept here as a comment
// so future tweaks to the prompts can reference one source of truth.
//
// {
//   "subject": {
//     "name": "Sidney Leo Lanier, Jr.",
//     "birth_date": "1938-03-10",  // ISO if confident; null if absent
//     "death_date": "2026-05-14",
//     "place_of_birth": "Waycross, Georgia",
//     "place_of_death": "Tanner-East Alabama",
//     "marital_status": "Widowed",
//     "church_affiliation": "First United Methodist Church",
//     "religion": null,
//     "address": "755 N Main Street, Wedowee, AL"
//   },
//   "family": [
//     {
//       "name": "Mary Ann Lanier",
//       "relationship_to_subject": "daughter",
//       "status": "living",            // "living" | "deceased"
//       "birth_date": null,
//       "death_date": null,
//       "spouse_of": null,             // name of the family member this
//                                      // person is married to (so a
//                                      // son-in-law can be paired with
//                                      // the daughter), if known
//       "notes": ""
//     },
//     ...
//   ],
//   "service": {                       // funeral / interment, if present
//     "date": "2026-05-21",
//     "time": "11:00 AM",
//     "location": "First United Methodist Church",
//     "interment": "Wedowee City Cemetery",
//     "clergy": "Rev. Todd Noren-Hentz"
//   },
//   "confidence_notes": "..."          // optional: anything the model is
//                                      // uncertain about
// }

const EXTRACTION_SCHEMA_DESCRIPTION =
  'Return JSON with this shape (omit any field you cannot determine — use null, ' +
  'never invent data):\n' +
  '{\n' +
  '  "subject": {\n' +
  '    "name": string,\n' +
  '    "birth_date": ISO date string or null (e.g. "1938-03-10"),\n' +
  '    "death_date": ISO date string or null,\n' +
  '    "place_of_birth": string or null,\n' +
  '    "place_of_death": string or null,\n' +
  '    "marital_status": string or null (e.g. "Widowed", "Married"),\n' +
  '    "church_affiliation": string or null,\n' +
  '    "religion": string or null,\n' +
  '    "address": string or null\n' +
  '  },\n' +
  '  "family": [\n' +
  '    {\n' +
  '      "name": string,\n' +
  '      "relationship_to_subject": string (e.g. "daughter", "son", "brother",\n' +
  '          "sister", "wife", "husband", "father", "mother", "grandchild",\n' +
  '          "son-in-law", "daughter-in-law", "stepson", "stepdaughter"),\n' +
  '      "status": "living" or "deceased",\n' +
  '      "birth_date": ISO date string or null,\n' +
  '      "death_date": ISO date string or null,\n' +
  '      "spouse_of": string or null (the name of another family member\n' +
  '          this person is married to, if a couple is mentioned together;\n' +
  '          e.g. for "Lorenzo and Laura Alonso" listed as grandchildren,\n' +
  '          one row could have spouse_of: "Laura Alonso"),\n' +
  '      "notes": string or empty string\n' +
  '    }\n' +
  '  ],\n' +
  '  "service": {\n' +
  '    "date": ISO date or null,\n' +
  '    "time": string or null,\n' +
  '    "location": string or null,\n' +
  '    "interment": string or null,\n' +
  '    "clergy": string or null\n' +
  '  },\n' +
  '  "confidence_notes": string or empty string (anything you are uncertain\n' +
  '      about — illegible names, ambiguous relationships, dates you guessed)\n' +
  '}\n';

const FAMILY_EXTRACTION_GUIDANCE =
  'For each family member mentioned:\n' +
  '- Use the relationship as stated relative to the subject (the deceased / ' +
  'person the record is about), not relative to other family members.\n' +
  '- If a couple is listed together (e.g. "Mary and John Smith, daughter and ' +
  'son-in-law"), produce TWO rows — one per person — and use the spouse_of ' +
  'field to link them.\n' +
  '- For nicknames in parentheses (e.g. "Louisa Alonso (Ginger)"), use the ' +
  'formal name in the "name" field and put the nickname in "notes".\n' +
  '- Treat sections labelled "Preceded in Death By", "Predeceased By", or ' +
  'similar as deceased family members.\n' +
  '- Treat sections labelled "Survivors", "Survived By", "Survivors List", ' +
  'or similar as living family members.\n' +
  '- DO NOT include the subject themselves in the family list.\n' +
  '- DO NOT invent family members. If a section is blank or partially ' +
  'filled, only return the people whose names you can clearly read.\n';

// ---------------------------------------------------------------------
// extractClergyRecord
// ---------------------------------------------------------------------
//
// `imageBase64` is the raw base-64-encoded image bytes (no data URL
// prefix). `mimeType` should be one of image/jpeg, image/png, image/gif,
// image/webp — whatever the photo upload helper produces.
//
// The prompt is deliberately format-agnostic. Funeral-home clergy
// records vary; some are typed forms, some handwritten, some scanned,
// some emailed as plain photos of a printed page. Claude is told what
// kinds of fields tend to appear and is expected to map whatever it
// sees to the canonical schema above.

export async function extractClergyRecord({ imageBase64, mimeType }) {
  if (!imageBase64) {
    throw new Error('No image provided for clergy-record extraction.');
  }
  if (!mimeType) {
    throw new Error('No mimeType provided for clergy-record extraction.');
  }

  const system =
    'You are helping a pastor extract structured information from a ' +
    'funeral-home Clergy Record form. These forms vary between funeral ' +
    'homes but generally contain the deceased\'s biographical information ' +
    '(name, dates, place of birth, place of death, address, church ' +
    'affiliation, marital status), the funeral service details (date, ' +
    'time, location, interment, clergy), and lists of family members — ' +
    'usually a "Survivors" section (still living) and a "Preceded in ' +
    'Death By" section (deceased relatives). The form may be typed, ' +
    'printed, handwritten, or a mix. Some fields may be blank.\n\n' +
    'Your job is to faithfully transcribe what you see into a JSON ' +
    'object. Do not infer or invent — if a field is blank or illegible, ' +
    'use null and note the uncertainty in confidence_notes. Output JSON ' +
    'ONLY, no preamble, no code fences.\n\n' +
    EXTRACTION_SCHEMA_DESCRIPTION +
    '\n' +
    FAMILY_EXTRACTION_GUIDANCE;

  const contentBlocks = [
    {
      type: 'text',
      text:
        'Here is a photo of a Clergy Record from a funeral home. Extract ' +
        'the structured information as described and return JSON only.',
    },
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mimeType,
        data: imageBase64,
      },
    },
  ];

  const result = await callClaude(
    {
      system,
      messages: [{ role: 'user', content: contentBlocks }],
      max_tokens: 4000,
    },
    { timeoutMs: 120000 }
  );
  return parseClaudeJson(firstText(result));
}

// ---------------------------------------------------------------------
// extractObituary
// ---------------------------------------------------------------------
//
// Three input modes (pass exactly one; the others may be omitted):
//   - url + pastedText: pre-fetched HTML body text (caller handles
//     url-fetch Edge Function call and passes the resulting `text`)
//   - pastedText alone: plain-text obit the pastor copy/pasted
//   - imageBase64 + mimeType: photo of a printed obit
//
// If `url` is provided alongside pastedText, it's just stamped into the
// prompt as context ("this came from {url}") — fetching is the caller's
// responsibility.

export async function extractObituary({
  url,
  pastedText,
  imageBase64,
  mimeType,
}) {
  const hasText = typeof pastedText === 'string' && pastedText.trim().length > 0;
  const hasImage = Boolean(imageBase64 && mimeType);
  if (!hasText && !hasImage) {
    throw new Error(
      'Provide either pastedText (with or without a source URL) or an image.'
    );
  }

  const system =
    'You are helping a pastor extract structured information from an ' +
    'obituary. Obituaries vary in style — funeral-home tribute pages, ' +
    'newspaper notices, family-written remembrances — but they generally ' +
    'contain the deceased\'s biographical details, a narrative of their ' +
    'life, family relationships (parents, spouse, children, ' +
    'grandchildren, siblings, sometimes great-grandchildren), and the ' +
    'service / interment information.\n\n' +
    'Your job is to faithfully extract what is stated, into a JSON object. ' +
    'Do not infer or invent. If the obituary mentions someone\'s death ' +
    'within the narrative ("preceded in death by his wife Willie in ' +
    '2008"), include that person as a deceased family member with a ' +
    'death date if given. Output JSON ONLY, no preamble, no code fences.\n\n' +
    EXTRACTION_SCHEMA_DESCRIPTION +
    '\n' +
    FAMILY_EXTRACTION_GUIDANCE;

  let contentBlocks;
  if (hasImage) {
    contentBlocks = [
      {
        type: 'text',
        text:
          'Here is a photo of an obituary. Extract the structured ' +
          'information as described and return JSON only.',
      },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mimeType,
          data: imageBase64,
        },
      },
    ];
    // If the photo came with a known URL, mention it as context.
    if (url) {
      contentBlocks.push({
        type: 'text',
        text: `Source URL (for context only): ${url}`,
      });
    }
  } else {
    // Text-only path. URL is helpful context for Claude (sometimes the
    // funeral-home page has the deceased's name in the URL slug).
    const head = url ? `Source URL: ${url}\n\n` : '';
    contentBlocks = [
      {
        type: 'text',
        text:
          head +
          'Obituary text:\n\n' +
          pastedText.trim() +
          '\n\nExtract the structured information as described and ' +
          'return JSON only.',
      },
    ];
  }

  const result = await callClaude(
    {
      system,
      messages: [{ role: 'user', content: contentBlocks }],
      max_tokens: 4000,
    },
    { timeoutMs: 120000 }
  );
  return parseClaudeJson(firstText(result));
}

// ---------------------------------------------------------------------
// inferRelativeToRelative
// ---------------------------------------------------------------------
//
// Given the subject and two relatives' relationships TO the subject,
// returns the implied relationship between the two relatives, as one
// of the strings the pastoral_family_links.relationship_a_to_b enum
// accepts. Example: subject's brother (relativeA) and subject's
// daughter (relativeB) → relativeA is relativeB's "aunt_uncle".
//
// We give Claude the enum + symmetry notes so it never invents a new
// label. If Claude returns something off-enum or genuinely can't
// determine the relationship, we return null and the caller leaves the
// link unproposed (pastor can add it manually).
//
// Cheap call — single short prompt, low max_tokens. Caller batches
// these as part of the commit step.

const FAMILY_LINK_ENUM = [
  'spouse',
  'sibling',
  'parent',
  'child',
  'grandparent',
  'grandchild',
  'aunt_uncle',
  'niece_nephew',
  'cousin',
  'in_law',
  'other',
];

export async function inferRelativeToRelative({
  subjectName,
  relativeAName,
  relativeARelToSubject,
  relativeBName,
  relativeBRelToSubject,
}) {
  if (!subjectName || !relativeAName || !relativeBName) {
    throw new Error(
      'inferRelativeToRelative requires subjectName, relativeAName, relativeBName.'
    );
  }
  if (!relativeARelToSubject || !relativeBRelToSubject) {
    throw new Error(
      'inferRelativeToRelative requires both relatives\' relationship to the subject.'
    );
  }

  const system =
    'You are helping a pastor determine the implied family relationship ' +
    'between two people, given how each relates to a common third person ' +
    '(the "subject"). Return JSON in this exact shape:\n' +
    '  { "relationship_a_to_b": <one of the allowed values>, "confidence": "high" | "medium" | "low", "rationale": "one short sentence" }\n\n' +
    'Allowed values for relationship_a_to_b (Person A\'s relationship TO Person B):\n' +
    '  - spouse       — A is B\'s spouse (symmetric)\n' +
    '  - sibling      — A is B\'s sibling (symmetric)\n' +
    '  - parent       — A is B\'s parent\n' +
    '  - child        — A is B\'s child\n' +
    '  - grandparent  — A is B\'s grandparent\n' +
    '  - grandchild   — A is B\'s grandchild\n' +
    '  - aunt_uncle   — A is B\'s aunt or uncle\n' +
    '  - niece_nephew — A is B\'s niece or nephew\n' +
    '  - cousin       — A is B\'s cousin (symmetric)\n' +
    '  - in_law       — A is B\'s in-law (use when no closer-blood label fits)\n' +
    '  - other        — none of the above\n\n' +
    'If the relationship is unclear, ambiguous, or weakly inferred (e.g. ' +
    'two grandchildren of the subject might be siblings OR cousins ' +
    'depending on which child of the subject is their parent), return ' +
    'confidence: "low" and choose the safest label, or use "other" with ' +
    'a rationale. Output JSON only — no preamble, no code fences.';

  const userMsg =
    `Subject (common third person): ${subjectName}\n` +
    `Person A: ${relativeAName} — is the subject's ${relativeARelToSubject}\n` +
    `Person B: ${relativeBName} — is the subject's ${relativeBRelToSubject}\n\n` +
    'What is Person A\'s relationship TO Person B?';

  const result = await callClaude(
    {
      system,
      messages: [{ role: 'user', content: userMsg }],
      max_tokens: 300,
    },
    { timeoutMs: 30000 }
  );
  const parsed = parseClaudeJson(firstText(result));
  const rel = typeof parsed?.relationship_a_to_b === 'string'
    ? parsed.relationship_a_to_b.trim().toLowerCase()
    : '';
  if (!FAMILY_LINK_ENUM.includes(rel)) {
    return {
      relationship_a_to_b: null,
      confidence: 'low',
      rationale:
        'Claude returned a relationship value not in the allowed enum (' +
        (rel || '(empty)') +
        ').',
    };
  }
  return {
    relationship_a_to_b: rel,
    confidence:
      ['high', 'medium', 'low'].includes(String(parsed.confidence).toLowerCase())
        ? String(parsed.confidence).toLowerCase()
        : 'medium',
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '',
  };
}

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
