import { useSkills, useRemoveSkill } from "../api/hooks";
import { Shield, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export function SkillsPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useSkills();
  const removeMutation = useRemoveSkill();

  const handleRemove = (path: string) => {
    if (confirm(t("skills.confirmRemove", { path }))) {
      removeMutation.mutate(path);
    }
  };

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <Shield size={24} className="text-blue-600" />
        <h1 className="text-xl font-bold">{t("skills.title")}</h1>
        <span className="text-xs text-gray-400 ml-auto">
          {t("skills.totalSkills", { count: data?.total ?? 0 })}
        </span>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-4 text-sm text-gray-400">{t("skills.loading")}</div>
        ) : data?.trustedSkills.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-2 font-medium text-gray-600">{t("skills.colPath")}</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">{t("skills.colHash")}</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">{t("skills.colSize")}</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">{t("skills.colScanned")}</th>
                <th className="text-right px-4 py-2 font-medium text-gray-600">{t("skills.colActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.trustedSkills.map((skill) => (
                <tr key={skill.path} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs truncate max-w-xs">
                    {skill.path}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">
                    {skill.hash.slice(0, 12)}...
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {(skill.size / 1024).toFixed(1)} KB
                  </td>
                  <td className="px-4 py-2 text-gray-500">
                    {new Date(skill.scannedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => handleRemove(skill.path)}
                      disabled={removeMutation.isPending}
                      className="text-red-500 hover:text-red-700 disabled:opacity-50"
                      title={t("skills.removeTitle")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-4 text-sm text-gray-400">
            {t("skills.noSkills")}
          </div>
        )}
      </div>
    </div>
  );
}
