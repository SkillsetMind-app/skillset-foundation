import { redirect } from "next/navigation";

// "Collaborators" era uma placa de "em breve" no menu. Saiu do menu; a rota
// fica viva para links antigos e leva para o inicio do estudio.
export default function TeacherTeamPage() {
  redirect("/teach");
}
