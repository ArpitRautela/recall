# Frontend Design Decisions

This document records every architectural and implementation decision made while building RECALL's frontend, in the order the system was actually built, with the reasoning behind each one. It reflects what was actually built — including a few places where the code is genuinely inconsistent with itself as a result of how the project grew — not the original aspirational structure in `ARCHITECTURE.md` (see "Deviations from the original architecture plan" at the end) and not an idealized version of events.

It's organized into the phases the frontend was actually built in: foundational tooling, the initial mock-data UI build against Stitch designs, auth pages, wiring real document upload, wiring chat, wiring the remaining pages, and the final feature-completion pass.

---

## Phase 0 — Foundational tooling choices

### 0.1 Framework: Next.js App Router, client components throughout

**Decision:** Next.js 16 (Turbopack) with the App Router, React 19. Every page under `app/(app)/` and `app/(auth)/` is a `"use client"` component; there are no server components doing data fetching.

**Why:** The app is fully behind auth and every page's data is user-specific and fetched via an authenticated axios client that reads a token out of client-side state (Zustand, Phase 2.3). Server components would need a different auth story (reading the token server-side) for no real benefit here, since none of these pages are public or need to be SEO-indexed. Keeping everything client-side keeps one consistent data-fetching pattern across the whole app.

### 0.2 This Next.js variant uses `proxy.ts`, not `middleware.ts`

**Decision:** Route protection at the edge is implemented in `src/proxy.ts`, exporting a `proxy()` function (not `middleware()`), matched via the same `config.matcher` convention as standard middleware.

**Why this matters:** `frontend/AGENTS.md` explicitly warns that this project's Next.js build has breaking changes from the conventional API — this is the concrete instance of that. A developer coming in with standard Next.js knowledge would reasonably look for `middleware.ts` and not find it. `proxy.ts` redirects unauthenticated requests to protected paths to `/login`, and redirects already-authenticated requests away from `/login`/`/register` to `/dashboard`, based on a `recall_session` cookie (see 2.3 for why that cookie exists).

### 0.3 Scaffolding accepted, not all of it adopted

**Decision:** The project was initialized with `create-next-app` + `shadcn init`, which pulled in Tailwind v4, a full OKLCH light/dark CSS variable theme (`globals.css`), a set of `components/ui/*` primitives (button, card, dialog, dropdown-menu, input, scroll-area, separator, sheet, skeleton, textarea), and a starter dependency list including `react-hook-form`, `zod`, `lucide-react`, `class-variance-authority`, `radix-ui`, `framer-motion`. This scaffolding was kept in the repo rather than stripped out, even though most of it ended up unused (see Phase 1 and the "What ended up unused" section at the end).

**Why keep unused scaffolding rather than delete it:** none of it was actively harmful (dead code in a frontend bundle that's never imported doesn't ship), and deleting it would have meant re-adding it later if a design decision changed. This is a case where "leave it, don't clean it up preemptively" was the pragmatic call — though it does mean the dependency list overstates what the app actually uses, which this document exists partly to correct.

---

## Phase 1 — Building the 7 screens against Stitch mockups, with mock data

**This was the actual first phase of frontend work**, done entirely before the backend had a single real endpoint to call: all 7 screens (Dashboard, Vault, Chat, Conversations, Memories, AI Search, Settings) were built as complete, pixel-matched UIs against a set of Stitch-generated design PNGs, using hardcoded local arrays for every piece of data (`const MEMORY_CARDS = [...]`, `const QUICK_ACTIONS = [...]`, etc.) instead of any API call.

### 1.1 UI-first, backend-second build order

**Decision:** Build and visually verify every screen against its design mockup first, with fabricated data standing in for real API responses, before writing a single backend endpoint.

**Why:** The design mockups were the concrete spec — building the UI first meant every layout, spacing, and interaction decision could be checked against a visual reference immediately, without also debugging a backend contract at the same time. It also meant that by the time real endpoints existed (Phases 3–4), the *shape* of the data each page needed was already known from the mock arrays, which is what the `services/*.ts` interfaces (Phase 3.1) were then written to match.

### 1.2 Design system: hand-built dark UI matching Stitch mockups exactly, not the scaffolded shadcn theme

