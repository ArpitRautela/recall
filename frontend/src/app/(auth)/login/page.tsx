"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";

interface FormData {
  email: string;
  password: string;
}

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export default function LoginPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>();

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    try {
      const res = await api.post("/auth/login", {
        email: data.email,
        password: data.password,
      });
      setAuth(res.data.user, res.data.access_token, res.data.refresh_token);
      toast.success(`Welcome back, ${res.data.user.full_name}!`);
      router.push("/dashboard");
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail;

      if (status === 429) {
        toast.error(detail ?? "Too many attempts. Please wait.");
      } else {
        toast.error("Invalid email or password.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      className="flex min-h-screen w-full overflow-hidden"
      style={{
        background:
          "radial-gradient(circle at 0% 0%, rgba(67,56,202,0.08) 0%, transparent 40%), radial-gradient(circle at 100% 100%, rgba(67,56,202,0.08) 0%, transparent 40%), #131313",
      }}
    >
      {/* ── Left: Branding (60%) ── */}
      <section
        className="hidden md:flex relative w-[60%] flex-col justify-between p-12"
        style={{ background: "#131313", borderRight: "1px solid rgba(255,255,255,0.05)" }}
      >
        <div>
          <span className="text-2xl font-bold tracking-tight text-white">RECALL</span>
        </div>
        <div className="max-w-[560px]">
          <h1
            className="text-5xl font-semibold text-white mb-6 leading-tight"
            style={{ letterSpacing: "-0.04em" }}
          >
            Never lose context again
          </h1>
          <p className="text-base leading-relaxed" style={{ color: "#c4c7c8" }}>
            Your conversations, notes, files, and knowledge connected in one
            intelligent memory layer.
          </p>
        </div>
        <div />
        <div className="absolute bottom-12 left-12 opacity-20">
          <span
            className="text-xs font-semibold uppercase"
            style={{ color: "#e5e2e1", letterSpacing: "0.3em" }}
          >
            Precision Intelligence
          </span>
        </div>
      </section>

      {/* ── Right: Auth (40%) ── */}
      <section
        className="flex flex-1 flex-col items-center justify-center px-6 py-12"
        style={{ background: "#0e0e0e" }}
      >
        <div className="flex md:hidden mb-12">
          <span className="text-2xl font-bold tracking-tight text-white">RECALL</span>
        </div>

        <div
          className="w-full max-w-[440px] space-y-8 rounded-xl p-10 shadow-2xl"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            backdropFilter: "blur(24px)",
          }}
        >
          <div className="space-y-1">
            <h2
              className="text-3xl font-semibold"
              style={{ color: "#e5e2e1", letterSpacing: "-0.03em" }}
            >
              Welcome back
            </h2>
            <p className="text-sm" style={{ color: "#c4c7c8" }}>
              Enter your credentials to access your memory layer.
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* Email */}
            <div className="space-y-1.5">
              <label
                className="block text-xs font-medium uppercase ml-0.5"
                style={{ color: "#c4c7c8", letterSpacing: "0.08em" }}
              >
                Email address
              </label>
              <input
                {...register("email", {
                  required: "Email is required",
                  pattern: {
                    value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                    message: "Enter a valid email",
                  },
                })}
                type="email"
                placeholder="name@company.com"
                autoComplete="email"
                className="w-full px-4 py-3.5 rounded-lg text-sm outline-none transition-all duration-200 placeholder:opacity-30"
                style={{
                  background: "#201f1f",
                  border: errors.email ? "1px solid #ffb4ab" : "1px solid #444748",
                  color: "#e5e2e1",
                }}
              />
              {errors.email && (
                <p className="text-xs mt-1" style={{ color: "#ffb4ab" }}>
                  {errors.email.message}
                </p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label
                  className="text-xs font-medium uppercase"
                  style={{ color: "#c4c7c8", letterSpacing: "0.08em" }}
                >
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-xs font-semibold uppercase text-white hover:opacity-60 transition-opacity"
                  style={{ letterSpacing: "0.08em" }}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              <input
                {...register("password", {
                  required: "Password is required",
                  minLength: { value: 6, message: "Minimum 6 characters" },
                })}
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full px-4 py-3.5 rounded-lg text-sm outline-none transition-all duration-200 placeholder:opacity-30"
                style={{
                  background: "#201f1f",
                  border: errors.password ? "1px solid #ffb4ab" : "1px solid #444748",
                  color: "#e5e2e1",
                }}
              />
              {errors.password && (
                <p className="text-xs mt-1" style={{ color: "#ffb4ab" }}>
                  {errors.password.message}
                </p>
              )}
            </div>


            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 rounded-lg text-[15px] font-medium transition-all duration-200 hover:scale-[1.01] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              style={{ background: "#ffffff", color: "#1a1a1a", letterSpacing: "-0.01em" }}
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>

          <div className="relative flex items-center gap-4">
            <div className="flex-1 h-px" style={{ background: "rgba(68,71,72,0.4)" }} />
            <span
              className="text-xs font-semibold uppercase shrink-0"
              style={{ color: "#8e9192", letterSpacing: "0.2em" }}
            >
              Or continue with
            </span>
            <div className="flex-1 h-px" style={{ background: "rgba(68,71,72,0.4)" }} />
          </div>

          <button
            type="button"
            onClick={() => { window.location.href = `${BACKEND}/auth/google`; }}
            className="w-full flex items-center justify-center gap-3 py-3.5 rounded-lg text-sm font-medium transition-all duration-200 hover:brightness-125 active:scale-[0.99]"
            style={{ background: "#201f1f", border: "1px solid #444748", color: "#e5e2e1" }}
          >
            <GoogleIcon />
            Continue with Google
          </button>

          <p className="text-center text-sm" style={{ color: "#c4c7c8" }}>
            Don&apos;t have an account?{" "}
            <Link
              href="/register"
              className="font-semibold text-white hover:opacity-70 transition-opacity"
            >
              Join Now
            </Link>
          </p>
        </div>

        <div className="mt-auto pt-12 flex gap-6 opacity-30 hover:opacity-80 transition-opacity duration-300">
          {[
            { label: "PRIVACY POLICY", href: "/privacy" },
            { label: "TERMS", href: "/terms" },
          ].map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="text-[11px] font-semibold uppercase hover:text-white transition-colors"
              style={{ color: "#c4c7c8", letterSpacing: "0.1em" }}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}
