import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { berryFetch } from "@/lib/berry";

export async function GET(_request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("berry_token")?.value;

  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const res = await berryFetch("/branches", token);
  const data = await res.json();

  if (!res.ok) {
    return Response.json({ error: "Failed to fetch branches", detail: data }, { status: res.status });
  }

  return Response.json(data);
}
