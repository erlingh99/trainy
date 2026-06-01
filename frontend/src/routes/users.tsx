import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { ApiBanner } from "@/components/ApiBanner";
import { PaletteGrid } from "@/components/PaletteGrid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { updateUser, usersQuery } from "@/lib/queries";
import type { User } from "@/lib/types";
import { Link } from "@tanstack/react-router";
import { currentIsoWeek } from "@/lib/week";
import { Pencil, Trash2 } from "lucide-react";
import { getPalette, isCustomPalette, customSwatchColor } from "@/lib/palettes";

export const Route = createFileRoute("/users")({
  loader: ({ context }) => context.queryClient.ensureQueryData(usersQuery()).catch(() => []),
  component: UsersPage,
});

function UsersPage() {
  const { t } = useTranslation();
  const { data: users = [] } = useQuery(usersQuery());
  const qc = useQueryClient();

  // ── create state ──
  const [name, setName] = useState("");
  const [newPalette, setNewPalette] = useState<string | null>(null);

  // ── edit state ──
  const [pendingEdit, setPendingEdit] = useState<User | null>(null);
  const [editName, setEditName] = useState("");
  const [editPalette, setEditPalette] = useState<string | null>(null);

  // ── delete state ──
  const [pendingDelete, setPendingDelete] = useState<User | null>(null);

  const create = useMutation({
    mutationFn: (payload: { name: string; palette: string | null }) =>
      api<User>("/api/users", { method: "POST", json: payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setName("");
      setNewPalette(null);
    },
  });

  const edit = useMutation({
    mutationFn: ({ id, name, palette }: { id: string; name: string; palette: string | null }) =>
      updateUser(id, { name, palette }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setPendingEdit(null);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/api/users/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  function openEdit(u: User) {
    setPendingEdit(u);
    setEditName(u.name);
    setEditPalette(u.palette ?? null);
  }

  function submitEdit() {
    if (pendingEdit && editName.trim()) {
      edit.mutate({ id: pendingEdit.id, name: editName.trim(), palette: editPalette });
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <ApiBanner />
      <AppHeader />
      <main className="container mx-auto max-w-xl p-4">
        <h1 className="mb-4 text-xl font-semibold">{t("users.manage")}</h1>

        {/* ── Create form ── */}
        <div className="mb-6 rounded-lg border bg-card p-4">
          <p className="mb-3 text-sm font-medium">{t("users.create")}</p>
          <div className="mb-3 flex gap-2">
            <Input
              value={name}
              placeholder={t("users.addPlaceholder")}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim())
                  create.mutate({ name: name.trim(), palette: newPalette });
              }}
            />
          </div>
          <div className="mb-3">
            <p className="mb-1.5 text-xs text-muted-foreground">{t("palette.title")}</p>
            <PaletteGrid value={newPalette} onChange={setNewPalette} />
          </div>
          <Button
            className="w-full"
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate({ name: name.trim(), palette: newPalette })}
          >
            {t("users.create")}
          </Button>
        </div>

        {/* ── User list ── */}
        {users.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("users.noUsers")}</p>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {users.map((u) => {
              const swatchColor = isCustomPalette(u.palette)
                ? customSwatchColor(u.palette)
                : getPalette(u.palette).swatches[0];
              const paletteLabel = isCustomPalette(u.palette)
                ? t("palette.custom")
                : t(`palette.${getPalette(u.palette).id}` as never, {
                    defaultValue: getPalette(u.palette).label,
                  });
              return (
                <li
                  key={u.id}
                  className="flex items-center justify-between py-2.5 px-3 transition-colors hover:bg-accent/30"
                  style={{ borderLeft: `3px solid ${swatchColor}` }}
                >
                  <div className="flex items-center gap-2.5">
                    <Link
                      to="/u/$username/week/$week"
                      params={{ username: u.name, week: currentIsoWeek() }}
                      onClick={() => localStorage.setItem("lastUser", u.name)}
                      className="font-medium hover:underline"
                    >
                      {u.name}
                    </Link>
                    <span className="text-xs text-muted-foreground">{paletteLabel}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(u)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setPendingDelete(u)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      {/* ── Edit dialog ── */}
      <Dialog
        open={!!pendingEdit}
        onOpenChange={(open) => {
          if (!open) setPendingEdit(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("users.editTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <Input
              value={editName}
              placeholder={t("users.renamePlaceholder")}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitEdit();
              }}
              autoFocus
            />
            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">{t("palette.title")}</p>
              <PaletteGrid value={editPalette} onChange={setEditPalette} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingEdit(null)}>
              {t("session.cancel")}
            </Button>
            <Button disabled={!editName.trim() || edit.isPending} onClick={submitEdit}>
              {t("users.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete dialog ── */}
      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("users.delete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && t("users.confirmDelete", { name: pendingDelete.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("session.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDelete) remove.mutate(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              {t("users.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
