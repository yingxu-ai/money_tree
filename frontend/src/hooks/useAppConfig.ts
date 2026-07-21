import { useEffect } from "react";
import { useAppConfigStore } from "@/stores/appConfigStore";

export function useAppConfig() {
  return useAppConfigStore((s) => s.config);
}

export function useDocumentTitle(suffix?: string) {
  const appTitle = useAppConfigStore((s) => s.config.appTitle);

  useEffect(() => {
    document.title = suffix ? `${suffix} - ${appTitle}` : appTitle;
  }, [appTitle, suffix]);
}