**Decision:** Despite the fully scaffolded shadcn theme existing (0.3), every actual page hand-rolls its layout with Tailwind utility classes and inline `style={}` objects using RECALL's specific fixed dark palette: `#131313` page background, `#201f1f` card background, `#e5e2e1` primary text, `#c4c7c8` secondary text, `#8e9192` muted text, `#c0c1ff` accent/lavender, `#f87171`/`#4ade80`/`#facc15` for error/success/warning.

**Why:** The Stitch mockups specified exact hex values and spacing per screen, not an abstract design-token system — matching them precisely was more direct with inline styles than first mapping every mockup value onto a generic shadcn OKLCH token and hoping the mapping stayed pixel-accurate. The tradeoff accepted: no light-mode support (the product is dark-mode-only by design) and no automatic reuse of shadcn's accessible primitives (dialogs, dropdowns) — every interactive element is either hand-built or replaced with a native browser primitive instead (see 3.4).

### 1.3 Icons: Material Symbols Outlined (font), not the scaffolded SVG icon library

**Decision:** Icons are rendered as `<span className="material-symbols-outlined">icon_name</span>` against the Material Symbols variable font (loaded globally, configured in `globals.css`), rather than `lucide-react`/`react-icons` component imports — even though `lucide-react` is in `package.json` from initial scaffolding.

**Why:** The Stitch mockups were built against Google's Material Symbols set, so using the same icon font kept every icon pixel-identical to the design rather than finding the closest equivalent in a different icon set.

### 1.4 A design-correction pass followed the first build

**Decision:** After the initial 7 screens were built against the mockups, a follow-up pass specifically compared the running mock UI side-by-side with the Stitch PNGs and corrected mismatches — logo treatment and specific palette values that had drifted from the reference during the first build.

