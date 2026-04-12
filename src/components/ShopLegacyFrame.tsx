"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getAuthClient } from "@/lib/db";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";
import AccountBar from "@/components/AccountBar";
import { confirmDialog } from "@/components/confirm-dialog";
import type { ConfirmDialogOptions } from "@/components/confirm-dialog";

declare global {
  interface Window {
    __hanghoGetIdToken?: () => Promise<string | null>;
  }
}

const PM_GET = "HANGHO_GET_ID_TOKEN";
const PM_TOKEN = "HANGHO_ID_TOKEN";
const PM_CONFIRM = "HANGHO_CONFIRM";
const PM_CONFIRM_RESULT = "HANGHO_CONFIRM_RESULT";
const PM_DATA_CHANGED = "HANGHO_DATA_CHANGED";

async function readHanghoIdToken(): Promise<string | null> {
  const u = getAuthClient().getCurrentUser();
  if (!u) return null;
  try {
    return await u.getIdToken();
  } catch {
    return null;
  }
}

type ShopLegacyFrameProps = {
  shop: string;
};

export default function ShopLegacyFrame({ shop }: ShopLegacyFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [accountMount, setAccountMount] = useState<HTMLElement | null>(null);
  const src = useMemo(() => `/legacy/index.html?shop=${encodeURIComponent(shop)}`, [shop]);

  useEffect(() => {
    setAccountMount(null);
  }, [shop]);

  useLayoutEffect(() => {
    window.__hanghoGetIdToken = () => readHanghoIdToken();

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const child = iframeRef.current?.contentWindow;
      if (!child || e.source !== child) return;
      const d = e.data;
      if (!d || typeof d !== "object") return;

      if (d.type === PM_GET && typeof d.requestId === "string") {
        void (async () => {
          const token = await readHanghoIdToken();
          (e.source as Window | null)?.postMessage(
            { type: PM_TOKEN, requestId: d.requestId, token },
            e.origin,
          );
        })();
        return;
      }

      if (d.type === PM_CONFIRM && typeof d.requestId === "string") {
        const raw = d.options;
        const opts: ConfirmDialogOptions =
          raw && typeof raw === "object" ? { ...raw } : {};
        void (async () => {
          let ok = false;
          try {
            ok = await confirmDialog.show(opts);
          } catch {
            ok = false;
          }
          (e.source as Window | null)?.postMessage(
            { type: PM_CONFIRM_RESULT, requestId: d.requestId, ok },
            window.location.origin,
          );
        })();
      }
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      delete window.__hanghoGetIdToken;
    };
  }, []);

  // Subscribe to Postgres Changes on pos_version_log — broadcast data-changed to iframe
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase.channel(`pos-version-${shop}`).on(
      "postgres_changes",
      { event: "*", schema: "public", table: "pos_version_log" },
      (payload) => {
        const row = payload.new as { shop_key?: string; write_version?: number } | undefined;
        if (!row?.shop_key) return;
        // Match both shop_<slug> and shop_try-<slug>
        if (!row.shop_key.endsWith(shop)) return;
        const iframe = iframeRef.current?.contentWindow;
        if (!iframe) return;
        iframe.postMessage(
          { type: PM_DATA_CHANGED, writeVersion: row.write_version ?? 0 },
          window.location.origin,
        );
      },
    );
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [shop]);

  const onFrameLoad = useCallback((e: React.SyntheticEvent<HTMLIFrameElement>) => {
    const doc = e.currentTarget.contentDocument;
    if (!doc) return;
    const slot = doc.getElementById("next-account-slot");
    setAccountMount(slot);
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <iframe
        ref={iframeRef}
        src={src}
        title={`Legacy Sales App - ${shop}`}
        onLoad={onFrameLoad}
        style={{
          flex: 1,
          minHeight: 0,
          width: "100%",
          border: "none",
          display: "block",
        }}
      />
      {accountMount ? createPortal(<AccountBar shop={shop} docked />, accountMount) : null}
    </div>
  );
}
