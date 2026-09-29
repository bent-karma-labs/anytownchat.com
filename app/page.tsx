"use client";

import { FormEvent, useRef, useState } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

export default function Home() {
  const router = useRouter();
  const captcha = useRef<TurnstileInstance>(null);
  const [zip, setZip] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Turnstile sitekeys are public by design. Keeping this one in the client
  // guarantees production uses the same widget configured in Cloudflare.
  const siteKey = "0x4AAAAAAFIp3tChT24nFwzZ";

  async function join(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (!/^\d{5}$/.test(zip)) {
      setError("Enter a 5-digit ZIP code.");
      return;
    }

    if (!captchaToken) {
      setError("Complete the human check first.");
      return;
    }

    if (!siteKey) {
      setError("Human verification is not configured yet.");
      return;
    }

    setBusy(true);

    const client = supabase();
    const { error: authError } = await client.auth.signInAnonymously({
      options: { captchaToken },
    });

    captcha.current?.reset();
    setCaptchaToken("");
    setBusy(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    localStorage.setItem("anytown_zip", zip);
    router.push("/community");
  }

  return (
    <main className="min-h-screen px-6 py-10 md:px-12">
      <div className="mx-auto flex min-h-[85vh] max-w-6xl flex-col justify-between">
        <header className="flex items-center justify-between">
          <div className="text-lg font-bold tracking-tight">Anytown Chat</div>
          <div className="rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-400">
            LIVE LOCAL
          </div>
        </header>

        <section className="grid gap-12 py-20 md:grid-cols-[1.2fr_.8fr] md:items-center">
          <div>
            <p className="mb-5 text-sm font-semibold uppercase tracking-[.25em] text-zinc-500">
              Your town, right now.
            </p>
            <h1 className="max-w-3xl text-6xl font-black tracking-[-.05em] md:text-8xl">
              What’s happening in your town?
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-zinc-400">
              Talk to people nearby. Find events. Get help. Share what’s happening.
              Anytown Chat is the digital town square.
            </p>
          </div>

          <form
            onSubmit={join}
            className="rounded-3xl border border-white/10 bg-white/[.04] p-6 shadow-2xl"
          >
            <h2 className="text-2xl font-bold">Enter your town</h2>
            <p className="mt-2 text-sm text-zinc-500">
              ZIP is your community boundary — never your exact location.
            </p>

            <label className="mt-7 block text-sm text-zinc-400">
              ZIP code
              <input
                value={zip}
                onChange={(event) =>
                  setZip(event.target.value.replace(/\D/g, "").slice(0, 5))
                }
                placeholder="90210"
                inputMode="numeric"
                autoComplete="postal-code"
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-white/30"
              />
            </label>

            <div className="mt-5">
              {siteKey ? (
                <Turnstile
                  ref={captcha}
                  siteKey={siteKey}
                  options={{
                    appearance: "always",
                    size: "flexible",
                    theme: "dark",
                  }}
                  onSuccess={setCaptchaToken}
                  onExpire={() => setCaptchaToken("")}
                  onError={() => {
                    setCaptchaToken("");
                    setError("Cloudflare human verification could not load. Check that this domain is authorized in the Turnstile widget.");
                  }}
                />
              ) : (
                <p className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-300">
                  CAPTCHA setup is the last step before launch.
                </p>
              )}
            </div>

            <button
              disabled={busy || !captchaToken}
              className="mt-5 w-full rounded-xl bg-white px-4 py-3 font-bold text-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Entering…" : "Enter Anytown →"}
            </button>

            {error ? (
              <p className="mt-4 rounded-xl bg-red-400/10 p-3 text-sm text-red-300">
                {error}
              </p>
            ) : null}
          </form>
        </section>

        <footer className="text-sm text-zinc-600">
          No email. No password. Just prove you’re human and enter your town.
        </footer>
      </div>
    </main>
  );
}