**Why a separate pass instead of getting it exactly right the first time:** translating a static design file into working Tailwind/inline-style code the first time reliably introduces small drift (a slightly-off shade, an icon fill weight, spacing that's close but not exact) — a dedicated comparison pass, done once the whole screen was already structurally complete, was a more effective way to catch those than trying to eyeball pixel-perfection while also building the layout.

### 1.5 Not every mocked screen was ever wired to a real backend

**Decision (superseded):** The **Memories** page was originally left exactly as built in Phase 1 — fully mock data (`CATEGORIES`, `POPULAR_TAGS`, `FREQUENT`, `MEMORY_CARDS`, all hardcoded), never connected to any endpoint, with `app/api/v1/memory.py` and `services/memory.ts` as empty stub files.

**This was later implemented** as auto-captured activity history: an `activity_events` table written at real lifecycle points (document uploaded, processed, failed; conversation started), plus Redis-backed weekly access counters, served by `GET /api/v1/memory/{timeline,recent,frequent}`. The page now renders live data.

The parts of the original mock that required an LLM were deliberately **not** built, because auto-capture cannot produce them honestly: the "Neural Analysis" summary, per-card "% Match" scores, auto-assigned Categories, and auto-generated tags. Categories were remapped onto Workspaces, which are a real user-defined grouping.

**Why:** The PRD's functional requirements (FR-001–FR-028) don't describe a "Memory" concept distinct from documents, chunks, and conversations — "Memories" was a screen in the original Stitch design set, but no backend feature was ever specced for it. Rather than inventing a feature to justify the screen, it was left as an intentionally unfinished mockup, out of scope of every phase that followed. This is a real, honest gap, not an oversight discovered late — it was never picked up in any of the later wiring phases because there was never a corresponding backend capability to wire it to.

---

## Phase 2 — Auth pages & route protection

With the mock UI in place, authentication was the first slice wired to a real backend, since every other page depends on knowing who's logged in.

### 2.1 Login/Register use `react-hook-form`; almost everything built afterward uses plain `useState`

**Decision:** The two auth forms (`app/(auth)/login/page.tsx`, `app/(auth)/register/page.tsx`) use `react-hook-form`'s `useForm`/`register`/`watch` for field binding and validation (email pattern, password minimum length, a live password-strength meter on register, and a `confirm_password` cross-field validator). Every form built in every phase after this one — Settings' profile form, Vault's "new collection" prompt, the search filters — uses plain controlled `useState` instead.

**Why `react-hook-form` for these two specifically:** register in particular has real multi-field validation that benefits from a form library — a confirm-password-matches-password rule that has to re-validate as the user types either field, a live strength indicator computed from a `watch()`ed field, and five distinct per-field error states rendered inline. This is exactly the kind of form where hand-rolling equivalent state (`errors.email`, `errors.password`, `errors.confirmPassword`, ...) starts to earn a form library's cost.

**Why nothing built afterward followed suit:** every later form (rename a workspace, edit a profile field, change a password) turned out to be 1–3 fields with simple, non-cross-referential validation (non-blank, min length) — trivial to express as a couple of `if` checks before calling the service function. `react-hook-form` remained the right call for the two forms that actually needed it, and was never reached for again because nothing else needed it. **This means the codebase has both patterns simultaneously, genuinely** — not a stray inconsistency to "clean up," but two different forms with two different amounts of real complexity, each handled with the tool that fit.

### 2.2 Google OAuth: redirect + one-time-code exchange, with a StrictMode-safe guard

**Decision:** Both login and register's "Continue with Google" buttons do a plain `window.location.href` redirect to the backend's `/auth/google` route (which itself redirects to Google, then back to the backend's callback, then to the frontend's `/auth/callback?code=...`). The frontend's callback page (`CallbackContent.tsx`) exchanges that one-time code for real tokens via `POST /auth/exchange`, guarded by a `useRef` flag (`called.current`) checked before firing the exchange.

**Why the `useRef` guard specifically:** React 19's Strict Mode intentionally double-invokes effects in development to surface side-effect bugs. Without the guard, the exchange effect would fire twice — and since the backend's one-time code is deleted from Redis after its first use (by design, see `BACKEND_DECISIONS.md` 1.1), the second exchange would fail and show the user a spurious "Authentication failed" error immediately after a successful login. The ref-based guard (checked and set synchronously before the async call starts) is the standard fix for "this effect must only ever really run once" under Strict Mode.

### 2.3 Auth state: Zustand, one store, plus a non-sensitive cookie for the edge

**Decision:** A single `useAuthStore` (Zustand + `persist` middleware, backed by `localStorage`) holds `user`, `accessToken`, `refreshToken`, and an `isHydrated` flag. Alongside the token state, `setAuth`/`clearAuth` also set/delete a separate `recall_session` cookie containing only the literal string `"1"` — never the actual token.

**Why the actual tokens live in `localStorage`, not a cookie:** `lib/api.ts`'s interceptor (2.4) attaches the access token as an `Authorization` header on every request; it never needs to be a cookie the browser sends automatically. **Why a *separate*, non-sensitive cookie exists at all:** `proxy.ts` (0.2) runs at the edge, before any client JavaScript executes, so it can't read `localStorage` — it needs *something* synchronous and readable server-side to decide whether to redirect, and a marker cookie that carries no sensitive data is enough for that coarse check. The actual authorization of every API call still depends on the bearer token, not the cookie — a forged `recall_session=1` cookie with no valid token would pass `proxy.ts`'s check but get a real `401` from the backend on the first request.

**Why `isHydrated` exists as its own flag:** `persist` rehydrates from `localStorage` asynchronously after first paint. Without an explicit hydration flag, there's a frame where `user` reads as `null` even for a logged-in user, which would incorrectly bounce them to `/login`. `app/(app)/layout.tsx` checks `isHydrated` before deciding to redirect, and shows a loading spinner instead of flashing a login redirect while state is still rehydrating.

**Belt-and-suspenders at the layout level:** `app/(app)/layout.tsx` *also* checks Zustand's hydrated auth state client-side and redirects to `/login` if it's empty — on top of `proxy.ts`'s edge check. This looks redundant but covers a real gap: `proxy.ts` only sees the cookie, so a stale cookie with an actually-expired/invalid token would pass the edge check and only get caught once the client hydrates and the axios interceptor (2.4) hits a real `401`.

### 2.4 API client: one shared axios instance, interceptor-based token refresh

**Decision:** `src/lib/api.ts` exports a single configured `axios` instance (`api`) used by every `services/*.ts` file that needs an authenticated request. A request interceptor attaches the Zustand access token as a Bearer header; a response interceptor catches `401`s, transparently calls `/auth/refresh` once, retries the original request, and queues any other requests that 401'd while a refresh was already in flight (so concurrent requests don't each trigger their own refresh call).

