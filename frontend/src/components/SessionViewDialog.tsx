import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Check, Pencil, Pin } from "lucide-react";
import { km, secondsToHmm } from "@/lib/format";
import { sessionDuration, sessionDistance, type Session } from "@/lib/types";
import { SessionDialog } from "./SessionDialog";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: Session;
  userId: string;
  today: string;
  onMarkDone: () => void;
  markDonePending: boolean;
};

export function SessionViewDialog({
  open,
  onOpenChange,
  session: s,
  userId,
  today,
  onMarkDone,
  markDonePending,
}: Props) {
  const { t } = useTranslation();
  const [editOpen, setEditOpen] = useState(false);
  const isMobile = useIsMobile();

  const handleEdit = () => setEditOpen(true);
  const handleMarkDone = () => {
    onMarkDone();
    onOpenChange(false);
  };
  const handleEditSaved = () => {
    setEditOpen(false);
    onOpenChange(false);
  };
  const handleEditDeleted = () => {
    setEditOpen(false);
    onOpenChange(false);
  };
  const handleEditClose = (o: boolean) => {
    if (!o) setEditOpen(false);
    // Don't close the view dialog on cancel — user returns to view
  };

  const totalDuration = sessionDuration(s);
  const totalDistance = sessionDistance(s);

  const info = (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {totalDuration != null && (
          <InfoPair label={t("session.duration")} value={secondsToHmm(totalDuration)} />
        )}
        {totalDistance != null && (
          <InfoPair label={t("session.distance")} value={km(totalDistance)} />
        )}
        <InfoPair label={t("session.status")}>
          <StatusBadge status={s.status} t={t} />
        </InfoPair>
      </div>

      {s.parts.length > 0 && (
        <div className="space-y-2">
          {s.parts.map((p, i) => (
            <div key={i} className="rounded-md border bg-muted/30 px-3 py-2 space-y-1.5">
              {p.form && <p className="text-xs font-semibold">{t(`form.${p.form}`)}</p>}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {p.duration_seconds != null && (
                  <span>
                    {t("session.duration")}:{" "}
                    <span className="text-foreground tabular-nums">
                      {secondsToHmm(p.duration_seconds)}
                    </span>
                  </span>
                )}
                {p.distance_km != null && (
                  <span>
                    {t("session.distance")}:{" "}
                    <span className="text-foreground tabular-nums">{km(p.distance_km)}</span>
                  </span>
                )}
                {p.rpe != null && (
                  <span>
                    {t("session.rpe")}: <span className="text-foreground">{p.rpe}</span>
                  </span>
                )}
              </div>
              {(p.character || p.intensity || p.surface || p.competition) && (
                <div className="flex flex-wrap gap-1">
                  {p.competition && <Chip>{t("session.competition")}</Chip>}
                  {p.character && <Chip>{t(`character.${p.character}`)}</Chip>}
                  {p.intensity && <Chip>{t(`intensity.${p.intensity}`)}</Chip>}
                  {p.surface && <Chip>{t(`surface.${p.surface}`)}</Chip>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {s.lactate_measurements.length > 0 && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Pin className="h-3.5 w-3.5" />
            {t("session.lactate")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {s.lactate_measurements.map((m, i) => (
              <span
                key={i}
                className="rounded-full bg-rose-500/10 px-2.5 py-0.5 text-xs font-medium text-rose-700 dark:text-rose-300"
                title={m.comment ?? undefined}
              >
                {m.value_mmol} mmol/L{m.comment ? ` · ${m.comment}` : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      {s.comment && (
        <div className="rounded-md bg-muted/60 p-3">
          <p className="mb-1 text-xs font-medium text-muted-foreground">{t("session.comment")}</p>
          <p className="leading-relaxed">{s.comment}</p>
        </div>
      )}
    </div>
  );

  const actions = (
    <div className="flex items-center justify-between">
      {s.status === "planned" && s.date <= today ? (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700"
          onClick={handleMarkDone}
          disabled={markDonePending}
        >
          <Check className="h-4 w-4" />
          {t("session.markDone")}
        </Button>
      ) : (
        <span />
      )}
      <Button size="sm" className="gap-1.5" onClick={handleEdit}>
        <Pencil className="h-3.5 w-3.5" />
        {t("session.edit")}
      </Button>
    </div>
  );

  return (
    <>
      {isMobile ? (
        <Drawer open={open && !editOpen} onOpenChange={onOpenChange}>
          <DrawerContent>
            <DrawerHeader className="text-left">
              <DrawerTitle className="leading-snug">
                {s.name || (s.parts[0]?.form ? t(`form.${s.parts[0].form}`) : t("form.other"))}
              </DrawerTitle>
              <p className="text-xs text-muted-foreground">
                {s.date} · #{s.session_no}
              </p>
            </DrawerHeader>
            <div className="overflow-y-auto px-4">{info}</div>
            <DrawerFooter>{actions}</DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={open && !editOpen} onOpenChange={onOpenChange}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="leading-snug">
                {s.name || (s.parts[0]?.form ? t(`form.${s.parts[0].form}`) : t("form.other"))}
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                {s.date} · #{s.session_no}
              </p>
            </DialogHeader>
            {info}
            <div className="pt-1">{actions}</div>
          </DialogContent>
        </Dialog>
      )}

      {editOpen && (
        <SessionDialog
          open={editOpen}
          onOpenChange={handleEditClose}
          onSaved={handleEditSaved}
          onDeleted={handleEditDeleted}
          userId={userId}
          date={s.date}
          sessionNo={s.session_no}
          existing={s}
        />
      )}
    </>
  );
}

function InfoPair({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      {children ?? <p className="font-medium tabular-nums">{value}</p>}
    </div>
  );
}

export function Chip({ children, color }: { children: React.ReactNode; color?: string }) {
  if (color) {
    return (
      <span
        className="rounded-full px-2.5 py-0.5 text-xs font-medium"
        style={{ backgroundColor: `${color}26`, color }}
      >
        {children}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
      {children}
    </span>
  );
}

export function StatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  return (
    <span
      className={cn(
        "rounded px-2 py-0.5 text-xs font-medium",
        status === "done" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
        status === "planned" && "bg-primary/10 text-primary",
        status === "skipped" && "bg-muted text-muted-foreground line-through",
      )}
    >
      {t(`status.${status}`)}
    </span>
  );
}
