import { cookies } from "next/headers";

export async function getBerryAuth() {
  const cookieStore = await cookies();
  return {
    token: cookieStore.get("berry_token")?.value ?? "",
    corpId: cookieStore.get("berry_corp")?.value ?? "",
  };
}
