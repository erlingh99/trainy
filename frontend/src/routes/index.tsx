import { createFileRoute, redirect } from "@tanstack/react-router";
import { currentIsoWeek } from "@/lib/week";
import { usersQuery } from "@/lib/queries";
import type { User } from "@/lib/types";

export const Route = createFileRoute("/")({
  beforeLoad: async ({ context }) => {
    const last = typeof window !== "undefined" ? localStorage.getItem("lastUser") : null;
    if (last) {
      const users = await context.queryClient
        .ensureQueryData(usersQuery())
        .catch(() => [] as User[]);
      if (Array.isArray(users) && users.some((u: User) => u.name === last)) {
        throw redirect({
          to: "/u/$username/week/$week",
          params: { username: last, week: currentIsoWeek() },
        });
      }
      if (typeof window !== "undefined") localStorage.removeItem("lastUser");
    }
    throw redirect({ to: "/users" });
  },
  component: () => null,
});
