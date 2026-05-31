import { createFileRoute } from "@tanstack/react-router";
import { WeekGrid } from "@/components/WeekGrid";
import { usersQuery, weekSummaryQuery } from "@/lib/queries";

export const Route = createFileRoute("/u/$username/week/$week")({
  loader: ({ context, params }) => {
    context.queryClient.prefetchQuery(usersQuery());
    context.queryClient.prefetchQuery(weekSummaryQuery(params.username, params.week));
  },
  component: WeekPage,
});

function WeekPage() {
  const { username, week } = Route.useParams();
  return <WeekGrid username={username} week={week} />;
}
