import { useCallback, useEffect, useState } from "react";
import { fetchDictItems } from "@/api/system";
import type { DictItemRow } from "@/types";

const cache = new Map<string, DictItemRow[]>();
const inflight = new Map<string, Promise<DictItemRow[]>>();

export async function loadDictItems(typeCode: string, force = false): Promise<DictItemRow[]> {
  if (!force && cache.has(typeCode)) return cache.get(typeCode)!;
  if (!force && inflight.has(typeCode)) return inflight.get(typeCode)!;

  const task = fetchDictItems({ type_code: typeCode }).then((items) => {
    cache.set(typeCode, items);
    inflight.delete(typeCode);
    return items;
  });
  inflight.set(typeCode, task);
  return task;
}

export function clearDictCache(typeCode?: string) {
  if (typeCode) {
    cache.delete(typeCode);
    inflight.delete(typeCode);
  } else {
    cache.clear();
    inflight.clear();
  }
}

export function useDict(typeCode: string | undefined) {
  const [items, setItems] = useState<DictItemRow[]>(() =>
    typeCode && cache.has(typeCode) ? cache.get(typeCode)! : [],
  );
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async (force = false) => {
    if (!typeCode) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      setItems(await loadDictItems(typeCode, force));
    } finally {
      setLoading(false);
    }
  }, [typeCode]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const options = items
    .filter((i) => i.status === "active")
    .map((i) => ({ label: i.label, value: i.value }));

  return { items, options, loading, reload };
}