**Why centralize this in an interceptor instead of per-call try/catch:** every page would otherwise need to duplicate "if 401, refresh, retry" logic. Handling it once at the transport layer means every service call site can stay a plain `api.get(...).then(r => r.data)` with no auth-retry logic of its own. **Why a request queue during refresh:** without it, N concurrent 401s would fire N concurrent refresh calls, and the last one to resolve would "win," potentially invalidating a refresh token another in-flight request just used.

### 2.5 Two axios instances exist — and login/register bypass the services layer entirely

**Decision, as actually built:** `services/auth.ts` defines its own bare `axios.create(...)` instance (separate from `lib/api.ts`'s shared `api`) and exports `login`, `register`, and `googleLogin` methods wrapping it. **In practice, none of those three methods are called anywhere in the app.** The actual login and register pages (`app/(auth)/login/page.tsx`, `app/(auth)/register/page.tsx`) import `api` from `lib/api.ts` directly and call `api.post("/auth/login", ...)`/`api.post("/auth/register", ...)` inline inside their own `onSubmit` handlers, bypassing `services/auth.ts` completely. The Google button similarly does its own `window.location.href` redirect inline rather than calling `authService.googleLogin()`.

**Why this happened, honestly:** the auth pages were built in Phase 2 as complete, self-contained components (form + validation + submit handler together), while the `services/*.ts` pattern (Phase 3.1) — one typed file per resource, imported by pages — was established and consistently followed starting with `documents.ts` in the next phase. `services/auth.ts` was scaffolded early alongside that intended pattern but the auth pages were never refactored to use it once the pattern solidified, since they already worked. The one method in `services/auth.ts` that **is** real and used is `updateProfile` (added in Phase 7.1) — added correctly using the shared authenticated `api` instance from `lib/api.ts`, following the convention every other service uses, because by Phase 7 the services-layer convention was firmly established.

**Why this is worth documenting rather than quietly fixing:** it's a genuine, accurate record of how the codebase actually grew — a convention that solidified *after* the first two pages were written, leaving those two pages as an exception rather than retrofitting them. A future cleanup pass could route login/register through `authService`, but as of this writing they don't, and this document should reflect the code as it is.

---

## Phase 3 — Wiring real document upload (Vault + Dashboard)

Once auth was real, documents were the next vertical slice wired end-to-end — this established the `services/*.ts` pattern followed by every phase after it.

### 3.1 Services layer: typed, one file per resource, thin

**Decision:** Starting with `services/documents.ts`, every subsequent resource got its own file (`services/workspace.ts`, `services/chat.ts`, `services/search.ts`) exporting a plain object of methods that wrap an `api.<verb>(...)` call and return `r.data`, typed against a matching TypeScript interface that mirrors the backend's response shape field-for-field.

**Why:** Pages call `documentService.upload(...)`, `workspaceService.list()`, etc. instead of touching `axios`/`api` directly. This is the single place API paths and payload shapes are defined, so a backend contract change (e.g. adding `excerpt` to `ChatSource` in Phase 7) means editing one interface, not hunting through every page that touches chat sources. This convention is followed without exception by every resource *except* the two auth pages that predate it (2.5).

### 3.2 Upload exists in two places with independently duplicated client-side validation

**Decision:** Both the Vault page (click-to-browse, or drag files onto the empty state) and the Dashboard page (a dedicated drag-and-drop zone plus a header button) can upload documents, and each defines its **own** local `ALLOWED_EXTENSIONS`/`MAX_FILE_SIZE` constants and its own `handleFileSelect`/`handleFiles` function, rather than sharing one upload component or one constants file.

**Why two upload entry points:** Dashboard's is a quick-capture affordance for a user who just wants to drop a file without navigating away from their landing page; Vault's is the full document-management view where upload is one of several actions alongside browsing, deleting, and reprocessing. Both ultimately call the same `documentService.upload(file, opts)`. **Why the validation constants weren't extracted into one shared file:** this is accepted duplication rather than a deliberate design choice — two independent, small (`.pdf`/`.docx`, 50MB) constants that happen to match the backend's own allowlist (`BACKEND_DECISIONS.md` 2.1). It's flagged here honestly as a real spot where sharing would have been easy and simply wasn't done, rather than claimed as intentional.

### 3.3 Every page owns its data fetching; no client-side caching layer

**Decision:** No React Query/SWR/RTK Query, despite none being excluded by the stack. Each page fetches what it needs in a `useEffect` on mount (and sometimes on a dependency change, e.g. Vault refetching documents when the active workspace changes), stores it in local `useState`, and manually re-fetches after a mutation (upload, delete, reprocess) rather than relying on cache invalidation.

**Why:** The data volume and request frequency here don't justify a caching library — most pages fetch once per visit, and mutations are already co-located with the one page that needs to see their effect (e.g. Vault's own delete handler updates Vault's own document list). Adding a caching layer would mean learning/maintaining query-key invalidation rules for a problem that plain "refetch after mutation" already solves simply.

**Concrete pattern (Vault page, the most complex fetcher in the app):** `fetchDocuments(workspaceId)` and `fetchWorkspaces()` are separate `useCallback`s; any mutation that could change either (upload, delete, reprocess, workspace create/delete) explicitly calls both afterward, because document counts shown per-workspace in the sidebar need to stay in sync with the document list itself. There's also a lightweight poll (`setInterval`, 3s) that keeps refetching documents *only* while at least one is `PENDING`/`PROCESSING`, so status badges update live without a websocket — and stops polling the moment nothing is in flight, so it's not running a background timer forever on an idle page.

### 3.4 Low-fi interaction patterns: `window.confirm`/`window.prompt`, no modal system

**Decision:** Destructive actions (delete document, delete workspace) confirm via `window.confirm(...)`; simple text input (naming a new workspace) uses `window.prompt(...)`. There is no custom modal/dialog component in active use, despite `components/ui/dialog.tsx` existing from initial scaffolding (0.3).

**Why:** These are infrequent, low-stakes interactions (a handful of times per session, not a core workflow) where a native browser confirm is functionally identical to a custom modal for the user, at a fraction of the implementation cost — no focus-trap, no escape-key handling, no portal/z-index management to get right. This was a deliberate scope decision to spend implementation effort on the actual retrieval/chat/document features rather than UI chrome.

### 3.5 Shared formatting utilities, not duplicated per page

**Decision:** `lib/format.ts` centralizes `formatBytes`, `formatDate`, `formatRelativeTime`, and `fileIcon` (maps a MIME type to an icon name + color pair) — used by the Vault page, the Dashboard's recent-files widget, and (later) the AI Search page's result cards.

**Why:** File-size formatting and MIME-type-to-icon mapping are exactly the kind of small, easy-to-subtly-duplicate-and-drift logic that belongs in one place — e.g. `fileIcon` is shared so a PDF renders with the same red icon whether it's showing up in the Vault grid, the Dashboard sidebar, or a search result card. Unlike the upload-validation constants (3.2), this one *was* extracted — the difference being these functions are pure formatting logic called from three-plus places, while the validation constants were each written once, inline, at the point they were needed.

---

## Phase 4 — Wiring chat to the real RAG backend

### 4.1 Optimistic UI for the user's own message

**Decision:** Sending a chat message immediately appends the user's message to the message list (with a temporary client-generated ID, `Date.now()`) before the backend has responded, then appends the real assistant response (or shows a three-dot typing indicator) once it arrives.

**Why:** Waiting for a round-trip before showing the user's own message they just typed would make the UI feel laggy for zero benefit — the message content is already known and correct locally; only the assistant's reply is genuinely pending on the network. This pattern was deliberately *not* extended to destructive actions (delete) or workspace creation elsewhere in the app, where showing a false-positive success before backend confirmation risks a more confusing failure state than a brief wait.

### 4.2 Citations grouped by document, not shown as a flat list per chunk

**Decision:** `groupSources()` collapses a message's `ChatSource[]` (potentially several chunks from the same document) into one entry per document, merging page numbers into a single `"p. 3, 7, 12"` string.

**Why:** A user asking "what does my document say about X" thinks in terms of "which documents were used," not "which of the 5 individual chunks" — showing 5 separate citation chips for the same PDF would be noisier than useful. This grouping happens entirely client-side from the raw per-chunk sources the backend already returns, rather than asking the backend to pre-group them, since the backend's `sources` list is also used to compute other things (like the total distinct-document count shown in the chat header).

### 4.3 Citation excerpts displayed per-chunk, inside the per-document group (added in Phase 7)

**Decision:** When the backend started including a real quoted excerpt per source (`BACKEND_DECISIONS.md` 7.3), the frontend's Context Panel was extended so each grouped document card shows every distinct excerpt underneath its filename/page summary — not just the filename, and not collapsed into one blob per document.

**Why keep excerpts un-grouped even though filenames are grouped (4.2):** two different chunks from the same document can be two genuinely different pieces of supporting evidence for the answer — collapsing them into one excerpt would lose information the grouped filename/page summary doesn't need to preserve, since page numbers are just labels but excerpt text is the actual evidence. A `Set`-like de-dupe on exact excerpt text prevents the same chunk being cited twice (e.g. by both the semantic match and appearing again in a later turn) from rendering as a duplicate.

---

## Phase 5 — Conversations page

### 5.1 Search, sort, and date-bucketing are entirely client-side

**Decision:** `ConversationsPage` fetches the user's full conversation list once (`chatService.listConversations()`) and does search filtering, alphabetical/recency sorting, and "Today / Yesterday / This Week / Older" bucketing entirely in-memory via `useMemo`, with no query parameters sent to the backend for any of it.

**Why:** A single user's conversation count is small enough (this is a personal knowledge base, not a shared team inbox with thousands of threads) that fetching everything once and filtering client-side is simpler than designing a paginated, filterable, sortable list endpoint — and avoids a network round-trip on every keystroke of the search box. This mirrors the same "don't add a layer until the data volume actually needs it" reasoning behind not adding a caching library (3.3).

---

## Phase 6 — Workspaces UI

Workspaces (backend: `BACKEND_DECISIONS.md` Phase 6) were surfaced entirely by repurposing UI that already existed from Phase 1, rather than adding new UI chrome.

### 6.1 The Vault "Collections" sidebar mock became the real workspace switcher

**Decision:** Phase 1's Vault mockup already had a "Collections" sidebar with mock entries and active-item styling that did nothing. When workspaces became a real backend feature, this exact sidebar was rewired — `activeCollection: string` became `activeWorkspaceId: number | null` (`null` meaning "All Documents," matching the backend's `list_for_user(workspace_id=None)` semantics), the mock array was replaced with `workspaceService.list()`, and a "New Collection" button that already existed in the mock got a real `window.prompt` → `workspaceService.create()` handler (consistent with 3.4).

