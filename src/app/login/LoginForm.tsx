"use client";
import { useActionState } from "react";
import { ArrowRight, CircleAlert, Lock, Mail } from "lucide-react";
import { loginAction, type FormState } from "../actions";
import { SubmitButton } from "@/components/client";

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState<FormState, FormData>(loginAction, {});
  return (
    <form action={action} className="stack" autoComplete="on">
      {state.error && (
        <div className="alert alert-error" role="alert">
          <CircleAlert size={18} /> {state.error}
        </div>
      )}
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="email">Email</label>
        <div className="field-icon">
          <Mail size={17} />
          <input id="email" name="email" type="email" placeholder="you@example.com" defaultValue={state.values?.email ?? ""} key={state.values?.email} required autoFocus autoComplete="email" />
        </div>
      </div>
      <div>
        <label htmlFor="password">Password</label>
        <div className="field-icon">
          <Lock size={17} />
          <input id="password" name="password" type="password" placeholder="••••••••" required autoComplete="current-password" />
        </div>
      </div>
      <SubmitButton className="btn btn-primary btn-lg btn-block">
        Sign in <ArrowRight size={17} />
      </SubmitButton>
    </form>
  );
}
