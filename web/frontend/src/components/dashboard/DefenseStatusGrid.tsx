import type { DefenseStatusEntry } from "@claw-aegis-web/shared";
import { StatusBadge } from "../common/StatusBadge";
import { useTranslation } from "react-i18next";

export function DefenseStatusGrid({
  defenses,
}: {
  defenses: DefenseStatusEntry[];
}) {
  const { t } = useTranslation();

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">{t("defenseStatus.title")}</h3>
      </div>
      <div className="divide-y divide-gray-100">
        {defenses.map((d) => (
          <div key={d.id} className="flex items-center justify-between px-4 py-2.5">
            <div>
              <p className="text-sm font-medium text-gray-900">
                {t(`defenseGroups.${d.id}.label`, { defaultValue: d.label })}
              </p>
            </div>
            <StatusBadge
              value={d.mode ?? (d.enabled ? "active" : "off")}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
