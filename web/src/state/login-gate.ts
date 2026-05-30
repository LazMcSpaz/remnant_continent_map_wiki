// Full-screen login gate for the private atlas. Shown until a session exists;
// the rest of the app boots only after sign-in (see main.ts). Email + password.

import { signIn } from "./auth";

export interface LoginGate {
  show(): void;
  hide(): void;
}

/** Map common Supabase auth errors to clearer guidance. */
function friendlyError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("email not confirmed")) {
    return "Email not confirmed. In Supabase → Authentication → Users, confirm this user (or recreate with “Auto Confirm User” checked).";
  }
  if (m.includes("invalid login")) {
    return "Invalid email or password.";
  }
  return message || "Sign-in failed.";
}

export function createLoginGate(mount: HTMLElement, onSignedIn: () => void): LoginGate {
  const form = document.createElement("form");
  form.className = "login-form";
  form.noValidate = true;

  const title = document.createElement("h1");
  title.className = "login-title";
  title.textContent = "The Remnant Continent";
  const sub = document.createElement("p");
  sub.className = "login-sub";
  sub.textContent = "Private atlas — sign in to continue.";

  const email = document.createElement("input");
  email.type = "email";
  email.className = "login-input";
  email.placeholder = "Email";
  email.autocomplete = "email";
  email.required = true;

  const password = document.createElement("input");
  password.type = "password";
  password.className = "login-input";
  password.placeholder = "Password";
  password.autocomplete = "current-password";
  password.required = true;

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "login-btn";
  submit.textContent = "Sign in";

  const msg = document.createElement("p");
  msg.className = "login-error";
  msg.setAttribute("role", "alert");
  msg.hidden = true;

  form.append(title, sub, email, password, submit, msg);

  const overlay = document.createElement("div");
  overlay.className = "login-gate";
  overlay.append(form);
  overlay.hidden = true;
  mount.append(overlay);

  const setMsg = (text: string, kind: "error" | "info") => {
    msg.textContent = text;
    msg.dataset.kind = kind;
    msg.hidden = false;
  };

  let busy = false;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (busy) return;
    msg.hidden = true;
    if (!email.value.trim() || !password.value) {
      setMsg("Enter your email and password.", "error");
      return;
    }
    busy = true;
    submit.disabled = true;
    submit.textContent = "Signing in…";
    setMsg("Signing in…", "info");

    // Guard against a request that neither resolves nor rejects (so the UI is
    // never left silently stuck on "Signing in…").
    let settled = false;
    const watchdog = window.setTimeout(() => {
      if (!settled) setMsg("Still trying… check your connection and the browser console.", "info");
    }, 8000);

    signIn(email.value.trim(), password.value)
      .then(() => {
        settled = true;
        password.value = "";
        setMsg("Signed in. Loading…", "info");
        onSignedIn();
      })
      .catch((err: unknown) => {
        settled = true;
        const raw = err instanceof Error ? err.message : String(err);
        console.error("[auth] sign-in failed:", err);
        setMsg(friendlyError(raw), "error");
      })
      .finally(() => {
        settled = true;
        window.clearTimeout(watchdog);
        busy = false;
        submit.disabled = false;
        submit.textContent = "Sign in";
      });
  });

  return {
    show: () => {
      overlay.hidden = false;
      email.focus();
    },
    hide: () => {
      overlay.hidden = true;
    },
  };
}
