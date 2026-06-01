import { startTransition, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { usersQuery } from "@/lib/queries";
import type { User } from "@/lib/types";
import { ArrowLeftRight, Menu } from "lucide-react";
import { currentIsoWeek } from "@/lib/week";

export function AppHeader({ usernameOverride }: { usernameOverride?: string } = {}) {
  const { t, i18n } = useTranslation();
  const { data: users = [] } = useQuery(usersQuery());
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { username?: string; week?: string };
  const username = usernameOverride ?? params.username;
  const week = params.week;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isMonth = pathname.includes("/month/");
  const isDashboard = pathname.endsWith("/dashboard");

  const [sheetOpen, setSheetOpen] = useState(false);

  const switchUser = (name: string) => {
    localStorage.setItem("lastUser", name);
    setSheetOpen(false);
    startTransition(() => {
      if (isDashboard) {
        navigate({ to: "/u/$username/dashboard", params: { username: name } });
      } else if (isMonth) {
        const yyyymm = pathname.split("/month/")[1];
        navigate({ to: "/u/$username/month/$yyyymm", params: { username: name, yyyymm } });
      } else {
        navigate({
          to: "/u/$username/week/$week",
          params: { username: name, week: week ?? currentIsoWeek() },
        });
      }
    });
  };

  const navLinkClass =
    "flex items-center gap-1.5 rounded px-2 py-2 text-sm text-foreground/70 hover:bg-accent hover:text-foreground";
  const navLinkActiveClass =
    "flex items-center gap-1.5 rounded px-2 py-2 text-sm bg-primary/10 text-primary font-medium";

  return (
    <header className="sticky top-0 z-20 border-b border-primary/20 bg-background/85 backdrop-blur">
      {/* ── Desktop (md+) ───────────────────────────────────────────── */}
      <div className="container mx-auto hidden items-center gap-2 px-3 py-2 md:flex">
        <Link to="/" className="mr-2 text-base font-semibold tracking-tight text-primary">
          {t("app.title")}
        </Link>

        {!usernameOverride && (
          <div className="flex items-center gap-1">
            <Select value={username ?? ""} onValueChange={switchUser}>
              <SelectTrigger className="h-8 w-[160px]">
                <SelectValue placeholder={t("users.select")} />
              </SelectTrigger>
              <SelectContent>
                {users.map((u: User) => (
                  <SelectItem key={u.id} value={u.name}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {username && (
            <div className="flex items-center gap-1 text-sm">
              <Link
                to="/u/$username/week/$week"
                params={{ username, week: week ?? currentIsoWeek() }}
                className="rounded px-2 py-1 text-foreground/70 hover:bg-accent hover:text-foreground"
                activeProps={{
                  className: "rounded px-2 py-1 bg-primary/10 text-primary font-medium",
                }}
              >
                {t("nav.week")}
              </Link>
              <Link
                to="/u/$username/month/$yyyymm"
                params={{ username, yyyymm: new Date().toISOString().slice(0, 7) }}
                className="rounded px-2 py-1 text-foreground/70 hover:bg-accent hover:text-foreground"
                activeProps={{
                  className: "rounded px-2 py-1 bg-primary/10 text-primary font-medium",
                }}
              >
                {t("nav.month")}
              </Link>
              <Link
                to="/u/$username/dashboard"
                params={{ username }}
                className="rounded px-2 py-1 text-foreground/70 hover:bg-accent hover:text-foreground"
                activeProps={{
                  className: "rounded px-2 py-1 bg-primary/10 text-primary font-medium",
                }}
              >
                {t("nav.dashboard")}
              </Link>
              <Link
                to="/compare/week/$week"
                params={{ week: week ?? currentIsoWeek() }}
                search={{ user1: username, user2: undefined }}
                className="flex items-center gap-1 rounded px-2 py-1 text-foreground/70 hover:bg-accent hover:text-foreground"
                activeProps={{
                  className:
                    "flex items-center gap-1 rounded px-2 py-1 bg-primary/10 text-primary font-medium",
                }}
              >
                <ArrowLeftRight className="h-3 w-3" />
                {t("nav.compare")}
              </Link>
            </div>
          )}
          <Select
            value={(i18n.language ?? "sv").slice(0, 2)}
            onValueChange={(v) => i18n.changeLanguage(v)}
          >
            <SelectTrigger className="h-8 w-[80px]" aria-label={t("lang.label")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sv">SV</SelectItem>
              <SelectItem value="nb">NB</SelectItem>
              <SelectItem value="en">EN</SelectItem>
            </SelectContent>
          </Select>
          <Button asChild size="sm" variant="outline" className="h-8">
            <Link to="/users">{t("users.manage")}</Link>
          </Button>
        </div>
      </div>

      {/* ── Mobile (below md) ───────────────────────────────────────── */}
      <div className="container mx-auto flex items-center gap-2 px-3 py-2 md:hidden">
        <Link to="/" className="text-base font-semibold tracking-tight text-primary">
          {t("app.title")}
        </Link>

        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button size="icon" variant="ghost" className="ml-auto h-8 w-8" aria-label="Menu">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-72 overflow-y-auto">
            <SheetHeader className="pb-2">
              <SheetTitle>{t("app.title")}</SheetTitle>
            </SheetHeader>

            <div className="space-y-4 py-2">
              {/* User selector */}
              {!usernameOverride && (
                <Select value={username ?? ""} onValueChange={switchUser}>
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue placeholder={t("users.select")} />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((u: User) => (
                      <SelectItem key={u.id} value={u.name}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Separator />

              {/* Nav links */}
              {username && (
                <nav className="space-y-0.5">
                  <SheetClose asChild>
                    <Link
                      to="/u/$username/week/$week"
                      params={{ username, week: week ?? currentIsoWeek() }}
                      className={navLinkClass}
                      activeProps={{ className: navLinkActiveClass }}
                    >
                      {t("nav.week")}
                    </Link>
                  </SheetClose>
                  <SheetClose asChild>
                    <Link
                      to="/u/$username/month/$yyyymm"
                      params={{ username, yyyymm: new Date().toISOString().slice(0, 7) }}
                      className={navLinkClass}
                      activeProps={{ className: navLinkActiveClass }}
                    >
                      {t("nav.month")}
                    </Link>
                  </SheetClose>
                  <SheetClose asChild>
                    <Link
                      to="/u/$username/dashboard"
                      params={{ username }}
                      className={navLinkClass}
                      activeProps={{ className: navLinkActiveClass }}
                    >
                      {t("nav.dashboard")}
                    </Link>
                  </SheetClose>
                  <SheetClose asChild>
                    <Link
                      to="/compare/week/$week"
                      params={{ week: week ?? currentIsoWeek() }}
                      search={{ user1: username, user2: undefined }}
                      className={navLinkClass}
                      activeProps={{ className: navLinkActiveClass }}
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5" />
                      {t("nav.compare")}
                    </Link>
                  </SheetClose>
                </nav>
              )}

              <Separator />

              {/* Language switcher */}
              <div className="flex gap-2">
                {(["sv", "nb", "en"] as const).map((lang) => (
                  <Button
                    key={lang}
                    size="sm"
                    variant={(i18n.language ?? "sv").slice(0, 2) === lang ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => i18n.changeLanguage(lang)}
                  >
                    {lang.toUpperCase()}
                  </Button>
                ))}
              </div>

              <Separator />

              {/* Manage users */}
              <SheetClose asChild>
                <Button asChild variant="outline" className="w-full">
                  <Link to="/users">{t("users.manage")}</Link>
                </Button>
              </SheetClose>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
