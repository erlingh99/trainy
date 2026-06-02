import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { startTransition, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, UserPlus, X } from "lucide-react";
import { api } from "@/lib/api";
import { hmmToSeconds, secondsToHmm } from "@/lib/format";
import { usersQuery } from "@/lib/queries";
import {
  FORMS,
  INTENSITIES,
  STATUSES,
  formRules,
  type Session,
  type SessionPart,
  type SessionStatus,
} from "@/lib/types";

type PartState = {
  form: string;
  character: string;
  intensity: string;
  surface: string;
  duration: string;
  distance: string;
  rpe: string;
  competition: boolean;
};

function defaultPart(): PartState {
  return {
    form: "running",
    character: "distance",
    intensity: "",
    surface: "trail",
    duration: "",
    distance: "",
    rpe: "",
    competition: false,
  };
}

function partFromExisting(p: SessionPart): PartState {
  const form = p.form ?? "running";
  const rules = formRules(form);
  const character =
    p.character && (rules.characters as readonly string[]).includes(p.character)
      ? p.character
      : rules.characters[0];
  const surface =
    p.surface && (rules.surfaces as readonly string[]).includes(p.surface)
      ? p.surface
      : rules.surfaces[0];
  return {
    form,
    character,
    surface,
    duration: secondsToHmm(p.duration_seconds ?? 0),
    intensity: p.intensity ?? "",
    distance: p.distance_km != null ? String(p.distance_km) : "",
    rpe: p.rpe != null ? String(p.rpe) : "",
    competition: p.competition ?? false,
  };
}

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved?: () => void;
  onDeleted?: () => void;
  userId: string;
  date: string;
  sessionNo: number;
  existing?: Session | null;
  weekKey: string;
};

