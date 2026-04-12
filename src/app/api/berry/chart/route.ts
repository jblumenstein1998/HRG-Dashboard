import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { BERRY_BASE_URL, BERRY_DASHBOARD_ID } from "@/lib/berry";

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("berry_token")?.value;

  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Forward any extra query params the client sends (e.g. branch_id, date range)
  const searchParams = request.nextUrl.searchParams;
  const formDataParam = searchParams.get("form_data");

  const url = new URL(`${BERRY_BASE_URL}/api/v1/chart/data`);
  url.searchParams.set("dashboard_id", String(BERRY_DASHBOARD_ID));
  if (formDataParam) {
    url.searchParams.set("form_data", formDataParam);
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const data = await res.json();

  if (!res.ok) {
    return Response.json({ error: "Failed to fetch chart data", detail: data }, { status: res.status });
  }

  return Response.json(data);
}
