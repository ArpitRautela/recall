"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";

export default function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setAuth } = useAuthStore();
  const called = useRef(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;

    const code = searchParams.get("code");

    if (!code) {
      toast.error("Invalid callback. Please try again.");
      router.replace("/login");
      return;
    }

    api
      .post("/auth/exchange", { code })
      .then(({ data }) => {
        setAuth(data.user, data.access_token, data.refresh_token);
        toast.success(`Welcome, ${data.user.full_name}!`);
        router.replace("/dashboard");
      })
      .catch(() => {
        toast.error("Authentication failed. Please try again.");
        router.replace("/login");
      });
  }, [searchParams, router, setAuth]);

  return (
    <div className="text-center space-y-4">
      <div
        className="w-8 h-8 border-2 rounded-full animate-spin mx-auto"
        style={{ borderColor: "#444748", borderTopColor: "#ffffff" }}
      />
      <p className="text-sm" style={{ color: "#c4c7c8" }}>
        Completing sign in…
      </p>
    </div>
  );
}