**Why reuse instead of building new UI:** the mockup already had the right *shape* for this feature (a switchable list of named folders with counts) — building a separate, new workspace-switcher component would have duplicated UI that was sitting right there unused since Phase 1.

**One small addition beyond what the mock had:** a per-workspace delete affordance (hover trash icon, hidden on the `Default` workspace) was added even though it wasn't in the original mockup, because without it `DELETE /workspaces/{id}` would have been unreachable from the UI entirely — the feature couldn't be exercised end-to-end without it.

### 6.2 Uploads and document listing respect the active workspace

**Decision:** Vault's upload calls pass `{ workspaceId: activeWorkspaceId ?? undefined }` (so uploading while "All Documents" is selected lands in the backend's auto-created Default workspace), and the document list refetches whenever `activeWorkspaceId` changes.

**Why:** This keeps the workspace switcher's behavior consistent with what a folder-based mental model implies — dropping a file while looking at "Research" should file it under Research, not silently into some other bucket.

---

## Phase 7 — Final feature-completion pass: profile, reprocessing, hybrid search

### 7.1 Settings' profile form: plain `useState`, not `react-hook-form`

**Decision:** The real profile-editing form added to the Settings page (full name, optional password change) uses plain controlled `useState` fields with inline `if` validation before calling `authService.updateProfile(...)`, consistent with every form built since Phase 2.1 except the original two auth forms.

