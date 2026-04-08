import { useState } from "react";
import { useEvents } from "../api/hooks";
import { StatusBadge } from "../components/common/StatusBadge";
import { ScrollText } from "lucide-react";
import { useTranslation } from "react-i18next";

export function EventsPage() {
  const { t } = useTranslation();
  const [defense, setDefense] = useState("");
  const [result, setResult] = useState("");

  const params: Record<string, string> = { limit: "50" };
  if (defense) params.defense = defense;
  if (result) params.result = result;

  const { data, isLoading } = useEvents(params);

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <ScrollText size={24} className="text-blue-600" />
        <h1 className="text-xl font-bold">{t("events.title")}</h1>
        <span className="text-xs text-gray-400 ml-auto">
          {t("events.totalEvents", { count: data?.total ?? 0 })}
        </span>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <select
          value={defense}
          onChange={(e) => setDefense(e.target.value)}
          className="text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">{t("events.allDefenses")}</option>
          <option value="selfProtection">{t("events.selfProtection")}</option>
          <option value="commandBlock">{t("events.commandBlock")}</option>
          <option value="encodingGuard">{t("events.encodingGuard")}</option>
          <option value="memoryGuard">{t("events.memoryGuard")}</option>
          <option value="loopGuard">{t("events.loopGuard")}</option>
          <option value="exfiltrationGuard">{t("events.exfiltrationGuard")}</option>
          <option value="skillScan">{t("events.skillScan")}</option>
          <option value="config">{t("events.configEvent")}</option>
        </select>
        <select
          value={result}
          onChange={(e) => setResult(e.target.value)}
          className="text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">{t("events.allResults")}</option>
          <option value="blocked">{t("events.blocked")}</option>
          <option value="observed">{t("events.observed")}</option>
          <option value="clear">{t("events.clear")}</option>
        </select>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-4 text-sm text-gray-400">{t("events.loading")}</div>
        ) : data?.events.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-2 font-medium text-gray-600">{t("events.colTime")}</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">{t("events.colDefense")}</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">{t("events.colResult")}</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">{t("events.colTool")}</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">{t("events.colReason")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.events.map((ev) => (
                <tr key={ev.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-500 whitespace-nowrap">
                    {new Date(ev.timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 font-medium">{ev.defense}</td>
                  <td className="px-4 py-2">
                    <StatusBadge value={ev.result} />
                  </td>
                  <td className="px-4 py-2 text-gray-600">{ev.toolName ?? "-"}</td>
                  <td className="px-4 py-2 text-gray-500 truncate max-w-xs">
                    {ev.reason ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-4 text-sm text-gray-400">{t("events.noMatch")}</div>
        )}
      </div>
    </div>
  );
}
