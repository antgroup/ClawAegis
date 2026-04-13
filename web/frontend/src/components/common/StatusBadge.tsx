import { clsx } from "clsx";
import { useTranslation } from "react-i18next";

const styles: Record<string, string> = {
  enforce: "bg-green-100 text-green-800",
  observe: "bg-yellow-100 text-yellow-800",
  off: "bg-gray-100 text-gray-600",
  blocked: "bg-red-100 text-red-800",
  observed: "bg-yellow-100 text-yellow-800",
  clear: "bg-blue-100 text-blue-800",
  active: "bg-green-100 text-green-800",
  inactive: "bg-gray-100 text-gray-500",
};

export function StatusBadge({ value }: { value: string }) {
  const { t } = useTranslation();

  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
        styles[value] ?? "bg-gray-100 text-gray-600",
      )}
    >
      {t(`status.${value}`, { defaultValue: value })}
    </span>
  );
}
