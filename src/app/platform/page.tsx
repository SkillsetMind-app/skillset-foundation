import { redirect } from "next/navigation";

// /platform era uma vitrine interna ("Platform overview") sem caminho de volta:
// beco sem saída (F15). Quem chega aqui quer o catálogo.
export default function PlatformPage() {
  redirect("/courses");
}
