"use client";
import { useActionState } from "react";
import { ArrowRight, CircleAlert, Lock, Mail, UserRound } from "lucide-react";
import { registerAction, type FormState } from "../actions";
import { SubmitButton } from "@/components/client";

export function RegisterForm() {
  const [state, action] = useActionState<FormState, FormData>(registerAction, {});
  const v = state.values ?? {};
  return (
    <form action={action} className="stack" key={JSON.stringify(v)}>
      {state.error && (
        <div className="alert alert-error" role="alert">
          <CircleAlert size={18} /> {state.error}
        </div>
      )}
      <div>
        <label htmlFor="name">Full name</label>
        <div className="field-icon">
          <UserRound size={17} />
          <input id="name" name="name" type="text" placeholder="Asha Rao" defaultValue={v.name} required maxLength={100} autoComplete="name" />
        </div>
      </div>
      <div>
        <label htmlFor="email">Email</label>
        <div className="field-icon">
          <Mail size={17} />
          <input id="email" name="email" type="email" placeholder="you@example.com" defaultValue={v.email} required autoComplete="email" />
        </div>
      </div>
      <div className="grid-2">
        <div>
          <label htmlFor="password">Password</label>
          <div className="field-icon">
            <Lock size={17} />
            <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
          </div>
        </div>
        <div>
          <label htmlFor="confirm">Confirm</label>
          <div className="field-icon">
            <Lock size={17} />
            <input id="confirm" name="confirm" type="password" required minLength={8} autoComplete="new-password" />
          </div>
        </div>
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        At least 8 characters, with a letter and a number.
      </div>
      <SubmitButton className="btn btn-primary btn-lg btn-block">
        Create account <ArrowRight size={17} />
      </SubmitButton>
    </form>
  );
}
