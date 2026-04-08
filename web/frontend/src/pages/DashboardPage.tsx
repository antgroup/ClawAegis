import { useStatus, useEvents } from "../api/hooks";
import { StatsCards } from "../components/dashboard/StatsCards";
import { DefenseStatusGrid } from "../components/dashboard/DefenseStatusGrid";
import { IntegrityBadge } from "../components/dashboard/IntegrityBadge";
import { StatusBadge } from "../components/common/StatusBadge";
import { Shield } from "lucide-react";
import { useTranslation } from "react-i18next";

export function DashboardPage() {
  const { t } = useTranslation();
  const { data: status, isLoading: statusLoading } = useStatus();
  const { data: events } = useEvents({ limit: "10" });

  if (statusLoading) {
    return <div className="text-gray-500">{t("dashboard.loading")}</div>;
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <Shield size={24} className="text-blue-600" />
        <h1 className="text-xl font-bold">{t("dashboard.title")}</h1>
        {status?.configMtime && (
          <span className="text-xs text-gray-400 ml-auto">
            {t("dashboard.configUpdated")} {new Date(status.configMtime).toLocaleString()}
          </span>
        )}
      </div>

      {status && <StatsCards defenses={status.defenses} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          {status && <DefenseStatusGrid defenses={status.defenses} />}
          {status && <IntegrityBadge integrity={status.integrity} />}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-sm text-gray-500">
              {t("dashboard.trustedSkills")} <span className="font-semibold text-gray-900">{status?.trustedSkillCount ?? 0}</span>
            </p>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">{t("dashboard.recentEvents")}</h3>
          </div>
          {events?.events.length ? (
            <div className="divide-y divide-gray-100">
              {events.events.map((ev) => (
                <div key={ev.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">{ev.defense}</span>
                    <StatusBadge value={ev.result} />
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {ev.reason ?? t("dashboard.noDetails")} &middot;{" "}
                    {new Date(ev.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 text-sm text-gray-400">{t("dashboard.noEvents")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
