"use client";

import { useState } from "react";
import { createId } from "@paralleldrive/cuid2";

export type FieldDef = {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "date";
};

export interface ArrayItem {
  id: string;
  [key: string]: unknown;
}

interface EditorSectionProps<T extends ArrayItem> {
  title: string;
  fields: FieldDef[];
  values: T[];
  onChange: (values: T[]) => void;
  emptyLabel?: string;
  allowReorder?: boolean;
}

export function EditorSection<T extends ArrayItem>({
  title,
  fields,
  values,
  onChange,
  emptyLabel,
  allowReorder = true,
}: EditorSectionProps<T>) {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function handleAdd() {
    const newItem = { id: createId() } as T;
    for (const f of fields) {
      if (f.type === "number") {
        (newItem as Record<string, unknown>)[f.key] = 0;
      } else {
        (newItem as Record<string, unknown>)[f.key] = "";
      }
    }
    onChange([...values, newItem]);
    setExpandedIds(new Set([...expandedIds, newItem.id]));
  }

  function handleRemove(id: string) {
    onChange(values.filter((v) => v.id !== id));
    const next = new Set(expandedIds);
    next.delete(id);
    setExpandedIds(next);
  }

  function handleItemChange(id: string, key: string, val: unknown) {
    onChange(
      values.map((v) =>
        v.id === id ? { ...v, [key]: val } : v,
      ),
    );
  }

  function handleMoveUp(index: number) {
    if (index <= 0) return;
    const next = [...values];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChange(next);
  }

  function handleMoveDown(index: number) {
    if (index >= values.length - 1) return;
    const next = [...values];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    onChange(next);
  }

  function toggleExpand(id: string) {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedIds(next);
  }

  return (
    <div className="rounded-xl border border-black/[.08] bg-white dark:border-white/[.145] dark:bg-zinc-950">
      {/* Section header */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <h3 className="text-sm font-semibold">
          {title}{" "}
          {values.length > 0 && (
            <span className="ml-1.5 text-xs font-normal text-zinc-500">
              ({values.length})
            </span>
          )}
        </h3>
        <svg
          className={`h-4 w-4 text-zinc-500 transition-transform ${
            collapsed ? "" : "rotate-180"
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        </svg>
      </button>

      {!collapsed && (
        <div className="border-t border-black/[.06] px-4 pb-4 pt-3 dark:border-white/[.1]">
          {values.length === 0 && (
            <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
              {emptyLabel ?? `No ${title.toLowerCase()} yet.`}
            </p>
          )}

          <div className="space-y-2">
            {values.map((item, index) => {
              const isExpanded = expandedIds.has(item.id);
              const titleField = item[fields[0]?.key ?? ""] as string;
              const subtitleField =
                fields.length > 1
                  ? (item[fields[1]?.key ?? ""] as string)
                  : "";

              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-black/[.06] dark:border-white/[.1]"
                >
                  {/* Item header */}
                  <div className="flex items-center gap-1 px-3 py-2">
                    {allowReorder && (
                      <div className="flex flex-col gap-0.5 pr-1">
                        <button
                          type="button"
                          onClick={() => handleMoveUp(index)}
                          disabled={index === 0}
                          className="text-zinc-400 hover:text-zinc-600 disabled:opacity-30 dark:hover:text-zinc-300"
                        >
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveDown(index)}
                          disabled={index === values.length - 1}
                          className="text-zinc-400 hover:text-zinc-600 disabled:opacity-30 dark:hover:text-zinc-300"
                        >
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => toggleExpand(item.id)}
                      className="flex-1 text-left"
                    >
                      <span className="text-sm font-medium">
                        {titleField || "(empty)"}
                      </span>
                      {subtitleField && (
                        <span className="ml-2 text-xs text-zinc-500">
                          — {String(subtitleField).slice(0, 40)}
                        </span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRemove(item.id)}
                      className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                      title="Remove"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleExpand(item.id)}
                      className="text-zinc-400"
                    >
                      <svg
                        className={`h-3.5 w-3.5 transition-transform ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>

                  {/* Expanded fields */}
                  {isExpanded && (
                    <div className="space-y-3 border-t border-black/[.06] px-3 py-3 dark:border-white/[.1]">
                      {fields.map((field) => {
                        const val = item[field.key] as string | number;

                        if (field.type === "textarea") {
                          return (
                            <div key={field.key}>
                              <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                                {field.label}
                              </label>
                              <textarea
                                rows={3}
                                value={String(val ?? "")}
                                onChange={(e) =>
                                  handleItemChange(item.id, field.key, e.target.value)
                                }
                                className="w-full rounded-lg border border-black/[.1] bg-transparent px-2.5 py-2 text-xs outline-none focus:border-black dark:border-white/[.15]"
                              />
                            </div>
                          );
                        }

                        return (
                          <div key={field.key}>
                            <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                              {field.label}
                            </label>
                            <input
                              type={field.type === "number" ? "number" : "text"}
                              value={String(val ?? "")}
                              onChange={(e) =>
                                handleItemChange(
                                  item.id,
                                  field.key,
                                  field.type === "number"
                                    ? Number(e.target.value)
                                    : e.target.value,
                                )
                              }
                              className="w-full rounded-lg border border-black/[.1] bg-transparent px-2.5 py-2 text-xs outline-none focus:border-black dark:border-white/[.15]"
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleAdd}
            className="mt-3 flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add {title.slice(0, -1)}
          </button>
        </div>
      )}
    </div>
  );
}
