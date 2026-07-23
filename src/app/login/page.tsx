import { redirect } from "next/navigation";

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = (await searchParams) ?? {};
  const nextParams = new URLSearchParams({ mode: "signin" });
  const path = firstParam(params.path);
  const role = firstParam(params.role);
  const returnTo = firstParam(params.returnTo);
  // /auth/callback lands here with ?error= when a link/code exchange fails —
  // dropping it made expired recovery links fail with no visible message.
  const error = firstParam(params.error);

  if (path) {
    nextParams.set("path", path);
  }

  if (role) {
    nextParams.set("role", role);
  }

  if (returnTo) {
    nextParams.set("returnTo", returnTo);
  }

  if (error) {
    nextParams.set("error", error);
  }

  redirect(`/auth?${nextParams.toString()}`);
}
