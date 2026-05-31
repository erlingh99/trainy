import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";

export function ApiBanner() {
  const { t } = useTranslation();
  const { isError } = useQuery({
    queryKey: ["health"],
    queryFn: () => api<{ ok: boolean }>("/api/health"),
    retry: 0,
    refetchInterval: 15000,
  });
  if (!isError) return null;
  return (
    <div className="bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
      {t("api.unreachable")}
    </div>
  );
}
