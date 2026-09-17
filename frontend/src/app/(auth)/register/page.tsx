"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { api } from "@/lib/api";

interface FormData {
  full_name: string;
  email: string;
  password: string;
  confirm_password: string;
  terms: boolean;
}

function getStrength(pwd: string) {
  if (!pwd) return { width: "0%", color: "transparent", label: "" };
  if (pwd.length < 6) return { width: "20%", color: "#ffb4ab", label: "Too short" };
  if (pwd.length < 10) return { width: "55%", color: "#FBBC05", label: "Moderate" };
  return { width: "100%", color: "#ffffff", label: "Strong" };
}

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export default function RegisterPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormData>();

  const passwordValue = watch("password", "");
  const strength = getStrength(passwordValue);

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    try {
      await api.post("/auth/register", {
        full_name: data.full_name,
        email: data.email,
        password: data.password,
      });
      toast.success("Account created! Please sign in.");
      router.push("/login");
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? "Registration failed. Please try again.";
      toast.error(detail);
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
        className="hidden lg:flex relative w-[60%] flex-col justify-between p-12"
        style={{ background: "#0e0e0e", borderRight: "1px solid rgba(255,255,255,0.05)" }}
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
            RECALL orchestrates your digital consciousness. Seamlessly capture,
            connect, and retrieve information with a memory-optimised graph that
            adapts to your mental workflows.
          </p>
        </div>
        <div className="flex gap-3">
          {["AI Refined", "Secure Stack"].map((tag) => (
            <span
              key={tag}
              className="px-3 py-1 text-xs font-semibold uppercase rounded-lg"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#c4c7c8",
                letterSpacing: "0.1em",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      </section>

      {/* ── Right: Register form (40%) ── */}
      <section
        className="flex flex-1 flex-col items-center justify-center px-6 py-12"
        style={{ background: "#0e0e0e" }}
      >
        <div className="flex lg:hidden mb-10">
          <span className="text-2xl font-bold tracking-tight text-white">RECALL</span>
        </div>

        <div
          className="w-full max-w-[440px] rounded-xl p-6 sm:p-10 shadow-2xl"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            backdropFilter: "blur(24px)",
          }}
        >
          <div className="mb-7">
            <h2
              className="text-3xl font-semibold mb-1"
              style={{ color: "#e5e2e1", letterSpacing: "-0.03em" }}
            >
              Create your account
            </h2>
            <p className="text-sm" style={{ color: "#c4c7c8" }}>
              Start building your personal knowledge base.
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* Full Name */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium uppercase" style={{ color: "#c4c7c8", letterSpacing: "0.1em" }}>
                Full Name
              </label>
              <input
                {...register("full_name", {
                  required: "Full name is required",
                  minLength: { value: 2, message: "Enter your full name" },
                })}
                type="text"
                placeholder="John Doe"
                autoComplete="name"
                className="w-full px-4 py-3 rounded-lg text-sm outline-none transition-all duration-200 placeholder:opacity-30"
                style={{
                  background: "#1c1b1b",
                  border: errors.full_name ? "1px solid #ffb4ab" : "1px solid #444748",
                  color: "#e5e2e1",
                }}
              />
              {errors.full_name && (
                <p className="text-xs mt-1" style={{ color: "#ffb4ab" }}>{errors.full_name.message}</p>
              )}
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium uppercase" style={{ color: "#c4c7c8", letterSpacing: "0.1em" }}>
                Email Address
              </label>
              <input
                {...register("email", {
                  required: "Email is required",
                  pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Enter a valid email" },
                })}
                type="email"
                placeholder="name@company.com"
                autoComplete="email"
                className="w-full px-4 py-3 rounded-lg text-sm outline-none transition-all duration-200 placeholder:opacity-30"
                style={{
                  background: "#1c1b1b",
                  border: errors.email ? "1px solid #ffb4ab" : "1px solid #444748",
                  color: "#e5e2e1",
                }}
              />
              {errors.email && (
                <p className="text-xs mt-1" style={{ color: "#ffb4ab" }}>{errors.email.message}</p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-medium uppercase" style={{ color: "#c4c7c8", letterSpacing: "0.1em" }}>
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
                autoComplete="new-password"
                className="w-full px-4 py-3 rounded-lg text-sm outline-none transition-all duration-200 placeholder:opacity-30"
                style={{
                  background: "#1c1b1b",
                  border: errors.password ? "1px solid #ffb4ab" : "1px solid #444748",
                  color: "#e5e2e1",
                }}
              />
              {/* Strength bar */}
              <div className="mt-1.5 h-0.5 w-full rounded-full overflow-hidden" style={{ background: "#2a2a2a" }}>
                <div className="h-full rounded-full transition-all duration-300" style={{ width: strength.width, background: strength.color }} />
              </div>
              {strength.label && (
                <p className="text-[11px]" style={{ color: strength.color }}>{strength.label}</p>
              )}
              {errors.password && (
                <p className="text-xs" style={{ color: "#ffb4ab" }}>{errors.password.message}</p>
              )}
            </div>

            {/* Confirm Password */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium uppercase" style={{ color: "#c4c7c8", letterSpacing: "0.1em" }}>
                Confirm Password
              </label>
              <input
                {...register("confirm_password", {
                  required: "Please confirm your password",
                  validate: (v) => v === passwordValue || "Passwords do not match",
                })}
                type="password"
                placeholder="••••••••"
                autoComplete="new-password"
                className="w-full px-4 py-3 rounded-lg text-sm outline-none transition-all duration-200 placeholder:opacity-30"
                style={{
                  background: "#1c1b1b",
                  border: errors.confirm_password ? "1px solid #ffb4ab" : "1px solid #444748",
                  color: "#e5e2e1",
                }}
              />
              {errors.confirm_password && (
                <p className="text-xs mt-1" style={{ color: "#ffb4ab" }}>{errors.confirm_password.message}</p>
              )}
            </div>

            {/* Terms */}
            <label className="flex items-start gap-3 cursor-pointer pt-1">
              <input
                {...register("terms", { required: "You must accept the terms to continue" })}
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 rounded"
                style={{ accentColor: "#ffffff" }}
              />
              <span className="text-xs leading-relaxed" style={{ color: "#c4c7c8" }}>
                I agree to the{" "}
                <Link href="/terms" target="_blank" className="text-white hover:underline">
                  Terms of Service
                </Link>
                {" "}and{" "}
                <Link href="/privacy" target="_blank" className="text-white hover:underline">
                  Privacy Policy
                </Link>
                .
              </span>
            </label>
            {errors.terms && (
              <p className="text-xs -mt-3" style={{ color: "#ffb4ab" }}>{errors.terms.message}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 rounded-lg text-[15px] font-medium transition-all duration-200 hover:scale-[1.01] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              style={{ background: "#ffffff", color: "#1a1a1a", letterSpacing: "-0.01em" }}
            >
              {loading ? "Creating account…" : "Create Account"}
            </button>
          </form>

          <div className="relative flex items-center gap-4 my-6">
            <div className="flex-1 h-px" style={{ background: "rgba(68,71,72,0.4)" }} />
            <span className="text-xs font-semibold uppercase shrink-0" style={{ color: "#8e9192", letterSpacing: "0.2em" }}>
              Or continue with
            </span>
            <div className="flex-1 h-px" style={{ background: "rgba(68,71,72,0.4)" }} />
          </div>

          <button
            type="button"
            onClick={() => { window.location.href = `${BACKEND}/auth/google`; }}
            className="w-full flex items-center justify-center gap-3 py-3.5 rounded-lg text-sm font-medium transition-all duration-200 hover:brightness-125 active:scale-[0.99]"
            style={{ background: "#1c1b1b", border: "1px solid #444748", color: "#e5e2e1" }}
          >
            <GoogleIcon />
            Continue with Google
          </button>

          <p className="text-center text-sm mt-6" style={{ color: "#c4c7c8" }}>
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-white hover:opacity-70 transition-opacity">
              Sign In
            </Link>
          </p>
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
