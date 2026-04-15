import { redirect } from "next/navigation";
import { cookies } from "next/headers";

export default async function Home() {
  const cookieStore = await cookies();
  if (cookieStore.get("berry_token")) redirect("/dashboard");
  else redirect("/login");
}
