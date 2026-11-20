/**
 * Highlight serializer for the UI.
 *
 * A Highlight row in the DB optionally points to a Page (via pageId). The UI
 * needs the page's url + title so it can render a "saved from <page>" affordance
 * next to the highlighted text — but the Prisma `Highlight` row itself only
 * stores the foreign key, not the page's denormalised title/url.
 *
 * `formatHighlightForUi` takes a Highlight (with its eagerly-loaded `page`
 * relation) and flattens it into the shape the React component wants: a single
 * plain object with `pageUrl` / `pageTitle` already resolved (or null).
 *
 * Pure: no IO, no globals.
 */

export interface HighlightInput {
  id: string
  text: string
  note: string | null
  pageId: string | null
  page?: { id: string; title: string; url: string | null } | null
  createdAt: Date | string
}

export interface FormattedHighlight {
  id: string
  text: string
  note: string | null
  pageId: string | null
  pageUrl: string | null
  pageTitle: string | null
  createdAt: string
}

export function formatHighlightForUi(h: HighlightInput): FormattedHighlight {
  return {
    id: h.id,
    text: h.text,
    note: h.note,
    pageId: h.pageId,
    pageUrl: h.page?.url ?? null,
    pageTitle: h.page?.title ?? null,
    createdAt: h.createdAt instanceof Date ? h.createdAt.toISOString() : h.createdAt,
  }
}
