import { redirect } from "next/navigation";
import { getAuthPathIntentFromSearchParams, getAuthRoute } from "@/lib/auth/routing";

type SignupPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = (await searchParams) ?? {};
  const nextParams = new URLSearchParams();
  const path = firstParam(params.path);
  const role = firstParam(params.role);

  if (path) {
    nextParams.set("path", path);
  }

  if (role) {
    nextParams.set("role", role);
  }

  redirect(getAuthRoute(
    "signup",
    getAuthPathIntentFromSearchParams(nextParams),
    firstParam(params.returnTo) ?? null,
  ));
}
