import { useEffect, useState } from "react";

type PlotlyNs = {
  react: (el: HTMLElement | string, data: unknown[], layout: unknown, config?: unknown) => Promise<unknown>;
  relayout: (el: HTMLElement | string, update: Record<string, unknown>) => Promise<unknown>;
  restyle: (el: HTMLElement | string, update: Record<string, unknown>, indices?: number | number[]) => Promise<unknown>;
  Plots: { resize: (el: HTMLElement | string) => void };
};

declare global {
  interface Window {
    Plotly?: PlotlyNs;
  }
}

const PLOTLY_CDN = "https://cdn.plot.ly/plotly-2.35.2.min.js";

let loading: Promise<PlotlyNs> | null = null;

function loadPlotly(): Promise<PlotlyNs> {
  if (window.Plotly) return Promise.resolve(window.Plotly);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PLOTLY_CDN}"]`);
    if (existing) {
      existing.addEventListener("load", () => {
        if (window.Plotly) resolve(window.Plotly);
        else reject(new Error("Plotly 加载失败"));
      });
      existing.addEventListener("error", () => reject(new Error("Plotly 脚本加载失败")));
      return;
    }
    const script = document.createElement("script");
    script.src = PLOTLY_CDN;
    script.async = true;
    script.onload = () => {
      if (window.Plotly) resolve(window.Plotly);
      else reject(new Error("Plotly 加载失败"));
    };
    script.onerror = () => reject(new Error("Plotly 脚本加载失败"));
    document.head.appendChild(script);
  });
  return loading;
}

/** 按需加载 CDN Plotly（与 spectrum_viewer 同源能力） */
export function usePlotly() {
  const [plotly, setPlotly] = useState<PlotlyNs | null>(() => window.Plotly ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadPlotly()
      .then((ns) => {
        if (!cancelled) setPlotly(ns);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Plotly 加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { plotly, error };
}
