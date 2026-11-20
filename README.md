# Doc Summarizer Browser Extension

Summarize any web page, pasted text, or YouTube transcript at three depth levels,
then ask follow-up questions grounded in the original content via hybrid
(BM25 + vector) RAG with inline citations. Multi-page sessions let the chat
reference across everything you've summarised.

> **MVP status:** a standalone Next.js web app where you paste a URL / text /
> YouTube link. A real Plasmo Chrome sidebar extension (the namesake product)
> plus Readability.js, Notion sync, and action-item extraction are documented
> stretch goals — see [Stretch goals](#stretch-goals).

---

## Features

- **Three input modes**
  - **URL** — backend `fetch(url)` + a lightweight HTML extractor that strips
    scripts, styles, navs, footers, headers, asides, forms, iframes, buttons,
    then decodes entities and collapses whitespace. Title from `<title>` (falls
    back to first `<h1>`). Main text truncated to ~20k chars.
  - **Paste text** — a textarea. Used as-is.
  - **YouTube URL** — `extractVideoId()` parses `watch?v=`, `youtu.be/`,
    `/embed/`, `/shorts/`, `/v/`, `m.youtube.com`, `youtube-nocookie`, and a
    bare 11-char ID. The transcript is fetched via the `youtube-transcript`
    package (reusing Project #13's pattern) and summarised like any other text.
- **Adjustable summary length** — a 3-position slider:
  - `Brief` — exactly 3 bullet points
  - `Medium` — 1 paragraph + 5 bullet points
  - `Detailed` — 3 paragraphs + 3 verbatim key quotes (markdown blockquotes)
- **Follow-up Q&A chat** — after a summary is shown, ask follow-up questions.
  Each question runs hybrid retrieval (BM25 + vector cosine, fused via
  Reciprocal Rank Fusion) over the chunks of every page in the session, then
  streams an LLM reply with inline `[^c1]` citation chips pointing at the
  source chunk. Replies use the `text/plain + ---CITATIONS---` streaming
  protocol (same as Project #1).
- **Highlight + save** — save any quote or note as a "highlight", optionally
  attached to a page. Persisted to SQLite via Prisma.
- **Multi-page sessions** — a session groups one or more pages. The follow-up
  chat RAGs over the **union** of all session pages, so a question can be
  answered by a chunk from page A even while you're viewing page B's summary.
- **Stats header** — live counts of sessions, pages, messages, highlights.

---

## MVP scope vs. stretch goals

| Area | MVP (this repo) | Stretch goal |
|---|---|---|
| **Distribution** | Standalone Next.js web app (paste a URL / text / YT link) | Real **Plasmo** Chrome sidebar extension that summarises the active tab with one click |
| **HTML extraction** | Regex-based extractor (strip scripts/styles/navs/footers/…) | **Readability.js** (Mozilla) for a robust main-content extraction |
| **Action items** | Summary only | Auto-extract action items / todos / decisions from the content |
| **Sync** | Local SQLite only | **Notion sync** — push highlights + summaries to a Notion database |
| **Modalities** | HTML text + YouTube transcript | **Multi-modal** — PDF text extraction + image (OCR) summarisation |
| **LLM** | z-ai-web-dev-sdk (non-streaming summary, streaming chat) | Pluggable provider interface already in place — swap for OpenAI/Anthropic |

The pure-function seams (`ChatProvider`, `EmbeddingProvider`, `extractPageContent`,
`buildSummaryPrompt`, `retrieveAcrossPages`, `formatHighlightForUi`) are designed
so each stretch goal plugs in without touching the UI or the API routes.

---

## Tech stack

- **Framework** — Next.js 16 (App Router), TypeScript 5
- **Styling** — Tailwind CSS 4 + shadcn/ui (New York), Lucide icons
- **Database** — Prisma 6 + SQLite (local-first, one file per app install)
- **LLM** — `z-ai-web-dev-sdk` (non-streaming for the summary, streaming for
  the follow-up chat)
- **Embeddings** — deterministic hashing embedder (384-dim, FNV-1a) by default;
  OpenAI-compatible provider via `EMBEDDINGS_API_KEY` / `OPENAI_API_KEY` env
  vars when set
- **Retrieval** — Okapi BM25 + vector cosine fused via Reciprocal Rank Fusion
  (RRF, k=60)
- **YouTube** — `youtube-transcript` for transcript fetch; pure `extractVideoId`
  regex parser (unit-tested)
- **Tests** — `bun test` (Bun-native test runner, no Jest)

---

## Architecture

```
┌──────────────────────────── browser (1 user-visible route: /) ───────────────────────────┐
│  Header: app name · session picker (Select) · stats badges                              │
│  ┌──────────────────────── left column ──────────────┐  ┌──────── right column ────────┐  │
│  │ Input card                                        │  │ Follow-up Q&A card          │  │
│  │  Radio: URL | Text | YouTube                      │  │  (streaming + citations)    │  │
│  │  Input / Textarea                                 │  │  chat input + send          │  │
│  │  Slider: Brief / Medium / Detailed                │  └─────────────────────────────┘  │
│  │  [Summarize] button                               │  ┌─────────────────────────────┐  │
│  │ Pages list (ScrollArea):                          │  │ Highlights panel            │  │
│  │  per page: title, source badge, summary,          │  │  add form + list            │  │
│  │  Show original (Tabs), delete                     │  └─────────────────────────────┘  │
│  └───────────────────────────────────────────────────┘                                   │
└──────────────────────────────────────────────────────────────────────────────────────────┘
        │ fetch                                  │ fetch (stream)         │ fetch
        ▼                                        ▼                        ▼
┌─────────────────────────────────────── API routes (src/app/api/*) ──────────────────────┐
│  POST /api/sessions                  GET /api/stats                                       │
│  GET  /api/sessions                  POST   /api/sessions/[id]/pages   (extract+chunk+    │
│  GET  /api/sessions/[id]                    embed+summarise, persist Page, add to corpus) │
│  DEL  /api/sessions/[id]              GET    /api/sessions/[id]/pages                       │
│                                       DEL    /api/pages/[id]   (drop from corpus cache)    │
│                                       POST   /api/sessions/[id]/chat  (stream + citations) │
│                                       POST/GET /api/sessions/[id]/highlights                │
│                                       DEL    /api/highlights/[id]                          │
└──────────────────────────────────────────────────────────────────────────────────────────┘
        │                                         │                       │
        ▼                                         ▼                       ▼
┌──────────────────────── lib/ (pure + pluggable) ─────────────────────────────────────────┐
│  page-extractor  youtube-extractor  summary-builder  highlight-formatter   (pure)         │
│  chunker  tokenizer  embeddings  bm25  hybrid-search   (copied from Project #1)           │
│  retrieval.ts — chunkPlainText / embedStoredChunks / buildPageChunks /                     │
│                 retrieveAcrossPages (BM25 + vector + RRF over the union of session pages)  │
│                 + in-memory session corpus cache (addPageToCorpus / removePageFromCorpus)  │
│  ai.ts — ChatProvider (complete + stream), ZaiProvider, MockProvider,                    │
│          buildRagSystemPrompt, extractCitations, generateSummary                           │
└───────────────────────────────────────────────────────────────────────────────────────────┘
        │                                         │
        ▼                                         ▼
┌────────── Prisma + SQLite (db/custom.db) ──────────┐    ┌── z-ai-web-dev-sdk ──┐
│  Session 1—N Page                                   │    │  chat.completions   │
│  Session 1—N ChatMessage                            │    │  .create({stream})  │
│  Session 1—N Highlight  N—1 Page (SetNull on delete)│    └─────────────────────┘
└─────────────────────────────────────────────────────┘
```

### Data flow — "Summarize a URL"

```
URL ──fetch──▶ HTML ──extractPageContent──▶ { title, mainText }
                                                │
                                                ▼
                            chunkPlainText(title, mainText)  ──▶ StoredChunk[]
                                                │                      │
                                                ▼                      ▼
                                  embedStoredChunks(chunks) ──▶ Float32Array[]
                                                │
                                                ▼
                            generateSummary(mainText, length)  ──▶ summary (LLM, non-streaming)
                                                │
                                                ▼
                     db.page.create({ tokens: JSON(chunks), embedding: JSON(vectors), summary })
                                                │
                                                ▼
                     addPageToCorpus(sessionId, buildPageChunks(...))   (in-memory cache)
```

### Data flow — "Follow-up Q&A"

```
question ──▶ retrieveAcrossPages(question, sessionCorpus) ──▶ RetrievedChunk[] (top-8)
                                                                │
                                                                ▼
                              buildRagSystemPrompt(retrieved) ──▶ { systemPrompt, citationMap }
                                                                │
                                                                ▼
   ChatProvider.stream({ systemPrompt, messages: prior + question })
                                                                │  (token deltas)
                                                                ▼
                                              ReadableStream ──▶ HTTP text/plain
                                                                │
                                  after stream ends: persist assistant ChatMessage,
                                  build citation footer (n, chunkId, pageTitle, ordinal, …),
                                  append "\n---CITATIONS---\n{json}"
                                                                │
                                                                ▼
                                          client splits on separator, renders [^c1] chips
```

---

## Setup

```bash
# 1. Install deps
bun install

# 2. Create the SQLite database + generate the Prisma client
bun run db:push      # uses inline DATABASE_URL="$(pwd)/db/custom.db"
bun run db:generate

# 3. (optional) configure LLM / embeddings — see .env.example
cp .env.example .env  # then edit

# 4. Run the dev server
bun run dev          # http://localhost:3000

# 5. Run the test suite
bun test
```

The dev server is already running automatically in this sandbox; open the
**Preview Panel** on the right to view the app, or click **Open in New Tab** for
a full-browser view. (Do not navigate to `http://localhost:3000` directly —
that address is internal to the sandbox.)

---

## Tests

```
bun test
```

114 tests across 11 files, all pure (no DB, no network, no LLM). The suite
exercises every pure-function seam and a deterministic `MockChatProvider` for
the AI layer:

| File | Covers |
|---|---|
| `page-extractor.test.ts` | title from `<title>` / `<h1>` fallback, strips scripts/styles/navs/footers, decodes entities, truncates, empty/edge inputs |
| `youtube-extractor.test.ts` | `watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`, `/v/`, `m.youtube.com`, `youtube-nocookie`, bare ID, invalid inputs |
| `summary-builder.test.ts` | brief = 3 bullets, medium = 1 paragraph + 5 bullets, detailed = 3 paragraphs + key quotes; `LENGTH_SPECS` + level lookups |
| `chunker.test.ts` | `estimateTokens`, `splitByHeading`, `splitBodyByTokens` (overlap), `chunkMarkdown` |
| `tokenizer.test.ts` | lowercase, markdown stripping, stop-words, CJK single-char, URL stripping |
| `embeddings.test.ts` | fixed-length Float32Array, determinism, cosine behaviour, L2 norm, round-trip serialize/deserialize |
| `bm25.test.ts` | ranking, no-match, topK, empty corpus, IDF weighting |
| `hybrid-search.test.ts` | RRF fusion, single-retriever hits, topK, `k` param, `fuseHits` raw scores |
| `retrieval.test.ts` | `retrieveAcrossPages` top-K, "A ranks first when query matches A not B", cooking vs React ranking, empty cases, chunkId shape; `chunkPlainText` |
| `ai.test.ts` | `buildRagSystemPrompt`, `extractCitations`, `MockChatProvider.complete` (summary) + `.stream` (follow-up), `generateSummary` per-length prompt contents, provider injection |
| `highlight-formatter.test.ts` | page relation → `pageUrl`/`pageTitle`; null page → nulls; Date → ISO string; string passthrough; exact key shape |

---

## Environment variables

| Var | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | `file:…/db/custom.db` (`.env`) | Prisma SQLite path. The `db:*` npm scripts inline `DATABASE_URL="$(pwd)/db/custom.db"` so the CLI works without `.env` loaded. |
| `PKC_DISABLE_LLM` | no | unset | `=1` forces the deterministic `MockProvider` (offline demo / tests). |
| `EMBEDDINGS_API_KEY` / `OPENAI_API_KEY` | no | unset | When set, switches embeddings to the OpenAI-compatible provider. |
| `EMBEDDINGS_BASE_URL` | no | `https://api.openai.com/v1` | OpenAI-compatible embeddings endpoint. |
| `EMBEDDINGS_MODEL` | no | `text-embedding-3-small` | Embedding model name. |

The z-ai-web-dev-sdk reads its own config from the environment (see the SDK
docs). When unconfigured, the app still runs end-to-end: the hashing embedder
gives real (deterministic) vector similarity and `MockProvider` gives a
deterministic summary + streamed reply.

---

## Project structure

```
40-doc-summarizer/
├── prisma/schema.prisma            # Session / Page / ChatMessage / Highlight
├── db/custom.db                    # SQLite (created by db:push, gitignored)
├── src/
│   ├── app/
│   │   ├── layout.tsx              # root layout + Toaster
│   │   ├── page.tsx                # the only user-visible route (2-column)
│   │   ├── globals.css             # Tailwind 4 + shadcn tokens + scrollbar
│   │   └── api/
│   │       ├── sessions/route.ts                       # POST + GET (list)
│   │       ├── sessions/[id]/route.ts                 # GET (detail) + DELETE
│   │       ├── sessions/[id]/pages/route.ts           # POST (summarise) + GET
│   │       ├── sessions/[id]/chat/route.ts            # POST (stream + citations)
│   │       ├── sessions/[id]/highlights/route.ts      # POST + GET
│   │       ├── pages/[id]/route.ts                    # DELETE
│   │       ├── highlights/[id]/route.ts              # DELETE
│   │       └── stats/route.ts                        # GET
│   ├── components/ui/              # shadcn/ui (button, card, slider, radio-group, …)
│   ├── hooks/use-toast.ts
│   └── lib/
│       ├── page-extractor.ts       # extractPageContent(html) → { title, mainText }
│       ├── youtube-extractor.ts    # extractVideoId(url) → string | null
│       ├── summary-builder.ts      # buildSummaryPrompt(content, length) + LENGTH_SPECS
│       ├── highlight-formatter.ts  # formatHighlightForUi(highlight) → UI shape
│       ├── retrieval.ts            # chunkPlainText / retrieveAcrossPages + corpus cache
│       ├── ai.ts                   # ChatProvider (complete + stream) + RAG prompt + citations
│       ├── chunker.ts              # (copied from Project #1)
│       ├── tokenizer.ts           # (copied)
│       ├── embeddings.ts         # (copied)
│       ├── bm25.ts               # (copied)
│       ├── hybrid-search.ts     # (copied)
│       ├── db.ts               # Prisma client singleton
│       ├── utils.ts            # cn() tailwind helper
│       └── __tests__/*.test.ts  # 11 files, 114 tests
├── package.json                    # bun test, db:* with inline DATABASE_URL, youtube-transcript
├── tsconfig.json, next.config.ts, postcss.config.mjs, tailwind.config.ts, components.json
├── eslint.config.mjs               # flat config, next core-web-vitals + typescript
├── .env.example, .gitignore, LICENSE (MIT)
└── README.md
```

---

## Case study

### Multi-input (URL / text / YouTube) + adjustable summary length + follow-up chat RAG + multi-page session

The product question was: *how do you build a summariser whose follow-up chat
can still answer "what did that other article say about X?" after the user has
moved on to a second page?* The answer is to make **the session — not the
page — the unit of retrieval**.

**Three input modes, one ingestion pipeline.** Each input mode produces the
same `{ title, mainText }` pair, then the same `chunkPlainText →
embedStoredChunks → generateSummary` pipeline runs. URL mode adds an HTML
extraction step (regex-based for MVP, Readability.js for the stretch goal);
YouTube mode adds an `extractVideoId` + `youtube-transcript` fetch step. The
downstream chunker / embedder / summariser / retriever never know which input
mode produced the text — that's the seam that lets a Plasmo extension later
reuse the whole pipeline for the active tab.

**Adjustable length is a prompt-builder concern, not a model concern.** The
slider position maps to a `SummaryLength` (`brief` / `medium` / `detailed`),
which `buildSummaryPrompt` turns into a concrete formatting directive ("3
bullet points", "1 paragraph + 5 bullets", "3 paragraphs + 3 verbatim key
quotes"). The LLM gets the same system prompt regardless of length; only the
user message changes. This keeps the summariser's persona consistent and makes
the three lengths trivially unit-testable (the `ai.test.ts` suite asserts that
the mocked summary echoes the right length instruction).

**Follow-up chat is RAG over the union of session pages.** `retrieveAcrossPages`
takes a flat `PageChunk[]` (every chunk of every page in the session) and runs
BM25 + vector cosine fused via RRF. The in-memory `sessionCorpusCache` keeps
the chunks hot so the chat route doesn't re-deserialise the DB on every turn.
A citation footer (`\n---CITATIONS---\n{json}`) is appended after the streamed
tokens so the client can render `[^c1]` chips; each citation carries the
marker number `n`, the chunkId, the pageTitle, the ordinal, and a 140-char
preview for a hover tooltip.

**Multi-page sessions fall out for free.** Because retrieval operates on the
flat union, adding a second page just appends its chunks to the cache. A
question about page A can be answered with a chunk from page B, and the
citation chip names the right page. The `retrieval.test.ts` suite locks this
in: a React-hooks query against a corpus containing a React-hooks page and a
cooking page ranks the React page first, and vice versa.

### What I'd do differently

- **Ship the real Plasmo sidebar extension.** The web app is the right MVP to
  prove the pipeline, but the product is a one-click "summarize this tab"
  sidebar. Plasmo + a content script that grabs `document.documentElement.outerHTML`
  and pipes it to the same `extractPageContent` is a few hundred lines on top
  of what's here — the lib layer is already input-agnostic.
- **Use Readability.js (Mozilla) for HTML extraction.** The regex extractor is
  fine for clean articles and bullet-proofs scripts/styles/navs, but it
  struggles with SPAs, paywalls, and sites that put the article in a nested
  `<div>` with no `<article>` tag. Readability.js is a ~50KB drop-in that
  handles all of that.
- **Real Notion sync for highlights.** Highlights are already a first-class
  persisted entity with an optional page link — wiring a "send to Notion"
  button that POSTs each highlight as a row in a Notion database (with the
  source URL, the page title, and the note) is a small API route on top of the
  existing `/api/sessions/[id]/highlights` shape.
- **Real action-item extraction.** The `detailed` length already asks for key
  quotes; a fourth pass that asks the model to extract action items ("who
  does what by when") as a structured JSON list would make the summariser
  directly actionable for meeting notes and project docs.
- **Multi-modal input (PDF + images).** The ingestion pipeline's
  `mainText → chunk → embed` shape is text-only. Adding a PDF text-extraction
  step (pdf-parse) and an OCR step (Tesseract / a vision model) for images
  would let the summariser handle scanned docs and slide decks — the chunker
  and retriever wouldn't change at all.
- **Stream the summary too.** The summary is a non-streaming call so it can
  be persisted atomically against the Page row, but a streaming summary with
  a "save" affordance would feel snappier for long pages.

### Resume bullet

> Built a multi-input document summariser (URL / pasted text / YouTube
> transcript) with adjustable summary depth (3 bullets → 3 paragraphs + key
> quotes) and a streaming follow-up Q&A chat grounded by hybrid BM25 + vector
> RAG (Reciprocal Rank Fusion) over the union of all pages in a session, with
> inline `[^c1]` citation chips; 114 pure-function tests, pluggable
> ChatProvider / EmbeddingProvider seams so a Plasmo sidebar + Readability.js
> + Notion sync can drop in without touching the UI.

---

## License

MIT — see [LICENSE](./LICENSE).

---

## Push to GitHub

```bash
gh repo create doc-summarizer --public --source=. --remote=origin --push
```