**Why:** Same reasoning as 2.1 — two-to-four simple fields, no cross-field validation beyond "if changing password, a new password must be at least 6 characters," not complex enough to justify a form library. Email is rendered read-only (disabled input) since the backend intentionally doesn't support changing it (no re-verification flow exists, `BACKEND_DECISIONS.md` doesn't build one) — a business decision surfaced directly as a disabled field rather than hidden entirely, so the user can see their email is fixed rather than wondering why there's no field for it at all.

### 7.2 Vault's reprocess action only appears where it's legal

**Decision:** The hover "refresh" icon that triggers `documentService.reprocess(id)` is only rendered for documents in `READY` or `FAILED` status — never `PENDING`/`PROCESSING` — matching the backend's `409` guard (`BACKEND_DECISIONS.md` 7.2) exactly.

**Why:** Rather than letting the user click reprocess on an in-flight document and then showing them a toast-ed 409 error, the affordance simply doesn't exist in the states where it would fail — the frontend encodes the same state machine the backend enforces, so the two can never disagree about when reprocessing is legal.

### 7.3 AI Search: the fabricated mock content was removed, not adapted, when real data arrived

**Decision:** Phase 1's AI Search mockup included a fabricated "AI Insight" narrative block (a hardcoded paragraph of prose about Kubernetes, styled as if an LLM had generated it) and a "Knowledge Graph" placeholder panel with no data behind it. When the page was wired to the real `/search` endpoint (`BACKEND_DECISIONS.md` 7.4), both were **removed entirely** rather than kept as decoration or backed with a hastily-added feature.

