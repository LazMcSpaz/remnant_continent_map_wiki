// Full-screen login gate for the private atlas. Shown until a session exists;
// the rest of the app boots only after sign-in (see main.ts). Email + password.

import { signIn } from "./auth";

export interface LoginGate {
  show(): void;
  hide(): void;
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

  const error = document.createElement("p");
  error.className = "login-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  form.append(title, sub, email, password, submit, error);

  const overlay = document.createElement("div");
  overlay.className = "login-gate";
  overlay.append(form);
  overlay.hidden = true;
  mount.append(overlay);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    error.hidden = true;
    if (!email.value.trim() || !password.value) {
      error.textContent = "Enter your email and password.";
      error.hidden = false;
      return;
    }
    submit.disabled = true;
    submit.textContent = "Signing in…";
    signIn(email.value.trim(), password.value)
      .then(() => {
        password.value = "";
        onSignedIn();
      })
      .catch((err: unknown) => {
        error.textContent = err instanceof Error ? err.message : "Sign-in failed.";
        error.hidden = false;
      })
      .finally(() => {
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
