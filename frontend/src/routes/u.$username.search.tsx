import { createFileRoute } from "@tanstack/react-router";
import { SessionSearch } from "@/components/SessionSearch";
import { usersQuery } from "@/lib/queries";
import { STATUSES, type SessionStatus } from "@/lib/types";

type SessionSearchRouteParams = {
  q?: string;
  status?: SessionStatus;
  form?: string;
  character?: string;
  competition?: boolean;
  hasLactate?: boolean;
  from?: string;
  to?: string;
};

const toBool = (v: unknown): boolean | undefined => {
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  return undefined;
};

export const Route = createFileRoute("/u/$username/search")({
  validateSearch: (search: Record<string, unknown>): SessionSearchRouteParams => ({
    q: typeof search.q === "string" ? search.q : undefined,
    status:
      typeof search.status === "string" && (STATUSES as string[]).includes(search.status)
        ? (search.status as SessionStatus)
        : undefined,
    form: typeof search.form === "string" ? search.form : undefined,
    character: typeof search.character === "string" ? search.character : undefined,
    competition: toBool(search.competition),
    hasLactate: toBool(search.hasLactate),
    from: typeof search.from === "string" ? search.from : undefined,
    to: typeof search.to === "string" ? search.to : undefined,
  }),
  loader: ({ context }) => {
    context.queryClient.prefetchQuery(usersQuery());
  },
  component: SearchPage,
});

function SearchPage() {
  const { username } = Route.useParams();
  const filters = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SessionSearch
      username={username}
      filters={filters}
      onFiltersChange={(patch) =>
        navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
      }
    />
  );
}
