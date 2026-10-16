import { redirect } from "next/navigation";

// "Integrations" era uma placa de "em breve" no menu. A unica integracao que
// existe e o Stripe, que mora em Earnings: e para la que os links antigos vao.
export default function TeacherIntegrationsPage() {
  redirect("/account/payments");
}
