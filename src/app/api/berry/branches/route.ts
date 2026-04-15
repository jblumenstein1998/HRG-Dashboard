import { getBerryAuth } from "@/lib/auth";
import { BERRY_API_BASE } from "@/lib/berry";

export async function GET() {
  const { token, corpId } = await getBerryAuth();
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const res = await fetch(`${BERRY_API_BASE}/hierarchies/branch_to_user/branches`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ corp: corpId }),
  });

  const data = await res.json();
  if (!res.ok) {
    return Response.json({ error: "Failed to fetch branches", detail: data }, { status: res.status });
  }

  // Returns { results: [...] }
  return Response.json(data.results ?? data);
}
