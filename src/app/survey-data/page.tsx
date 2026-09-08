import SurveyDataClient from "@/components/SurveyDataClient";
import { requireTab } from "@/lib/users/access";
import { listLeaders } from "@/lib/users/leaders";

export default async function SurveyDataPage() {
  const viewer = await requireTab("/survey-data");
  const leaders = await listLeaders();
  return (
    <SurveyDataClient
      tabs={viewer.position.tabs}
      isAdmin={viewer.position.isAdmin}
      leaders={leaders}
    />
  );
}
