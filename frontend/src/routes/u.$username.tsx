import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppHeader } from "@/components/AppHeader";
import { ApiBanner } from "@/components/ApiBanner";
import { usersQuery } from "@/lib/queries";
import { currentIsoWeek } from "@/lib/week";
import { isCustomPalette, buildCustomVars } from "@/lib/palettes";
import type { User } from "@/lib/types";

export const Route = createFileRoute("/u/$username")({
  loader: async ({ context, params, location }) => {
    const users = await context.queryClient.ensureQueryData(usersQuery()).catch(() => [] as User[]);
    const exists = Array.isArray(users) && users.some((u: User) => u.name === params.username);
    if (!exists) {
      if (typeof window !== "undefined") localStorage.removeItem("lastUser");
      throw redirect({ to: "/users" });
    }
    if (typeof window !== "undefined") {
      localStorage.setItem("lastUser", params.username);
    }
    // If the user navigated to /u/:username with no sub-path, redirect to current week
    if (
      location.pathname === `/u/${params.username}` ||
      location.pathname === `/u/${params.username}/`
    ) {
      throw redirect({
        to: "/u/$username/week/$week",
        params: { username: params.username, week: currentIsoWeek() },
      });
    }
  },
  component: UserLayout,
});

function UserLayout() {
  const { username } = Route.useParams();
  const { data: users = [] } = useQuery(usersQuery());
  const user = users.find((u: User) => u.name === username);
  const palette = user?.palette;
  const custom = isCustomPalette(palette);

  return (
    <div
      className="relative min-h-screen bg-background text-foreground"
      data-palette={custom ? undefined : (palette ?? "default")}
      style={custom ? buildCustomVars(palette) : undefined}
    >
      {/* Palette bloom — fixed so it stays while scrolling */}
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.055]"
        style={{ background: "radial-gradient(ellipse 55% 35% at 85% 0%, var(--primary), transparent)" }}
        aria-hidden
      />
      <div className="relative z-10">
        <ApiBanner />
        <AppHeader />
        <Outlet />
      </div>
    </div>
  );
}