export function SessionDialog({
  open,
  onOpenChange,
  onSaved,
  onDeleted,
  userId,
  date,
  sessionNo,
  existing,
  weekKey,
}: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: allUsers } = useQuery(usersQuery());

  const nameRef = useRef<HTMLInputElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const [hasName, setHasName] = useState(!!existing?.name?.trim());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [buddies, setBuddies] = useState<string[]>([]);
  const [buddyInput, setBuddyInput] = useState("");
  const [form, setForm] = useState({
    parts:
      existing && existing.parts.length > 0
        ? existing.parts.map(partFromExisting)
        : [defaultPart()],
    status: existing?.status ?? "planned",
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["summary", "week"] });
    qc.invalidateQueries({ queryKey: ["summary", "month"] });
    qc.invalidateQueries({ queryKey: ["sessions"] });
  };

  const currentUserName = allUsers?.find((u) => u.id === userId)?.name;

  const addBuddy = () => {
    if (!buddyInput) return;
    setBuddies((prev) => [...prev, buddyInput]);
    setBuddyInput("");
  };

  const isValid =
    hasName && (!!existing || form.parts.some((p) => (hmmToSeconds(p.duration) ?? 0) > 0));

  const buildPayload = () => ({
    user_id: userId,
    date,
    session_no: sessionNo,
    name: nameRef.current?.value.trim() || null,
    parts: form.parts.map((p) => ({
      form: p.form || null,
      character: p.character || null,
      surface: p.surface || null,
      duration_seconds: hmmToSeconds(p.duration),
      intensity: p.intensity || null,
      distance_km: p.distance ? Number(p.distance) : null,
      rpe: p.rpe ? Number(p.rpe) : null,
      competition: p.competition || null,
    })),
    status: form.status,
    comment: commentRef.current?.value || null,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (existing) {
        return api<Session>(`/api/sessions/${existing.id}`, {
          method: "PATCH",
          json: buildPayload(),
        });
      }
      return api<Session>(`/api/sessions`, {
        method: "POST",
        json: { ...buildPayload(), buddy_usernames: buddies },
      });
    },
    onSuccess: () => {
      invalidate();
      onSaved?.();
      onOpenChange(false);
    },
  });

  const remove = useMutation({
    mutationFn: () => api<void>(`/api/sessions/${existing!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      onDeleted?.();
      onOpenChange(false);
    },
  });

  const updatePart = (i: number, patch: Partial<PartState>) =>
    setForm((f) => ({ ...f, parts: f.parts.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));

  const addPart = () => setForm((f) => ({ ...f, parts: [...f.parts, defaultPart()] }));

  const removePart = (i: number) =>
    setForm((f) => ({ ...f, parts: f.parts.filter((_, j) => j !== i) }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {existing ? t("session.edit") : t("session.add")} — {date} · #{sessionNo}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("session.name")} required className="col-span-2">
              <Input
                ref={nameRef}
                defaultValue={existing?.name ?? ""}
                onChange={(e) => startTransition(() => setHasName(e.target.value.trim() !== ""))}
              />
            </Field>
            <Field label={t("session.status")}>
              <EnumSelect
                value={form.status}
                onChange={(v) => setForm((f) => ({ ...f, status: v as SessionStatus }))}
                options={STATUSES as unknown as string[]}
                ns="status"
              />
            </Field>
          </div>

          <div className="space-y-2">
            {form.parts.map((p, i) => (
              <div key={i} className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("session.part")} {form.parts.length > 1 ? i + 1 : ""}
                  </span>
                  {form.parts.length > 1 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removePart(i)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(() => {
                    const rules = formRules(p.form);
                    return (
                      <>
                        <Field label={t("session.form")}>
                          <EnumSelect
                            value={p.form}
                            onChange={(v) => {
                              const r = formRules(v);
                              const patch: Partial<PartState> = { form: v };
                              if (!r.characters.includes(p.character as never))
                                patch.character = r.characters[0];
                              if (!r.surfaces.includes(p.surface as never))
                                patch.surface = r.surfaces[0];
                              if (!r.hasDistance) patch.distance = "";
                              updatePart(i, patch);
                            }}
                            options={FORMS as unknown as string[]}
                            ns="form"
                          />
                        </Field>
                        <Field label={t("session.character")}>
                          <EnumSelect
                            value={p.character}
                            onChange={(v) => updatePart(i, { character: v })}
                            options={rules.characters as unknown as string[]}
                            ns="character"
                          />
                        </Field>
                        <Field label={t("session.intensity")}>
                          <EnumSelect
                            value={p.intensity}
                            onChange={(v) => updatePart(i, { intensity: v })}
                            options={INTENSITIES as unknown as string[]}
                            ns="intensity"
                            nullable
                          />
                        </Field>
                        <Field label={t("session.surface")}>
                          <EnumSelect
                            value={p.surface}
                            onChange={(v) => updatePart(i, { surface: v })}
                            options={rules.surfaces as unknown as string[]}
                            ns="surface"
                          />
                        </Field>
                        <Field label={t("session.duration")}>
                          <Input
                            placeholder="1:00"
                            value={p.duration}
                            onChange={(e) => updatePart(i, { duration: e.target.value })}
                          />
                        </Field>
                        {rules.hasDistance && (
                          <Field label={t("session.distance")}>
                            <Input
                              type="number"
                              step="0.1"
                              value={p.distance}
                              onChange={(e) => updatePart(i, { distance: e.target.value })}
                            />
                          </Field>
                        )}
                        <Field label={t("session.rpe")}>
                          <Input
                            type="number"
                            min={1}
                            max={10}
                            value={p.rpe}
                            onChange={(e) => updatePart(i, { rpe: e.target.value })}
                          />
                        </Field>
                        <label className="col-span-2 flex cursor-pointer items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-input accent-primary"
                            checked={p.competition}
                            onChange={(e) => updatePart(i, { competition: e.target.checked })}
                          />
                          {t("session.competition")}
                        </label>
                      </>
                    );
                  })()}
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={addPart}>
              <Plus className="h-3.5 w-3.5" />
              {t("session.addPart")}
            </Button>
          </div>

          <Field label={t("session.comment")}>
            <Textarea ref={commentRef} rows={2} defaultValue={existing?.comment ?? ""} />
          </Field>

          {!existing && (
            <div className="space-y-2">
              <span className="text-xs text-muted-foreground">{t("session.buddies")}</span>
              <div className="flex gap-2">
                <Select value={buddyInput} onValueChange={setBuddyInput}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder={t("session.buddyPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(allUsers ?? [])
                      .filter((u) => u.name !== currentUserName && !buddies.includes(u.name))
                      .map((u) => (
                        <SelectItem key={u.id} value={u.name}>
                          {u.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addBuddy}
                  disabled={!buddyInput}
                  className="shrink-0 gap-1.5"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  {t("session.addBuddy")}
                </Button>
              </div>
              {buddies.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {buddies.map((name) => (
                    <span
                      key={name}
                      className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium"
                    >
                      {name}
                      <button
                        type="button"
                        onClick={() => setBuddies((prev) => prev.filter((b) => b !== name))}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Remove ${name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="flex-row items-center justify-between gap-2">
          <div>
            {existing && (
              <Button
                variant="destructive"
                onClick={() => setConfirmDelete(true)}
                disabled={remove.isPending}
              >
                {t("session.delete")}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t("session.cancel")}
            </Button>
            <Button onClick={() => save.mutate()} disabled={!isValid || save.isPending}>
              {t("session.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("session.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("session.deleteConfirmDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("session.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => remove.mutate()}
            >
              {t("session.deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`grid gap-1 text-sm ${className ?? ""}`}>
      <span className="text-xs text-muted-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

const NONE = "_none";

function EnumSelect({
  value,
  onChange,
  options,
  ns,
  nullable,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  ns: string;
  nullable?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Select
      value={value || (nullable ? NONE : value)}
      onValueChange={(v) => onChange(v === NONE ? "" : v)}
    >
      <SelectTrigger className="h-9">
        <SelectValue placeholder="—" />
      </SelectTrigger>
      <SelectContent>
        {nullable && <SelectItem value={NONE}>—</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {t(`${ns}.${o}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
