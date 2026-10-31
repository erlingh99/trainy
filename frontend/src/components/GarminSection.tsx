import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { garminStatusQuery, garminConnect, garminMfa, garminDisconnect } from "@/lib/queries";
import { ApiError } from "@/lib/api";
import { DuplicatesModal } from "./DuplicatesModal";
import { GarminSyncModal } from "./GarminSyncModal";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  Unplug,
  Watch,
} from "lucide-react";

type Props = { username: string; defaultOpen?: boolean };

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function GarminSection({ username, defaultOpen = false }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(defaultOpen);
  const { data: status } = useQuery({ ...garminStatusQuery(username), enabled: open });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justConnected, setJustConnected] = useState(false);
  const [connectingSeconds, setConnectingSeconds] = useState(0);

  // Bulk import state
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkFrom, setBulkFrom] = useState("");
  const [bulkTo, setBulkTo] = useState("");
  const [autoCreate, setAutoCreate] = useState(true);
  const sinceLastKey = `garmin.sinceLast.${username}`;
  const [sinceLast, setSinceLast] = useState(() => localStorage.getItem(sinceLastKey) === "true");
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncConfig, setSyncConfig] = useState<{
    start: string;
    end: string;
    autoCreate: boolean;
  } | null>(null);

  // Duplicates state
  const [dupPanelOpen, setDupPanelOpen] = useState(false);
  const [dupFrom, setDupFrom] = useState("");
  const [dupTo, setDupTo] = useState("");
  const [dupModalOpen, setDupModalOpen] = useState(false);
  const [dupConfig, setDupConfig] = useState<{ start: string; end: string } | null>(null);

  const lastSyncDate = status?.last_sync_at ? localDate(new Date(status.last_sync_at)) : null;
  const useSinceLast = sinceLast && lastSyncDate !== null;
  const importFrom = useSinceLast ? lastSyncDate : bulkFrom;
  const importTo = useSinceLast ? localDate(new Date()) : bulkTo;

  const toggleSinceLast = (checked: boolean) => {
    setSinceLast(checked);
    localStorage.setItem(sinceLastKey, String(checked));
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["garmin", "status", username] });
    qc.invalidateQueries({ queryKey: ["sessions"] });
    qc.invalidateQueries({ queryKey: ["summary"] });
  };

  const connect = useMutation({
    mutationFn: () =>
      garminConnect(username, { garmin_username: email, garmin_password: password }),
    onSuccess: (data: unknown) => {
      const res = data as { mfa_required?: boolean } | undefined;
      if (res?.mfa_required) {
        setMfaRequired(true);
        setError(null);
      } else {
        setMfaRequired(false);
        setEmail("");
        setPassword("");
        setError(null);
        setJustConnected(true);
        setTimeout(() => setJustConnected(false), 4000);
        invalidate();
      }
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : "Connection failed");
    },
  });

  const mfa = useMutation({
    mutationFn: () => garminMfa(username, mfaCode),
    onSuccess: () => {
      setMfaRequired(false);
      setMfaCode("");
      setError(null);
      setJustConnected(true);
      setTimeout(() => setJustConnected(false), 4000);
      invalidate();
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : "MFA verification failed");
    },
  });

  const disconnect = useMutation({
    mutationFn: () => garminDisconnect(username),
    onSuccess: () => invalidate(),
  });

  // Elapsed-time counter while connecting (connection takes 30–45 s)
  useEffect(() => {
    if (!connect.isPending) return;
    const id = setInterval(() => setConnectingSeconds((s) => s + 1), 1000);
    return () => {
      clearInterval(id);
      setConnectingSeconds(0);
    };
  }, [connect.isPending]);

  const connected = status?.connected ?? false;
  const pendingMfa = status?.mfa_pending ?? false;

  return (
    <div className="border-t pt-2 mt-1">
      {/* Header toggle */}
      <button
        className="flex w-full items-center gap-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <Watch className="h-3.5 w-3.5" />
        <span>{t("garmin.title")}</span>
        {connected && (
          <span className="ml-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
            {t("garmin.connected")}
          </span>
        )}
        {pendingMfa && (
          <span className="ml-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">
            {t("garmin.mfaPending")}
          </span>
        )}
        {open ? (
          <ChevronUp className="ml-auto h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="ml-auto h-3.5 w-3.5" />
        )}
      </button>

      {open && (
        <div className="mt-2 space-y-3 text-sm">
          {connected ? (
            /* Connected state */
            <div className="space-y-2">
              {justConnected && (
                <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  {t("garmin.successConnected")}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {t("garmin.signedInAs")}{" "}
                <span className="font-medium text-foreground">{status?.garmin_username}</span>
              </p>
              {status?.last_sync_at && (
                <p className="text-xs text-muted-foreground">
                  {t("garmin.lastSync", { time: new Date(status.last_sync_at).toLocaleString() })}
                </p>
              )}
              {status?.last_sync_error && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {status.last_sync_error}
                </div>
              )}

              {/* Bulk import + duplicates */}
              <div>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 flex-1 text-xs"
                    onClick={() => setBulkOpen((v) => !v)}
                  >
                    {t("garmin.bulkImport")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 flex-1 text-xs"
                    onClick={() => setDupPanelOpen((v) => !v)}
                  >
                    {t("garmin.checkDuplicates")}
                  </Button>
                </div>
                {dupPanelOpen && (
                  <div className="mt-2 space-y-2 rounded-md border bg-muted/30 p-2">
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-[10px] text-muted-foreground">
                          {t("garmin.from")}
                        </label>
                        <Input
                          type="date"
                          className="h-7 text-xs"
                          value={dupFrom}
                          onChange={(e) => setDupFrom(e.target.value)}
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-[10px] text-muted-foreground">
                          {t("garmin.to")}
                        </label>
                        <Input
                          type="date"
                          className="h-7 text-xs"
                          value={dupTo}
                          onChange={(e) => setDupTo(e.target.value)}
                        />
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="h-7 w-full text-xs"
                      disabled={!dupFrom || !dupTo}
                      onClick={() => {
                        setDupConfig({ start: dupFrom, end: dupTo });
                        setDupModalOpen(true);
                      }}
                    >
                      {t("garmin.checkDuplicates")}
                    </Button>
                  </div>
                )}
                {bulkOpen && (
                  <div className="mt-2 space-y-2 rounded-md border bg-muted/30 p-2">
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-[10px] text-muted-foreground">
                          {t("garmin.from")}
                        </label>
                        <Input
                          type="date"
                          className="h-7 text-xs"
                          value={importFrom}
                          disabled={useSinceLast}
                          onChange={(e) => setBulkFrom(e.target.value)}
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-[10px] text-muted-foreground">
                          {t("garmin.to")}
                        </label>
                        <Input
                          type="date"
                          className="h-7 text-xs"
                          value={importTo}
                          disabled={useSinceLast}
                          onChange={(e) => setBulkTo(e.target.value)}
                        />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={useSinceLast}
                        disabled={!lastSyncDate}
                        onChange={(e) => toggleSinceLast(e.target.checked)}
                        className="h-3.5 w-3.5"
                      />
                      <span className={lastSyncDate ? undefined : "text-muted-foreground"}>
                        {lastSyncDate ? t("garmin.sinceLast") : t("garmin.sinceLastNone")}
                      </span>
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={autoCreate}
                        onChange={(e) => setAutoCreate(e.target.checked)}
                        className="h-3.5 w-3.5"
                      />
                      {t("garmin.autoCreate")}
                    </label>
                    <Button
                      size="sm"
                      className="h-7 w-full text-xs"
                      disabled={!importFrom || !importTo}
                      onClick={() => {
                        setSyncConfig({ start: importFrom, end: importTo, autoCreate });
                        setSyncModalOpen(true);
                      }}
                    >
                      <RefreshCw className="mr-1.5 h-3 w-3" />
                      {t("garmin.fetchReview")}
                    </Button>
                  </div>
                )}
              </div>

              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-full gap-1.5 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => disconnect.mutate()}
                disabled={disconnect.isPending}
              >
                {disconnect.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Unplug className="h-3.5 w-3.5" />
                )}
                {t("garmin.disconnect")}
              </Button>
            </div>
          ) : connect.isPending ? (
            /* Connecting loading state */
            <div className="flex flex-col items-center gap-2 py-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-xs font-medium">{t("garmin.connectingTo")}</p>
              <p className="text-[10px] text-muted-foreground">
                {t("garmin.connectingSeconds", { seconds: connectingSeconds })}
              </p>
            </div>
          ) : pendingMfa || mfaRequired ? (
            /* MFA state */
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (mfaCode) mfa.mutate();
              }}
            >
              <p className="text-xs text-muted-foreground">{t("garmin.mfaInstructions")}</p>
              <Input
                placeholder={t("garmin.mfaPlaceholder")}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                maxLength={6}
                className="h-8 text-sm"
                autoComplete="one-time-code"
                autoFocus
              />
              {error && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}
              <Button
                type="submit"
                size="sm"
                className="h-8 w-full gap-1.5"
                disabled={!mfaCode || mfa.isPending}
              >
                {mfa.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {mfa.isPending ? t("garmin.verifying") : t("garmin.verify")}
              </Button>
            </form>
          ) : (
            /* Not connected state */
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (email && password) connect.mutate();
              }}
            >
              <Input
                type="email"
                placeholder={t("garmin.emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-8 text-sm"
                autoComplete="username"
              />
              <Input
                type="password"
                placeholder={t("garmin.passwordPlaceholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-8 text-sm"
                autoComplete="current-password"
              />
              {error && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}
              <Button type="submit" size="sm" className="h-8 w-full" disabled={!email || !password}>
                {t("garmin.connect")}
              </Button>
              <p className="text-[10px] text-muted-foreground">{t("garmin.loginHint")}</p>
            </form>
          )}
        </div>
      )}

      {dupModalOpen && dupConfig && (
        <DuplicatesModal
          username={username}
          from={dupConfig.start}
          to={dupConfig.end}
          onClose={() => setDupModalOpen(false)}
          onDeleted={invalidate}
        />
      )}

      {syncModalOpen && syncConfig && (
        <GarminSyncModal
          username={username}
          startDate={syncConfig.start}
          endDate={syncConfig.end}
          autoCreate={syncConfig.autoCreate}
          onClose={() => setSyncModalOpen(false)}
          onComplete={() => {
            setSyncModalOpen(false);
            invalidate();
          }}
        />
      )}
    </div>
  );
}
