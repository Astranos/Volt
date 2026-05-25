export type SidepanelToastTone = "success" | "info" | "error" | "warning";

export const SIDEPANEL_TOAST_EVENT = "volt:sidepanel-toast";

export type SidepanelToastDetail = {
  message: string;
  tone?: SidepanelToastTone;
};

/**
 * Dispatch a lightweight in-app toast that the sidepanel header listens for
 * and renders inline inside the active-tool dropdown trigger.
 */
export function showSidepanelToast(
  message: string,
  tone: SidepanelToastTone = "success",
): void {
  if (typeof window === "undefined" || !message) return;
  window.dispatchEvent(
    new CustomEvent<SidepanelToastDetail>(SIDEPANEL_TOAST_EVENT, {
      detail: { message, tone },
    }),
  );
}
