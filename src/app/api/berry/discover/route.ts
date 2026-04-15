import { getBerryAuth } from "@/lib/auth";
import { BERRY_API_BASE, SUPERSET_BASE } from "@/lib/berry";

// Dashboard IDs to probe
const DASHBOARDS = [
  { id: "15", label: "Drive-thru (current)" },
  { id: "66", label: "Drive-thru Summary analytics" },
  { id: "17", label: "Dashboard 17" },
];

function cookiesFrom(res: Response): string {
  const setCookie = res.headers.getSetCookie?.() ?? [];
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

async function getSession(token: string, dashboardId: string) {
  const guestRes = await fetch(
    `${BERRY_API_BASE}/superset/dashboard/${dashboardId}/embed/guest_token/dynamic_rls`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Length": "0" } }
  );
  if (!guestRes.ok) return null;
  const { guest_token } = await guestRes.json();

  // Get list of charts for this dashboard
  const chartsRes = await fetch(`${SUPERSET_BASE}/api/v1/dashboard/${dashboardId}/charts`, {
    headers: { "X-GuestToken": guest_token },
  });
  if (!chartsRes.ok) return { guest_token, charts: null, chartsStatus: chartsRes.status };
  const charts = await chartsRes.json();
  return { guest_token, charts };
}

export async function GET() {
  const { token } = await getBerryAuth();
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const results: Record<string, unknown> = {};

  for (const dash of DASHBOARDS) {
    try {
      const session = await getSession(token, dash.id);
      results[`dashboard_${dash.id}`] = { label: dash.label, ...session };
    } catch (e) {
      results[`dashboard_${dash.id}`] = { label: dash.label, error: String(e) };
    }
  }

  return Response.json(results);
}
