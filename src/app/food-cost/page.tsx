import FoodCostClient from "@/components/FoodCostClient";
import { requireTab } from "@/lib/users/access";

export default async function FoodCostPage() {
  const viewer = await requireTab("/food-cost");
  return <FoodCostClient tabs={viewer.position.tabs} isAdmin={viewer.position.isAdmin} />;
}
