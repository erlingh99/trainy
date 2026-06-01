import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, ApiError } from "@/lib/api";
import { secondsToHmm, km } from "@/lib/format";
import { Loader2, Trash2 } from "lucide-react";

type DupSession = {
  id: string;
  date: string;
  name: string | null;
  form: string | null;
  duration_seconds: number | null;
  distance_km: number | null;
};

type DupGroup = {
  date: string;
  form: string | null;
  sessions: DupSession[];
};

type Props = {
  username: string;
  from: string;
  to: string;
  onClose: () => void;
  onDeleted: () => void;
};

export function DuplicatesModal({ username, from, to, onClose, onDeleted }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<DupGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ user: username, from, to });
    api<DupGroup[]>(`/api/sessions/duplicates?${params}`)
      .then((data) => {
        setGroups(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : String(e));
        setLoading(false);
      });
  }, [username, from, to]);

  const deleteSession = async (id: string) => {
    setDeletingId(id);
    try {
      await api<void>(`/api/sessions/${id}`, { method: "DELETE" });
      setGroups((prev) =>
        prev
          .map((g) => ({ ...g, sessions: g.sessions.filter((s) => s.id !== id) }))
          .filter((g) => g.sessions.length >= 2),
      );
      onDeleted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("garmin.duplicatesTitle")}</DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("api.loading")}
          </div>
        )}

        {error && <p className="py-4 text-sm text-destructive">{error}</p>}

        {!loading && !error && groups.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t("garmin.noDuplicates")}
          </p>
        )}

        {!loading && groups.length > 0 && (
          <div className="max-h-96 overflow-y-auto space-y-3 pr-1">
            {groups.map((g) => (
              <div key={`${g.date}-${g.form}`} className="space-y-1">
                <p className="px-1 text-xs font-semibold text-muted-foreground">
                  {g.date}
                  {g.form && (
                    <>
                      {" · "}
                      {t(`form.${g.form}` as never, { defaultValue: g.form })}
                    </>
                  )}
                </p>
                {g.sessions.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-2 rounded-md border bg-muted/20 px-2 py-1.5 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{s.name ?? s.form ?? t("session.empty")}</span>
                      <div className="mt-0.5 flex gap-2 text-muted-foreground">
                        {s.duration_seconds != null && (
                          <span>{secondsToHmm(s.duration_seconds)}</span>
                        )}
                        {s.distance_km != null && <span>{km(s.distance_km)} km</span>}
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0 text-destructive hover:text-destructive"
                      disabled={deletingId !== null}
                      onClick={() => deleteSession(s.id)}
                    >
                      {deletingId === s.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("garmin.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
