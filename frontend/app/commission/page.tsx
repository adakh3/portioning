"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// "My Targets" now lives at the top of the dashboard. Keep this route as a
// redirect so old links/bookmarks don't 404.
export default function CommissionRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);
  return null;
}
