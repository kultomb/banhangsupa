"use client";

import { useEffect, useState } from "react";
import { getAuthClient } from "@/lib/db";
import { fetchUserProfileClient } from "@/lib/user-profile-client";
import {
  getEffectiveTrialExpiresAt,
  getTrialShopPrefix,
  isEffectiveTrialAccount,
  syncTrialUiSessionFlag,
} from "@/lib/trial-shop";

type TrialModeBannerProps = {
  /** Slug trong URL — chỉ hiện banner khi khớp shop của user (tránh nhầm). */
  shopSlug: string;
};

export default function TrialModeBanner({ shopSlug }: TrialModeBannerProps) {
  const [visible, setVisible] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);

  useEffect(() => {
    let unsub = () => {};
    try {
      const quick = sessionStorage.getItem("ha_ui_trial");
      if (quick === "1") setVisible(true);
    } catch (_) {}

    unsub = getAuthClient().onAuthStateChanged((user) => {
      if (!user) {
        setVisible(false);
        setExpiresAt(null);
        return;
      }
      void fetchUserProfileClient(user.uid)
        .then((p) => {
          const userSlug = String(p.shopSlug || "").trim();
          if (!userSlug || userSlug !== shopSlug) {
            setVisible(false);
            setExpiresAt(null);
            return;
          }
          const reg = p.registrationTrial;
          const trial = isEffectiveTrialAccount(reg, userSlug, getTrialShopPrefix());
          syncTrialUiSessionFlag({ shopSlug: userSlug, registrationTrial: reg });
          setVisible(trial);
          setExpiresAt(
            getEffectiveTrialExpiresAt(
              p.trialExpiresAtMs && p.trialExpiresAtMs > 0 ? p.trialExpiresAtMs : null,
              p.createdAtMs && p.createdAtMs > 0 ? p.createdAtMs : null,
            ),
          );
        })
        .catch(() => setVisible(false));
    });
    return () => unsub();
  }, [shopSlug]);

  if (!visible) return null;

  const now = Date.now();
  const expired = expiresAt != null && now > expiresAt;
  const daysLeft =
    expiresAt != null && expiresAt > now
      ? Math.max(0, Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000)))
      : null;

  const barStyle = expired
    ? {
        color: "#7f1d1d",
        background: "linear-gradient(90deg, #fee2e2 0%, #fecaca 50%, #fee2e2 100%)",
        borderBottom: "1px solid #ef4444",
      }
    : {
        color: "#065f46",
        background: "linear-gradient(90deg, #ecfdf5 0%, #d1fae5 50%, #ecfdf5 100%)",
        borderBottom: "1px solid #34d399",
      };

  return (
    <div
      role="status"
      style={{
        ...barStyle,
        padding: "10px 14px",
        fontSize: 13,
        fontWeight: 600,
        textAlign: "center",
        lineHeight: 1.45,
      }}
    >
      {expired
        ? "Gói dùng thử đã hết hạn. Nâng cấp để tiếp tục dùng đầy đủ."
        : daysLeft != null
          ? `Bạn đang dùng thử — còn khoảng ${daysLeft} ngày.`
          : "Bạn đang dùng thử — hãy nâng cấp khi sẵn sàng."}
    </div>
  );
}
