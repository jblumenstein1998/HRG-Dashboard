import FoodCostClient from "@/components/FoodCostClient";
import { requireTab } from "@/lib/users/access";
import { listLeaders } from "@/lib/users/leaders";

export default async function FoodCostPage() {
  const viewer = await requireTab("/food-cost");
  const leaders = await listLeaders();
  return (
    <FoodCostClient
      tabs={viewer.position.tabs}
      isAdmin={viewer.position.isAdmin}
      leaders={leaders}
    />
  );
}
