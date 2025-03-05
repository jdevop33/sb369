# CLAUDE.md - Agent Instructions

## Commands
- `pnpm dev` - Start development server
- `pnpm build` - Build production version
- `pnpm lint` - Run ESLint checks
- `pnpm preview` - Preview production build
- `pnpm ingest` - Ingest documents
- `pnpm test:file <path>` - Run specific test file (inferred)

## Code Style
- **Components**: Use functional components with hooks, PascalCase naming (ChatInput.tsx)
- **Types**: Define interfaces/types at top of files, or in /types directory
- **Imports**: Group by external, then internal, then types
- **Naming**: camelCase for variables/functions, PascalCase for components/types
- **Error Handling**: Use try/catch with appropriate state management
- **CSS**: Use Tailwind with utility function cn() for class name merging
- **Hooks**: Use useCallback for memoized functions, follow use* naming convention

## Architecture
- React + TypeScript + Vite + Tailwind frontend
- API routes for data fetching in /api
- Custom hooks in /hooks
- Zod for schema validation
- Type safety enforced throughout