**Why remove rather than keep:** once real search results existed, leaving a hardcoded fake "AI-generated" paragraph in place would have been actively misleading — a user could reasonably believe RECALL was synthesizing insights it wasn't. Building a real insight-generation feature to justify keeping it would have meant a new, recurring OpenAI call for something no functional requirement asked for. The Knowledge Graph panel was disconnected from any real data model in the backend (there's no graph structure anywhere in the schema) and was replaced with an honest "How Search Works" explainer and a real, locally-tracked "Recent Searches" list instead — every element on the page after this pass corresponds to something the backend actually does.

### 7.4 Search filters map directly to backend query parameters, one-to-one

**Decision:** The AI Search page's filter row (file type, workspace, date-from, date-to) are plain `<select>`/`<input type="date">` elements whose values are sent as-is to `searchService.search(query, filters)`, which maps them directly onto `SearchRequest`'s `mime_type`/`workspace_id`/`date_from`/`date_to` fields — no client-side filtering of results after the fact.

**Why send filters to the backend rather than filtering the returned list client-side:** the backend's hybrid search (`BACKEND_DECISIONS.md` 7.4) applies filters *before* ranking — narrowing the candidate document set changes which chunks are even considered, not just which results are displayed. Filtering client-side after the fact would show the same top-K ranked-across-everything results with some hidden, rather than actually searching within the filtered set — a real quality difference, not just a UI convenience.

---

## Cross-cutting decisions (apply across every phase)

### C.1 Toasts for feedback: `sonner`, one consistent success/error pattern

**Decision:** Every mutating action across every phase (upload, delete, reprocess, workspace create/delete, profile save, search) follows the same pattern: `try { ...; toast.success(...) } catch (err) { toast.error(extractErrorMessage(err, "<fallback>")) }`, using `sonner` for the toast itself and a shared `lib/errors.ts::extractErrorMessage` helper that pulls FastAPI's `detail` field out of an axios error, falling back to a page-specific generic message if the backend didn't send one.

