"use client";
import { useActionState } from "react";
import { loginAction, type FormState } from "../actions";
import { SubmitButton } from "@/components/client";

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState<FormState, FormData>(loginAction, {});
  return (
    <form action={action} className="stack" autoComplete="on">
      {state.error && <div className="flash flash-error">{state.error}</div>}
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" defaultValue={state.values?.email ?? ""} key={state.values?.email} required autoFocus autoComplete="email" />
      </div>
      <div>
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required autoComplete="current-password" />
      </div>
      <SubmitButton className="btn btn-primary btn-block">Sign in</SubmitButton>
    </form>
  );
}
