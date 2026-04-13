import type { DefenseStatusEntry } from "@claw-aegis-web/shared";
import { Shield, Eye, ShieldOff } from "lucide-react";
import { useTranslation } from "react-i18next";

export function StatsCards({ defenses }: { defenses: DefenseStatusEntry[] }) {
  const { t } = useTranslation();
  const enforceCount = defenses.filter((d) => d.mode === "enforce" || (!d.mode && d.enabled)).length;
  const observeCount = defenses.filter((d) => d.mode === "observe").length;
  const offCount = defenses.filter((d) => !d.enabled || d.mode === "off").length;

  const cards = [
    { label: t("stats.enforcing"), count: enforceCount, icon: Shield, color: "text-green-600 bg-green-50" },
    { label: t("stats.observing"), count: observeCount, icon: Eye, color: "text-yellow-600 bg-yellow-50" },
    { label: t("stats.disabled"), count: offCount, icon: ShieldOff, color: "text-gray-500 bg-gray-50" },
  ];

  return (
    <div className="grid grid-cols-3 gap-4">
      {cards.map((card) => (
        <div key={card.label} className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">{card.label}</p>
              <p className="text-2xl font-bold mt-1">{card.count}</p>
            </div>
            <div className={`p-2 rounded-lg ${card.color}`}>
              <card.icon size={20} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
