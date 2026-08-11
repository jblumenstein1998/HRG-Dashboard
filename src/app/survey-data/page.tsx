import SurveyDataClient from "@/components/SurveyDataClient";
import { requireTab } from "@/lib/users/access";

export default async function SurveyDataPage() {
  const viewer = await requireTab("/survey-data");
  return <SurveyDataClient tabs={viewer.position.tabs} isAdmin={viewer.position.isAdmin} />;
}
