"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { getAuthClient } from "@/lib/db";
import { fetchUserProfileClient } from "@/lib/user-profile-client";

export default function AppPage() {
  const router = useRouter();

  useEffect(() => {
    const unsub = getAuthClient().onAuthStateChanged(async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      const profile = await fetchUserProfileClient(user.uid);
      const shopSlug = String(profile.shopSlug || "").trim();
      if (shopSlug) {
        router.replace(`/${shopSlug}`);
        return;
      }
      router.replace("/account");
    });
    return () => unsub();
  }, [router]);

  return null;
}
