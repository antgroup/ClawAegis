import { useState } from "react";
import { X, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

export function ArrayEditor({
  label,
  help,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  help: string;
  placeholder?: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");

  const add = () => {
    const trimmed = input.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
      setInput("");
    }
  };

  const remove = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-900">{label}</h3>
      <p className="text-xs text-gray-500 mt-0.5">{help}</p>
      <div className="flex flex-wrap gap-1.5 mt-3 min-h-[28px]">
        {values.map((v, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded"
          >
            {v}
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-blue-400 hover:text-blue-600"
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2 mt-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          placeholder={placeholder}
          className="flex-1 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 px-2"
        >
          <Plus size={14} /> {t("common.add")}
        </button>
      </div>
    </div>
  );
}
