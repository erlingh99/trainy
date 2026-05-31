import { createFileRoute } from "@tanstack/react-router";
import { MonthTable } from "@/components/MonthTable";
import { monthSummaryQuery, usersQuery } from "@/lib/queries";

export const Route = createFileRoute("/u/$username/month/$yyyymm")({
  loader: ({ context, params }) => {
    context.queryClient.prefetchQuery(usersQuery());
    context.queryClient.prefetchQuery(monthSummaryQuery(params.username, params.yyyymm));
  },
  component: MonthPage,
});

function MonthPage() {
  const { username, yyyymm } = Route.useParams();
  return <MonthTable username={username} yyyymm={yyyymm} />;
}
