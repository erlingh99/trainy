import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { garminStatusQuery, garminConnect, garminDisconnect } from "@/lib/queries";
import { ApiError } from "@/lib/api";
import { DuplicatesModal } from "./DuplicatesModal";
import { GarminSyncModal } from "./GarminSyncModal";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  RefreshCw,
  Unplug,
  Watch,
} from "lucide-react";

type Props = { username: string; defaultOpen?: boolean };

const GARMIN_KEY_URL = "https://connect.garmin.com/app/settings/personalApiToken";
const EXPIRY_WARNING_DAYS = 14;

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysUntil(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((new Date(y, m - 1, d).getTime() - start.getTime()) / 86_400_000);
}

export function GarminSection({ username, defaultOpen = false }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(defaultOpen);
  const { data: status } = useQuery({ ...garminStatusQuery(username), enabled: open });
  const [apiKey, setApiKey] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justConnected, setJustConnected] = useState(false);

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
      garminConnect(username, { api_key: apiKey.trim(), api_key_expires_on: expiresOn || null }),
    onSuccess: () => {
      setApiKey("");
      setExpiresOn("");
      setReplacing(false);
      setError(null);
      setJustConnected(true);
      setTimeout(() => setJustConnected(false), 4000);
      invalidate();
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : "Connection failed");
    },
  });

  const disconnect = useMutation({
    mutationFn: () => garminDisconnect(username),
    onSuccess: () => invalidate(),
  });

  const connected = status?.connected ?? false;
  const daysLeft = status?.api_key_expires_on ? daysUntil(status.api_key_expires_on) : null;
  const keyExpired = daysLeft !== null && daysLeft < 0;

  const keyForm = (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (apiKey.trim()) connect.mutate();
      }}
    >
      <a
        href={GARMIN_KEY_URL}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        {t("garmin.createKeyLink")}
        <ExternalLink className="h-3 w-3" />
      </a>
      <Input
        type="password"
        placeholder={t("garmin.apiKeyPlaceholder")}
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        className="h-8 text-sm"
        autoComplete="off"
      />
      <div>
        <label className="text-[10px] text-muted-foreground">{t("garmin.expiresOnLabel")}</label>
        <Input
          type="date"
          className="h-7 text-xs"
          value={expiresOn}
          onChange={(e) => setExpiresOn(e.target.value)}
        />
      </div>
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      <div className="flex gap-1.5">
        {replacing && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 flex-1"
            onClick={() => {
              setReplacing(false);
              setError(null);
            }}
          >
            {t("garmin.cancel")}
          </Button>
        )}
        <Button
          type="submit"
          size="sm"
          className="h-8 flex-1 gap-1.5"
          disabled={!apiKey.trim() || connect.isPending}
        >
          {connect.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {connect.isPending
            ? t("garmin.verifyingKey")
            : replacing
              ? t("garmin.replaceKey")
              : t("garmin.connect")}
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">{t("garmin.keyHint")}</p>
    </form>
  );

  return (
    <div className="border-t pt-2 mt-1">
      {/* Header toggle */}
      <button
        className="flex w-full items-center gap-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <Watch className="h-3.5 w-3.5" />
        <span>{t("garmin.title")}</span>
        {connected && !keyExpired && (
          <span className="ml-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
            {t("garmin.connected")}
          </span>
        )}
        {keyExpired && (
          <span className="ml-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">
            {t("garmin.keyExpired")}
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
              {daysLeft !== null && daysLeft <= EXPIRY_WARNING_DAYS ? (
                <div className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {keyExpired
                    ? t("garmin.keyExpiredMessage")
                    : daysLeft === 0
                      ? t("garmin.keyExpiresToday")
                      : t("garmin.keyExpiringSoon", { count: daysLeft })}
                </div>
              ) : (
                status?.api_key_expires_on && (
                  <p className="text-xs text-muted-foreground">
                    {t("garmin.keyExpiresOn", {
                      date: new Date(`${status.api_key_expires_on}T00:00`).toLocaleDateString(),
                    })}
                  </p>
                )
              )}
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

              {replacing ? (
                <div className="rounded-md border bg-muted/30 p-2">{keyForm}</div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 w-full text-xs"
                  onClick={() => setReplacing(true)}
                >
                  {t("garmin.replaceKey")}
                </Button>
              )}

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
          ) : (
            keyForm
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
