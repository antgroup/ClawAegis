import { NavLink } from "react-router-dom";
import { LayoutDashboard, Settings, ScrollText, Shield, Languages } from "lucide-react";
import { clsx } from "clsx";
import { useTranslation } from "react-i18next";

const linkDefs = [
  { to: "/", labelKey: "sidebar.dashboard", icon: LayoutDashboard },
  { to: "/config", labelKey: "sidebar.config", icon: Settings },
  { to: "/events", labelKey: "sidebar.events", icon: ScrollText },
  { to: "/skills", labelKey: "sidebar.skills", icon: Shield },
];

export function Sidebar() {
  const { t, i18n } = useTranslation();

  const toggleLang = () => {
    i18n.changeLanguage(i18n.language === "zh" ? "en" : "zh");
  };

  return (
    <aside className="w-56 bg-gray-900 text-gray-100 flex flex-col">
      <div className="px-4 py-5 border-b border-gray-700">
        <h1 className="text-lg font-bold tracking-tight">{t("sidebar.title")}</h1>
        <p className="text-xs text-gray-400 mt-0.5">{t("sidebar.subtitle")}</p>
      </div>
      <nav className="flex-1 mt-2 px-2 space-y-1">
        {linkDefs.map(({ to, labelKey, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-gray-300 hover:bg-gray-800 hover:text-white",
              )
            }
          >
            <Icon size={18} />
            {t(labelKey)}
          </NavLink>
        ))}
      </nav>
      <div className="px-4 py-3 text-xs text-gray-500 border-t border-gray-700 flex items-center justify-between">
        <span>v0.1.0</span>
        <button
          onClick={toggleLang}
          className="flex items-center gap-1 text-gray-400 hover:text-white transition-colors"
          title="Switch language"
        >
          <Languages size={14} />
          <span>{i18n.language === "zh" ? "EN" : "中文"}</span>
        </button>
      </div>
    </aside>
  );
}
