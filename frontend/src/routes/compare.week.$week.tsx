import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { usersQuery } from "@/lib/queries";
import { currentIsoWeek, shiftIsoWeek, weekRangeLabel } from "@/lib/week";
import { WeekGrid } from "@/components/WeekGrid";
import { ApiBanner } from "@/components/ApiBanner";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { User } from "@/lib/types";
import { isCustomPalette, buildCustomVars, getPalette, customSwatchColor } from "@/lib/palettes";

export const Route = createFileRoute("/compare/week/$week")({
  validateSearch: (search: Record<string, unknown>) => ({
    user1: typeof search.user1 === "string" ? search.user1 : undefined,
    user2: typeof search.user2 === "string" ? search.user2 : undefined,
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(usersQuery()).catch(() => []);
  },
  component: ComparePage,
});

function paletteProps(palette: string | null | undefined) {
  const custom = isCustomPalette(palette);
  return {
    "data-palette": custom ? undefined : (palette ?? "default"),
    style: custom ? buildCustomVars(palette!) : undefined,
  };
}

function swatchFor(u: User | undefined) {
  if (!u) return undefined;
  return isCustomPalette(u.palette)
    ? customSwatchColor(u.palette)
    : getPalette(u.palette).swatches[0];
}

function ComparePage() {
  const { week } = Route.useParams();
  const { user1, user2 } = Route.useSearch();
  const navigate = useNavigate({ from: "/compare/week/$week" });
  const { t, i18n } = useTranslation();
  const { data: users = [] } = useQuery(usersQuery());

  const user1Obj = users.find((u) => u.name === user1);
  const user2Obj = users.find((u) => u.name === user2);
  const swatch1 = swatchFor(user1Obj);
  const swatch2 = swatchFor(user2Obj);

  const goWeek = (delta: number) => {
    navigate({
      to: "/compare/week/$week",
      params: { week: shiftIsoWeek(week, delta) },
      search: { user1, user2 },
    });
  };

  const setUser = (which: "user1" | "user2", name: string) => {
    navigate({
      to: "/compare/week/$week",
      params: { week },
      search: which === "user1" ? { user1: name, user2 } : { user1, user2: name },
    });
  };

  return (
    // Outer div scoped to user1's palette — affects AppHeader accent + week nav
    <div
      className="min-h-screen bg-background text-foreground"
      {...paletteProps(user1Obj?.palette)}
    >
      <ApiBanner />
      <AppHeader usernameOverride={user1} />

      <div className="container mx-auto px-3 py-4">
        <div className="mb-4 flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 hover:bg-primary/10 hover:text-primary"
            onClick={() => goWeek(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[130px] text-center text-sm font-semibold text-primary">
            {weekRangeLabel(week, i18n.language)}
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 hover:bg-primary/10 hover:text-primary"
            onClick={() => goWeek(1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() =>
              navigate({
                to: "/compare/week/$week",
                params: { week: currentIsoWeek() },
                search: { user1, user2 },
              })
            }
          >
            {t("nav.today")}
          </Button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-4">
          <UserSelector
            label={t("compare.user1")}
            value={user1}
            users={users}
            swatchColor={swatch1}
            onChange={(n) => setUser("user1", n)}
          />
          <UserSelector
            label={t("compare.user2")}
            value={user2}
            users={users}
            swatchColor={swatch2}
            onChange={(n) => setUser("user2", n)}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* ── User 1 panel — scoped to user1's palette ── */}
          <div
            className="overflow-hidden rounded-lg border bg-card text-foreground"
            {...paletteProps(user1Obj?.palette)}
          >
            {user1 ? (
              <>
                <div className="border-b border-primary/20 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary">
                  {user1}
                </div>
                <WeekGrid username={user1} week={week} noContainer />
              </>
            ) : (
              <EmptyPanel label={t("compare.selectUser")} />
            )}
          </div>

          {/* ── User 2 panel — scoped to user2's palette ── */}
          <div
            className="overflow-hidden rounded-lg border bg-card text-foreground"
            {...paletteProps(user2Obj?.palette)}
          >
            {user2 ? (
              <>
                <div className="border-b border-primary/20 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary">
                  {user2}
                </div>
                <WeekGrid username={user2} week={week} noContainer />
              </>
            ) : (
              <EmptyPanel label={t("compare.selectUser")} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function UserSelector({
  label,
  value,
  users,
  swatchColor,
  onChange,
}: {
  label: string;
  value: string | undefined;
  users: User[];
  swatchColor: string | undefined;
  onChange: (name: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        {swatchColor && (
          <span
            className="h-2.5 w-2.5 flex-shrink-0 rounded-full ring-1 ring-border"
            style={{ background: swatchColor }}
          />
        )}
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      </div>
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger className="h-9">
          <SelectValue placeholder={t("users.select")} />
        </SelectTrigger>
        <SelectContent>
          {users.map((u) => {
            const swatch = isCustomPalette(u.palette)
              ? customSwatchColor(u.palette)
              : getPalette(u.palette).swatches[0];
            return (
              <SelectItem key={u.id} value={u.name}>
                <span className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ background: swatch }}
                  />
                  {u.name}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

function EmptyPanel({ label }: { label: string }) {
  return (
    <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}
