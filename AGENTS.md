t st# Tasky - Agent Context

## What this is

A Next.js + Convex personal task/note/capture manager with auth, hierarchical tags, and a Kanban board.

## Tech stack

- **Frontend**: Next.js 16 (App Router), React 19, TailwindCSS 4, dnd-kit (drag-and-drop), TipTap (markdown editor)
- **Backend**: Convex (reactive database, mutations, queries, search indexes)
- **Auth**: Better Auth with GitHub OAuth, integrated via Convex

## Directory structure

```
src/
  app/
    page.tsx              # Home - redirects or shows captures
    tasks/
      page.tsx            # Kanban board (status/priority columns, DnD)
      TaskModal.tsx        # Create/edit task modal (shared by page + captures)
      constants.ts         # Status/priority enums, config, weights
    notes/
      page.tsx            # Notes list with search
      NoteModal.tsx        # Create note modal (shared by page + captures)
    tags/
      page.tsx            # Hierarchical tag manager
    dashboard/
      page.tsx            # Activity dashboard with Recharts visualizations
    ConvexClientProvider.tsx
    layout.tsx
  components/
    Navigation.tsx         # Top nav with saving indicator
    CapturesSidebar.tsx    # Right sidebar on tasks/notes pages
    CaptureItem.tsx        # Capture card with convert-to-task/note actions
    TagSelector.tsx        # Tag picker + search tag filter
    MarkdownEditor.tsx     # TipTap markdown editor component
    StyledSelect.tsx       # Custom select dropdown
    SignIn.tsx
  lib/
    useTrackedMutation.ts  # Mutation wrapper that tracks saving state
    useSelectedTag.ts      # Tag filter state synced to URL + sessionStorage
    SavingContext.tsx       # Global saving state, prevents tab close
    useAuthSession.ts      # Auth session hook

convex/
  schema.ts               # Data model
  auth.ts                 # Better Auth config
  captures.ts             # Capture CRUD
  tasks.ts                # Task CRUD + search + status/priority updates
  notes.ts                # Note CRUD + search
  events.ts               # Event logging helper + time-range query for dashboard
  tags.ts                 # Tag CRUD with recursive hierarchy management
  http.ts                 # HTTP routes for auth callbacks
```

## Data model (convex/schema.ts)

- **captures**: `userId`, `text`, `completed`, `statusUpdatedAt`
- **tasks**: `userId`, `content` (markdown), `tagIds[]`, `status` (not_started/in_progress/blocked/closed), `priority` (triage/low/medium/high), `dueDate`, `completedAt`, `statusUpdatedAt`, `createdFromCaptureId`
- **notes**: `userId`, `content` (markdown), `tagIds[]`, `createdFromCaptureId`
- **events**: `userId`, `timestamp`, `entityId` (string), `action` (discriminated union by `type` e.g. `"task.status_changed"` with `from`/`to`), `tagIds[]` (snapshot at event time)
- **tags**: `userId`, `name`, `parentId`, `color`, `childrenRecursive[]` (denormalized descendant IDs)

All tables have a `by_user` index. Tasks/notes have full-text `search_content` indexes. Events has `by_user_timestamp` for time-range queries.

## Key patterns

- **useTrackedMutation**: Wraps Convex `useMutation` to track in-flight state via `SavingContext`. Supports `.withOptimisticUpdate()` chaining. Used everywhere instead of raw `useMutation`.
- **Optimistic updates**: All mutations include optimistic updates that patch the local Convex store for instant UI feedback.
- **Capture conversion**: Captures can be converted to tasks or notes. The `tasks.create` and `notes.create` mutations accept `createdFromCaptureId` and atomically delete the source capture.
- **Tag hierarchy**: Tags support parent-child relationships. `childrenRecursive` is maintained on write so queries can efficiently filter by a tag and all descendants.
- **Auth guard**: Every query/mutation calls `getAuthUserId(ctx)`. Queries return `[]` if unauthenticated; mutations throw.
- **Auth (client-side)**: `useAuthSession()` (from `src/lib/useAuthSession.ts`) wraps Better Auth's `authClient.useSession()` and returns `{ session, isPending }`. Pages check auth by destructuring these two fields: show a spinner while `isPending` is true, render `<SignIn />` if `!session`, otherwise render page content. There is no `isAuthenticated` field -- use `session` as a truthy check instead.

## Conventions

- All data is user-scoped (no sharing)
- Markdown content rendered via `react-markdown` (read) and TipTap (edit)
- `useSelectedTag` syncs tag filter to URL params + sessionStorage for persistence
- Task/note creation from captures uses the same modals (`TaskModal`/`NoteModal`) as regular creation, with `initialContent` and `createdFromCaptureId` props
