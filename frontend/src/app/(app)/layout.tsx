"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/authStore";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, isHydrated } = useAuthStore();

  useEffect(() => {
    if (isHydrated && !user) router.replace("/login");
  }, [isHydrated, user, router]);

  if (!isHydrated || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0e0e0e]">
        <div
          className="w-8 h-8 rounded-full border-2 animate-spin"
          style={{ borderColor: "#444748", borderTopColor: "#c0c1ff" }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#0e0e0e]">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar user={user} />
        <main className="flex-1 overflow-y-auto bg-[#131313]">{children}</main>
      </div>
    </div>
  );
}
