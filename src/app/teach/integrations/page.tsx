import { redirect } from "next/navigation";

// "Integrations" was a "coming soon" sign in the menu. The only integration that
// exists is Stripe, which lives in Earnings: that is where the old links go.
export default function TeacherIntegrationsPage() {
  redirect("/account/payments");
}
