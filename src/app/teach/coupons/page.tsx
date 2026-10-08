import { redirect } from "next/navigation";

// Os cupons vivem dentro de cada produto (painel do produto > Coupons). Esta
// rota era so uma placa dizendo isso; agora leva direto para a lista de
// produtos.
export default function TeacherCouponsPage() {
  redirect("/teach/builder");
}