**Why a shared error-extraction helper:** the backend consistently returns `{"detail": "..."}` on errors (FastAPI's default `HTTPException` shape) — centralizing "how do I get a human-readable message out of a failed request" in one function means every page's catch block is one line, and a backend error message change doesn't require touching every page that might surface it. This helper was written once (Phase 3) and reused, unmodified, by every phase after it.

### C.2 TypeScript contracts mirror the backend exactly, kept in sync by hand

**Decision:** Every `services/*.ts` interface (`RecallDocument`, `Workspace`, `ChatSource`, `SearchResult`, etc.) is a hand-written TypeScript type matching the backend's Pydantic/dict response shape field-for-field — there is no shared schema/codegen step between backend and frontend.

**Why no codegen (e.g. OpenAPI-generated client):** FastAPI does generate an OpenAPI spec for free, but introducing a codegen step adds a build dependency and a generation command that has to be remembered and re-run on every backend contract change, for a project with a small enough surface area that manually keeping half a dozen interface files in sync is not a real burden yet. This is a candidate for revisiting if the API surface grows substantially.

---

## What ended up unused, and why that's being reported honestly

Not every dependency pulled in by initial scaffolding (0.3) found a use. Reporting this accurately matters more than pretending the dependency list only contains things the app actually needs:

| Scaffolded | Status | Why it never got used |
|---|---|---|
| `components/ui/*` (shadcn primitives) | Unused | Every page hand-rolls layout against exact mockup values instead (1.2) |
| Full OKLCH light/dark theme in `globals.css` | Unused | Product is dark-mode-only by explicit design; the theme tokens are never referenced by any page's `style={}` |
| `lucide-react` | Unused | Material Symbols Outlined font used instead, to match the Stitch mockups exactly (1.3) |
| `react-hook-form`, `zod` | Partially used | Only the two original auth forms (2.1) use `react-hook-form`, and only for its field-binding/validation — `zod` schema validation was never actually wired in even there (validation rules are plain `react-hook-form` `register()` options, not a `zodResolver`) |
| `framer-motion`, `radix-ui`, `class-variance-authority` | Unused | Pulled in transitively by shadcn's scaffolding; no page uses animation beyond plain CSS `transition-*` classes or Radix primitives directly |
| `services/auth.ts`'s `login`/`register`/`googleLogin` | Unused (dead code) | The pages that need this logic inline their own calls instead — see 2.5 for the full explanation |
| `services/memory.ts`, `app/api/v1/memory.py` | Implemented later | Originally empty stubs; now backed by the activity-history feature — see 1.5 |
| `app/chat/`, `app/dashboard/`, `app/login/`, `app/register/`, `app/settings/` (top-level, outside the `(app)`/`(auth)` route groups) | Unused (empty directories) | Leftover from an early routing structure before the `(app)`/`(auth)` route groups were adopted; never populated or removed |
| `store/` (singular, empty directory) vs. `stores/authStore.ts` | `store/` unused | Leftover from before the `stores/` (plural) naming was settled on for the one real store |

---

## Deviations from the original architecture plan

`docs/ARCHITECTURE.md` was written before implementation and describes a fuller structure (`src/components/{chat,settings,sidebar,shared}/`, `src/hooks/`, `src/providers/`, `src/types/`, `src/constants/`) that exists as empty scaffolded directories today but was never actually populated:

| Planned | Built instead | Why |
|---|---|---|
| `components/chat/`, `components/settings/`, `components/shared/`, `components/sidebar/` (reusable per-feature components) | Each page is mostly self-contained; only `components/layout/Sidebar.tsx` and `TopBar.tsx` are real, shared across every `(app)` page via `app/(app)/layout.tsx` | Most UI (message bubbles, source cards, filter chips) is specific enough to its one page that extracting it didn't reduce duplication — the two truly page-independent pieces (the nav sidebar and top bar) *are* extracted |
| `hooks/` (`useAuth()`, `useStreamingChat()`, `useConversation()`) | Data fetching lives inline in each page's `useEffect`/`useCallback` | No hook was reused across more than one page, so extracting one preemptively would be indirection without payoff |
| `providers/` (Theme/Auth/Query providers) | None — Zustand's store needs no provider wrapper, and there's no theme switching (dark-mode-only, 1.2) or query cache (3.3) to provide | Both features that would have needed a provider were deliberately not built |
| `types/` (shared `User`, `Conversation`, `Message`, `Workspace` models) | Each type lives next to the service that owns it (`services/documents.ts` exports `RecallDocument`, etc.), except `AuthUser` in `stores/authStore.ts` | Every type has exactly one natural owner module; a separate `types/` barrel would just re-export them with an extra indirection hop |
| `constants/` (API paths, feature flags) | API base URL is one constant in `lib/api.ts`; no feature flags exist | Nothing else in the app is a genuine cross-cutting constant yet — even the upload-validation constants that could arguably belong here were left inline per-page (3.2) |

This mirrors the same anti-overengineering stance documented in `BACKEND_DECISIONS.md`: the scaffolding for a larger app exists (via `create-next-app`/shadcn init), but only the pieces actual features needed were ever built out — and this document tries to report that honestly, including the rough edges, rather than describing a cleaner codebase than the one that actually exists.
