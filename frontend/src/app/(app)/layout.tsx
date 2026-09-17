"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/authStore";
import Sidebar, { SidebarContent } from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import CommandPalette from "@/components/CommandPalette";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, isHydrated } = useAuthStore();
  const [navOpen, setNavOpen] = useState(false);

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
      {/* Permanent column from lg up */}
      <Sidebar />

      {/* Same nav as a drawer below lg */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent
          side="left"
          className="p-0 w-[280px] sm:max-w-[280px] border-r-0 lg:hidden"
          style={{ background: "#1c1b1b" }}
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <CommandPalette />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar user={user} onMenuClick={() => setNavOpen(true)} />
        <main className="flex-1 overflow-y-auto bg-[#131313]">{children}</main>
      </div>
    </div>
  );
}
